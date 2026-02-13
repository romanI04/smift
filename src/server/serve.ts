import http from 'http';
import fs from 'fs';
import path from 'path';
import {spawn} from 'child_process';
import {
  DOMAIN_PACK_IDS,
  getDomainPack,
  selectDomainPack,
  type DomainPack,
  type DomainPackId,
} from '../pipeline/domain-packs';
import {scrapeUrl} from '../pipeline/scraper';
import {extractGroundingHints, summarizeGroundingUsage} from '../pipeline/grounding';
import {selectTemplate, getTemplateProfile, type TemplateId, type TemplateProfile} from '../pipeline/templates';
import {scoreScriptQuality} from '../pipeline/quality';
import {autoFixScriptQuality} from '../pipeline/autofix';
import {regenerateScriptSection, type RegenerateSection} from '../pipeline/section-regenerate';
import type {ScriptResult} from '../pipeline/script-types';
import {normalizeScriptPayload, toPersistedScript} from '../pipeline/script-io';

type JobStatus = 'queued' | 'running' | 'completed' | 'failed';
type JobMode = 'generate' | 'rerender';

interface JobRecord {
  id: string;
  url: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
  outputName: string;
  options: {
    mode: JobMode;
    strict: boolean;
    quality: 'draft' | 'yc';
    voice: 'none' | 'openai' | 'elevenlabs' | 'chatterbox';
    skipRender: boolean;
    pack: 'auto' | DomainPackId;
    scriptPath?: string;
    sourceJobId?: string;
  };
  logs: string[];
}

const cwd = path.resolve(__dirname, '../..');
const outDir = path.join(cwd, 'out');
const jobsDir = path.join(outDir, 'jobs');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, {recursive: true});
if (!fs.existsSync(jobsDir)) fs.mkdirSync(jobsDir, {recursive: true});

const jobs = new Map<string, JobRecord>();
const queue: string[] = [];
let activeJobId: string | null = null;
const REGENERATE_SECTIONS: RegenerateSection[] = ['hook', 'feature1', 'feature2', 'feature3', 'cta'];

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || 'GET';
    const url = new URL(req.url || '/', 'http://localhost');

    if (method === 'GET' && url.pathname === '/') {
      return sendHtml(res, renderHtml());
    }

    if (method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        activeJobId,
        queued: queue.length,
        totalJobs: jobs.size,
      });
    }

    if (method === 'POST' && url.pathname === '/api/jobs') {
      const payload = await readJsonBody(req);
      const submittedUrl = String(payload.url || '').trim();
      if (!submittedUrl) return sendJson(res, 400, {error: 'url is required'});

      const job = createJob(submittedUrl, payload);
      jobs.set(job.id, job);
      queue.push(job.id);
      persistJob(job);
      tickQueue();

      return sendJson(res, 201, {
        id: job.id,
        status: job.status,
        url: job.url,
      });
    }

    if (method === 'POST' && /^\/api\/jobs\/[^/]+\/regenerate$/.test(url.pathname)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[2];
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, {error: 'job not found'});
      if (job.status === 'running' || activeJobId === id) {
        return sendJson(res, 409, {error: 'job is running; wait until completion'});
      }

      const payload = await readJsonBody(req);
      const section = String(payload.section || '').trim() as RegenerateSection;
      if (!REGENERATE_SECTIONS.includes(section)) {
        return sendJson(res, 400, {error: `section is required and must be one of: ${REGENERATE_SECTIONS.join(', ')}`});
      }

      const artifacts = artifactsFor(job);
      if (!artifacts.scriptPath) {
        return sendJson(res, 400, {error: 'script artifact missing; run job first'});
      }

      const existingScriptRaw = JSON.parse(fs.readFileSync(artifacts.scriptPath, 'utf-8')) as ScriptResult & {narration?: string};
      const existingScript: ScriptResult = {
        ...existingScriptRaw,
        narrationSegments: Array.isArray(existingScriptRaw.narrationSegments) ? existingScriptRaw.narrationSegments : [],
      };

      const existingQuality = artifacts.qualityPath
        ? safeReadJson(artifacts.qualityPath)
        : null;

      const scraped = await scrapeUrl(job.url);
      const packFromArtifacts = String(existingScript.domainPackId || existingQuality?.domainPack || '').trim();
      const selectedPackId = (DOMAIN_PACK_IDS.includes(packFromArtifacts as DomainPackId)
        ? packFromArtifacts
        : (job.options.pack === 'auto' ? null : job.options.pack)) as DomainPackId | null;
      const packSelection = selectedPackId
        ? {
          pack: getDomainPack(selectedPackId),
          reason: `Preserved existing pack ${selectedPackId}`,
          confidence: 1,
          scores: existingQuality?.domainPackScores ?? {},
          topCandidates: existingQuality?.domainPackTopCandidates ?? [],
        }
        : selectDomainPack(scraped, 'auto');
      const domainPack = packSelection.pack;

      const templateFromArtifacts = String(existingQuality?.template || '').trim() as TemplateId;
      const templateProfile = ['yc-saas', 'product-demo', 'founder-story'].includes(templateFromArtifacts)
        ? getTemplateProfile(templateFromArtifacts)
        : selectTemplate(scraped, 'auto', domainPack.id).profile;

      const groundingHints = extractGroundingHints(scraped);
      const regenerated = regenerateScriptSection({
        script: existingScript,
        section,
        scraped,
        domainPack,
        groundingHints,
      });

      let nextScript = regenerated.script;
      let qualityReport = scoreScriptQuality({
        script: nextScript,
        scraped,
        template: templateProfile,
        domainPack,
        groundingHints,
        minScore: 80,
        maxWarnings: job.options.strict ? 0 : 3,
        failOnWarnings: job.options.strict,
      });
      const actions = [...regenerated.actions];
      let generationMode = `section-regenerate:${section}`;
      if (!qualityReport.passed) {
        const fixed = autoFixScriptQuality(nextScript, scraped, domainPack, groundingHints);
        nextScript = fixed.script;
        if (fixed.actions.length > 0) {
          actions.push(...fixed.actions.map((item) => `autofix: ${item}`));
        }
        qualityReport = scoreScriptQuality({
          script: nextScript,
          scraped,
          template: templateProfile,
          domainPack,
          groundingHints,
          minScore: 80,
          maxWarnings: job.options.strict ? 0 : 3,
          failOnWarnings: job.options.strict,
        });
        generationMode = `${generationMode}+autofix`;
      }

      fs.writeFileSync(
        artifacts.scriptPath,
        JSON.stringify({...nextScript, narration: nextScript.narrationSegments.join(' ')}, null, 2),
      );

      if (artifacts.qualityPath) {
        fs.writeFileSync(
          artifacts.qualityPath,
          JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              url: job.url,
              template: templateProfile.id,
              templateReason: `Regenerated ${section} section`,
              domainPack: domainPack.id,
              domainPackReason: packSelection.reason,
              domainPackConfidence: packSelection.confidence,
              domainPackTopCandidates: packSelection.topCandidates,
              domainPackScores: packSelection.scores,
              grounding: summarizeGroundingUsage(nextScript, groundingHints),
              relevanceGuard: {
                enabled: false,
                applied: false,
                actions: [],
                warnings: [],
              },
              generationMode,
              regeneratedSection: section,
              regenerationActions: actions,
              qualityReport,
            },
            null,
            2,
          ),
        );
      }

      appendLog(job, `[regen] ${section}: ${actions.join(' | ')}`);
      persistJob(job);

      return sendJson(res, 200, {
        id: job.id,
        section,
        generationMode,
        quality: qualitySummaryFor(job),
        artifacts: artifactsFor(job),
        actions,
      });
    }

    if (method === 'GET' && /^\/api\/jobs\/[^/]+\/script$/.test(url.pathname)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[2];
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, {error: 'job not found'});
      const artifacts = artifactsFor(job);
      if (!artifacts.scriptPath) return sendJson(res, 400, {error: 'script artifact missing; run job first'});
      const parsed = safeReadJson(artifacts.scriptPath);
      if (!parsed) return sendJson(res, 500, {error: 'script artifact parse failed'});
      const normalized = normalizeScriptPayload(parsed);
      return sendJson(res, 200, {
        id: job.id,
        path: artifacts.scriptPath,
        script: normalized,
      });
    }

    if (method === 'PUT' && /^\/api\/jobs\/[^/]+\/script$/.test(url.pathname)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[2];
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, {error: 'job not found'});
      if (job.status === 'running' || activeJobId === id) {
        return sendJson(res, 409, {error: 'job is running; wait until completion'});
      }
      const artifacts = artifactsFor(job);
      if (!artifacts.scriptPath) return sendJson(res, 400, {error: 'script artifact missing; run job first'});
      const payload = await readJsonBody(req);
      const candidate = (payload.script && typeof payload.script === 'object')
        ? payload.script
        : payload;

      let normalized: ScriptResult;
      try {
        normalized = normalizeScriptPayload(candidate);
      } catch (error: any) {
        return sendJson(res, 400, {error: `invalid script payload: ${error.message}`});
      }

      fs.writeFileSync(artifacts.scriptPath, JSON.stringify(toPersistedScript(normalized), null, 2));

      if (artifacts.qualityPath) {
        const existingQuality = safeReadJson(artifacts.qualityPath) ?? {};
        fs.writeFileSync(
          artifacts.qualityPath,
          JSON.stringify(
            {
              ...existingQuality,
              generatedAt: new Date().toISOString(),
              generationMode: 'manual-edit',
              qualityReport: existingQuality.qualityReport ?? null,
              editor: {
                source: 'local-server-ui',
                note: 'Script edited manually. Re-render recommended.',
              },
            },
            null,
            2,
          ),
        );
      }

      appendLog(job, '[edit] script updated manually');
      persistJob(job);
      return sendJson(res, 200, {
        id: job.id,
        updated: true,
        artifacts: artifactsFor(job),
      });
    }

    if (method === 'POST' && /^\/api\/jobs\/[^/]+\/validate-script$/.test(url.pathname)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[2];
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, {error: 'job not found'});
      if (job.status === 'running' || activeJobId === id) {
        return sendJson(res, 409, {error: 'job is running; wait until completion'});
      }

      const payload = await readJsonBody(req);
      const autofix = Boolean(payload.autofix);
      const artifacts = artifactsFor(job);
      if (!artifacts.scriptPath) {
        return sendJson(res, 400, {error: 'script artifact missing; run job first'});
      }

      const scriptRaw = safeReadJson(artifacts.scriptPath);
      if (!scriptRaw) {
        return sendJson(res, 500, {error: 'script artifact parse failed'});
      }
      const script = normalizeScriptPayload(scriptRaw);
      const existingQuality = artifacts.qualityPath ? safeReadJson(artifacts.qualityPath) : null;
      const context = await resolveQualityContext(job, script, existingQuality);

      let nextScript = script;
      let qualityReport = scoreScriptQuality({
        script: nextScript,
        scraped: context.scraped,
        template: context.templateProfile,
        domainPack: context.domainPack,
        groundingHints: context.groundingHints,
        minScore: 80,
        maxWarnings: job.options.strict ? 0 : 3,
        failOnWarnings: job.options.strict,
      });
      const autofixActions: string[] = [];
      let generationMode = 'manual-edit-validation';

      if (autofix && !qualityReport.passed) {
        const fixed = autoFixScriptQuality(nextScript, context.scraped, context.domainPack, context.groundingHints);
        nextScript = fixed.script;
        autofixActions.push(...fixed.actions);
        qualityReport = scoreScriptQuality({
          script: nextScript,
          scraped: context.scraped,
          template: context.templateProfile,
          domainPack: context.domainPack,
          groundingHints: context.groundingHints,
          minScore: 80,
          maxWarnings: job.options.strict ? 0 : 3,
          failOnWarnings: job.options.strict,
        });
        generationMode = 'manual-edit+autofix';
        if (autofixActions.length > 0) {
          fs.writeFileSync(artifacts.scriptPath, JSON.stringify(toPersistedScript(nextScript), null, 2));
          appendLog(job, `[autofix] ${autofixActions.join(' | ')}`);
        }
      }

      if (artifacts.qualityPath) {
        fs.writeFileSync(
          artifacts.qualityPath,
          JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              url: job.url,
              template: context.templateProfile.id,
              templateReason: context.templateReason,
              domainPack: context.domainPack.id,
              domainPackReason: context.packReason,
              domainPackConfidence: context.packConfidence,
              domainPackTopCandidates: context.packTopCandidates,
              domainPackScores: context.packScores,
              grounding: summarizeGroundingUsage(nextScript, context.groundingHints),
              relevanceGuard: {
                enabled: false,
                applied: false,
                actions: [],
                warnings: [],
              },
              generationMode,
              qualityReport,
              editor: {
                source: 'local-server-ui',
                autofix,
                autofixActions,
              },
            },
            null,
            2,
          ),
        );
      }

      persistJob(job);
      return sendJson(res, 200, {
        id: job.id,
        autofix,
        autofixActions,
        qualityReport,
        quality: qualitySummaryFor(job),
        artifacts: artifactsFor(job),
      });
    }

    if (method === 'POST' && /^\/api\/jobs\/[^/]+\/rerender$/.test(url.pathname)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[2];
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, {error: 'job not found'});
      if (job.status === 'running' || activeJobId === id) {
        return sendJson(res, 409, {error: 'job is running; wait until completion'});
      }
      const artifacts = artifactsFor(job);
      if (!artifacts.scriptPath) return sendJson(res, 400, {error: 'script artifact missing; run job first'});
      const scriptRaw = safeReadJson(artifacts.scriptPath);
      if (!scriptRaw) return sendJson(res, 500, {error: 'script artifact parse failed'});
      const script = normalizeScriptPayload(scriptRaw);
      const existingQuality = artifacts.qualityPath ? safeReadJson(artifacts.qualityPath) : null;
      const context = await resolveQualityContext(job, script, existingQuality);
      const qualityReport = scoreScriptQuality({
        script,
        scraped: context.scraped,
        template: context.templateProfile,
        domainPack: context.domainPack,
        groundingHints: context.groundingHints,
        minScore: 80,
        maxWarnings: job.options.strict ? 0 : 3,
        failOnWarnings: job.options.strict,
      });
      if (!qualityReport.passed) {
        return sendJson(res, 409, {
          error: 'quality guard blocked rerender',
          qualityReport,
        });
      }

      const payload = await readJsonBody(req);
      const rerenderJob = createRerenderJob(job, artifacts.scriptPath, payload);
      jobs.set(rerenderJob.id, rerenderJob);
      queue.push(rerenderJob.id);
      persistJob(rerenderJob);
      appendLog(job, `[rerender] queued rerender job ${rerenderJob.id}`);
      tickQueue();

      return sendJson(res, 201, {
        id: rerenderJob.id,
        sourceJobId: job.id,
        status: rerenderJob.status,
        mode: rerenderJob.options.mode,
      });
    }

    if (method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[2];
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, {error: 'job not found'});

      if (parts.length === 3) {
        if (url.searchParams.get('view') === 'quality') {
          return sendJson(res, 200, qualitySummaryFor(job));
        }
        return sendJson(res, 200, enrichJob(job));
      }

      if (parts.length === 4 && parts[3] === 'artifacts') {
        return sendJson(res, 200, artifactsFor(job));
      }

      if (parts.length === 4 && parts[3] === 'quality') {
        return sendJson(res, 200, qualitySummaryFor(job));
      }
    }

    sendJson(res, 404, {error: 'not found'});
  } catch (e: any) {
    sendJson(res, 500, {error: e.message});
  }
});

const port = Number(process.env.SMIFT_PORT || 3030);
server.listen(port, () => {
  console.log(`smift server listening on http://localhost:${port}`);
});

function createJob(url: string, payload: Record<string, unknown>): JobRecord {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outputName = url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
  const strict = Boolean(payload.strict ?? false);
  const quality = payload.quality === 'yc' ? 'yc' : 'draft';
  const voice = (['none', 'openai', 'elevenlabs', 'chatterbox'].includes(String(payload.voice))
    ? String(payload.voice)
    : 'none') as JobRecord['options']['voice'];
  const skipRender = payload.skipRender === undefined ? true : Boolean(payload.skipRender);
  const packRaw = String(payload.pack ?? 'auto');
  const pack = (packRaw === 'auto' || DOMAIN_PACK_IDS.includes(packRaw as DomainPackId)
    ? packRaw
    : 'auto') as JobRecord['options']['pack'];

  return {
    id,
    url,
    status: 'queued',
    createdAt: new Date().toISOString(),
    outputName,
    options: {
      mode: 'generate',
      strict,
      quality,
      voice,
      skipRender,
      pack,
    },
    logs: [],
  };
}

function createRerenderJob(sourceJob: JobRecord, scriptPath: string, payload: Record<string, unknown>): JobRecord {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const quality = payload.quality === 'yc' ? 'yc' : sourceJob.options.quality;
  const voice = (['none', 'openai', 'elevenlabs', 'chatterbox'].includes(String(payload.voice))
    ? String(payload.voice)
    : sourceJob.options.voice) as JobRecord['options']['voice'];
  const strict = payload.strict === undefined ? sourceJob.options.strict : Boolean(payload.strict);

  return {
    id,
    url: sourceJob.url,
    status: 'queued',
    createdAt: new Date().toISOString(),
    outputName: sourceJob.outputName,
    options: {
      mode: 'rerender',
      strict,
      quality,
      voice,
      skipRender: false,
      pack: sourceJob.options.pack,
      scriptPath,
      sourceJobId: sourceJob.id,
    },
    logs: [],
  };
}

interface QualityContext {
  scraped: Awaited<ReturnType<typeof scrapeUrl>>;
  domainPack: DomainPack;
  templateProfile: TemplateProfile;
  templateReason: string;
  packReason: string;
  packConfidence: number;
  packTopCandidates: Array<{id: DomainPackId; score: number}>;
  packScores: Record<string, number>;
  groundingHints: ReturnType<typeof extractGroundingHints>;
}

async function resolveQualityContext(
  job: JobRecord,
  script: ScriptResult,
  existingQuality: any,
): Promise<QualityContext> {
  const scraped = await scrapeUrl(job.url);
  const packFromArtifacts = String(script.domainPackId || existingQuality?.domainPack || '').trim();
  const selectedPackId = (DOMAIN_PACK_IDS.includes(packFromArtifacts as DomainPackId)
    ? packFromArtifacts
    : (job.options.pack === 'auto' ? null : job.options.pack)) as DomainPackId | null;
  const packSelection = selectedPackId
    ? {
      pack: getDomainPack(selectedPackId),
      reason: `Preserved existing pack ${selectedPackId}`,
      confidence: 1,
      scores: existingQuality?.domainPackScores ?? {},
      topCandidates: existingQuality?.domainPackTopCandidates ?? [],
    }
    : selectDomainPack(scraped, 'auto');
  const domainPack = packSelection.pack;

  const templateFromArtifacts = String(existingQuality?.template || '').trim() as TemplateId;
  const templateSelection = ['yc-saas', 'product-demo', 'founder-story'].includes(templateFromArtifacts)
    ? {
      profile: getTemplateProfile(templateFromArtifacts),
      reason: `Preserved existing template ${templateFromArtifacts}`,
    }
    : selectTemplate(scraped, 'auto', domainPack.id);

  const groundingHints = extractGroundingHints(scraped);

  return {
    scraped,
    domainPack,
    templateProfile: templateSelection.profile,
    templateReason: templateSelection.reason,
    packReason: packSelection.reason,
    packConfidence: packSelection.confidence,
    packTopCandidates: packSelection.topCandidates,
    packScores: packSelection.scores,
    groundingHints,
  };
}

function tickQueue() {
  if (activeJobId) return;
  const nextId = queue.shift();
  if (!nextId) return;

  const job = jobs.get(nextId);
  if (!job) return tickQueue();

  activeJobId = nextId;
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  persistJob(job);

  const args = ['run', 'generate', '--'];
  if (job.options.mode === 'rerender') {
    args.push(
      `--script-path=${job.options.scriptPath}`,
      `--output-name=${job.outputName}`,
      `--voice=${job.options.voice}`,
      `--quality=${job.options.quality}`,
      '--max-script-attempts=1',
      '--min-quality=80',
    );
  } else {
    args.push(
      job.url,
      `--voice=${job.options.voice}`,
      `--quality=${job.options.quality}`,
      `--pack=${job.options.pack}`,
      '--template=auto',
      '--max-script-attempts=2',
      '--min-quality=80',
    );
    if (job.options.skipRender) args.push('--skip-render');
  }

  if (job.options.strict) args.push('--strict');

  const child = spawn('npm', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => appendLog(job, chunk.toString()));
  child.stderr.on('data', (chunk) => appendLog(job, chunk.toString()));

  child.on('error', (err) => {
    job.status = 'failed';
    job.error = err.message;
    job.finishedAt = new Date().toISOString();
    persistJob(job);
    activeJobId = null;
    tickQueue();
  });

  child.on('close', (code) => {
    job.exitCode = code ?? -1;
    job.finishedAt = new Date().toISOString();
    job.status = code === 0 ? 'completed' : 'failed';
    if (code !== 0) job.error = `generate exited with code ${code}`;
    persistJob(job);
    activeJobId = null;
    tickQueue();
  });
}

function artifactsFor(job: JobRecord) {
  const base = path.join(outDir, job.outputName);
  const scriptPath = `${base}-script.json`;
  const qualityPath = `${base}-quality.json`;
  const jobPath = `${base}-job.json`;
  const videoPath = `${base}.mp4`;
  const voicePath = `${base}-voice.mp3`;

  return {
    scriptPath: fs.existsSync(scriptPath) ? scriptPath : null,
    qualityPath: fs.existsSync(qualityPath) ? qualityPath : null,
    jobPath: fs.existsSync(jobPath) ? jobPath : null,
    videoPath: fs.existsSync(videoPath) ? videoPath : null,
    voicePath: fs.existsSync(voicePath) ? voicePath : null,
  };
}

function enrichJob(job: JobRecord) {
  return {
    ...job,
    queuePosition: job.status === 'queued' ? queue.indexOf(job.id) + 1 : 0,
    artifacts: artifactsFor(job),
    quality: qualitySummaryFor(job),
  };
}

function qualitySummaryFor(job: JobRecord) {
  const base = path.join(outDir, job.outputName);
  const qualityPath = `${base}-quality.json`;
  if (!fs.existsSync(qualityPath)) {
    return {
      available: false,
      path: null,
      score: null,
      passed: null,
      generationMode: null,
      domainPack: null,
      domainPackConfidence: null,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(qualityPath, 'utf-8')) as {
      generationMode?: string;
      domainPack?: string;
      domainPackConfidence?: number;
      qualityReport?: {score?: number; passed?: boolean};
    };
    return {
      available: true,
      path: qualityPath,
      score: parsed.qualityReport?.score ?? null,
      passed: parsed.qualityReport?.passed ?? null,
      generationMode: parsed.generationMode ?? null,
      domainPack: parsed.domainPack ?? null,
      domainPackConfidence: parsed.domainPackConfidence ?? null,
    };
  } catch {
    return {
      available: false,
      path: qualityPath,
      score: null,
      passed: null,
      generationMode: null,
      domainPack: null,
      domainPackConfidence: null,
      error: 'quality file parse failed',
    };
  }
}

function persistJob(job: JobRecord) {
  const file = path.join(jobsDir, `${job.id}.json`);
  fs.writeFileSync(file, JSON.stringify(job, null, 2));
}

function appendLog(job: JobRecord, text: string) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    job.logs.push(line);
  }
  if (job.logs.length > 80) {
    job.logs = job.logs.slice(-80);
  }
  persistJob(job);
}

function safeReadJson(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function sendJson(res: http.ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendHtml(res: http.ServerResponse, html: string) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function renderHtml() {
  const packOptions = ['auto', ...DOMAIN_PACK_IDS]
    .map((id) => `<option value="${id}">${id}</option>`)
    .join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>smift runner</title>
  <style>
    :root { --bg:#f6f6f4; --panel:#ffffff; --ink:#111111; --muted:#666; --accent:#0b6dfc; --ok:#138a36; --bad:#b42318; --warn:#b54708; }
    body { margin:0; font-family: ui-sans-serif, -apple-system, Segoe UI, sans-serif; background: radial-gradient(circle at 10% 10%, #e8efe9 0, #f6f6f4 38%); color: var(--ink); }
    .wrap { max-width: 1100px; margin: 24px auto; padding: 0 16px; }
    .card { background:var(--panel); border:1px solid #e8e8e8; border-radius:14px; padding:16px; box-shadow:0 8px 26px rgba(0,0,0,0.05); }
    h1 { margin: 0 0 10px; font-size: 26px; }
    h2 { margin: 16px 0 8px; font-size: 18px; }
    h3 { margin: 0 0 10px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em; color: #333; }
    .row { display:flex; gap:10px; flex-wrap: wrap; margin-bottom: 10px; }
    input, select, textarea { padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:13px; background: #fff; }
    input[type=text] { flex:1; min-width:220px; }
    textarea { width: 100%; min-height: 74px; font-family: ui-sans-serif, -apple-system, Segoe UI, sans-serif; }
    button { border:none; background:var(--accent); color:#fff; border-radius:8px; padding:10px 14px; font-weight:600; cursor:pointer; }
    button.secondary { background: #1f2937; }
    button.warn { background: #b54708; }
    button:disabled { opacity: 0.65; cursor: default; }
    pre { background:#fafafa; border:1px solid #eee; border-radius:8px; padding:12px; overflow:auto; font-size:12px; }
    .muted { color:var(--muted); }
    .ok { color:var(--ok); font-weight:600; }
    .bad { color:var(--bad); font-weight:600; }
    .warnText { color: var(--warn); font-weight: 600; }
    .split { display:grid; grid-template-columns: 2fr 1fr; gap: 12px; margin-top: 12px; align-items: start; }
    .editor-grid { display:grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 10px; }
    .feature-grid { display:grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 10px; }
    .feature-card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; background: #fcfcfc; }
    .field { display:flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
    .field label { font-size: 12px; color: #555; }
    .hint { font-size: 12px; color: var(--muted); }
    .quality-box { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; background: #fcfcfc; }
    .stack { display:flex; flex-direction: column; gap: 10px; }
    @media (max-width: 900px) {
      .split { grid-template-columns: 1fr; }
      .editor-grid { grid-template-columns: 1fr; }
      .feature-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>smift self-serve runner</h1>
      <p class="muted">URL -> script -> structured edits -> quality guard -> rerender.</p>
      <div class="row">
        <input id="url" type="text" placeholder="https://linear.app" />
        <select id="quality"><option value="draft">draft</option><option value="yc">yc</option></select>
        <select id="pack">${packOptions}</select>
        <select id="strict"><option value="false">standard</option><option value="true">strict</option></select>
        <select id="skipRender"><option value="true">script-only</option><option value="false">render-video</option></select>
        <button id="submit">Run</button>
      </div>
      <div class="row">
        <select id="section">
          <option value="hook">hook</option>
          <option value="feature1">feature1</option>
          <option value="feature2">feature2</option>
          <option value="feature3">feature3</option>
          <option value="cta">cta</option>
        </select>
        <button id="regen" class="secondary">Regenerate Section</button>
        <button id="loadScript" class="secondary">Load Script</button>
        <button id="saveScript" class="secondary">Save Draft</button>
        <button id="checkScript" class="secondary">Quality Check</button>
        <button id="rerender">Rerender (Guarded)</button>
        <button id="autofixRerender" class="warn">Auto-fix + Rerender</button>
      </div>
      <div class="split">
        <div class="stack">
          <h2>Script Editor</h2>
          <div class="hint">Structured editor with client-side validation. Save before rerender.</div>
          <div class="editor-grid">
            <div class="field"><label>Brand Name</label><input id="brandName" type="text" /></div>
            <div class="field"><label>Brand URL</label><input id="brandUrl" type="text" /></div>
            <div class="field"><label>CTA URL</label><input id="ctaUrl" type="text" /></div>
          </div>
          <div class="editor-grid">
            <div class="field"><label>Tagline</label><input id="tagline" type="text" /></div>
            <div class="field"><label>Brand Color</label><input id="brandColor" type="text" /></div>
            <div class="field"><label>Accent Color</label><input id="accentColor" type="text" /></div>
          </div>
          <div class="editor-grid">
            <div class="field"><label>Hook Line 1</label><input id="hookLine1" type="text" /></div>
            <div class="field"><label>Hook Line 2</label><input id="hookLine2" type="text" /></div>
            <div class="field"><label>Hook Keyword</label><input id="hookKeyword" type="text" /></div>
          </div>
          <div class="field">
            <label>Integrations (comma or new line separated)</label>
            <textarea id="integrations"></textarea>
          </div>
          <div class="field">
            <label>Narration Segments (one per line)</label>
            <textarea id="narrationSegments" style="min-height: 130px;"></textarea>
          </div>
          <div class="feature-grid">
            <div class="feature-card">
              <h3>Feature 1</h3>
              <div class="field"><label>Icon</label><input id="f1Icon" type="text" /></div>
              <div class="field"><label>App Name</label><input id="f1Name" type="text" /></div>
              <div class="field"><label>Caption</label><input id="f1Caption" type="text" /></div>
              <div class="field"><label>Demo Lines (one per line)</label><textarea id="f1Demo"></textarea></div>
            </div>
            <div class="feature-card">
              <h3>Feature 2</h3>
              <div class="field"><label>Icon</label><input id="f2Icon" type="text" /></div>
              <div class="field"><label>App Name</label><input id="f2Name" type="text" /></div>
              <div class="field"><label>Caption</label><input id="f2Caption" type="text" /></div>
              <div class="field"><label>Demo Lines (one per line)</label><textarea id="f2Demo"></textarea></div>
            </div>
            <div class="feature-card">
              <h3>Feature 3</h3>
              <div class="field"><label>Icon</label><input id="f3Icon" type="text" /></div>
              <div class="field"><label>App Name</label><input id="f3Name" type="text" /></div>
              <div class="field"><label>Caption</label><input id="f3Caption" type="text" /></div>
              <div class="field"><label>Demo Lines (one per line)</label><textarea id="f3Demo"></textarea></div>
            </div>
          </div>
        </div>
        <div class="stack">
          <h2>Quality Guard</h2>
          <div id="qualityBox" class="quality-box muted">No quality check yet.</div>
          <div class="hint">Rerender is guarded: script must pass quality check in current strictness mode.</div>
          <div class="field">
            <label>Current Job ID</label>
            <input id="currentJobId" type="text" readonly />
          </div>
          <div class="field">
            <label>Domain Pack (from script)</label>
            <input id="domainPackId" type="text" readonly />
          </div>
        </div>
      </div>
      <div id="status" class="muted">Idle.</div>
      <pre id="out">No job yet.</pre>
    </div>
  </div>
<script>
  const out = document.getElementById('out');
  const status = document.getElementById('status');
  const qualityBox = document.getElementById('qualityBox');
  const currentJobIdField = document.getElementById('currentJobId');
  const domainPackField = document.getElementById('domainPackId');
  let timer = null;
  let currentId = null;
  let currentScript = null;

  function setStatus(text, kind='') {
    status.textContent = text;
    status.className = kind;
  }

  function setOutput(payload) {
    out.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function parseLines(text) {
    return String(text || '').split('\\n').map((line) => line.trim()).filter(Boolean);
  }

  function parseIntegrations(text) {
    return String(text || '')
      .split(/[,\\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function setField(id, value) {
    byId(id).value = value == null ? '' : String(value);
  }

  function populateFeature(index, feature) {
    const base = 'f' + index;
    setField(base + 'Icon', feature && feature.icon ? feature.icon : '');
    setField(base + 'Name', feature && feature.appName ? feature.appName : '');
    setField(base + 'Caption', feature && feature.caption ? feature.caption : '');
    setField(base + 'Demo', feature && Array.isArray(feature.demoLines) ? feature.demoLines.join('\\n') : '');
  }

  function readFeature(index) {
    const base = 'f' + index;
    return {
      icon: String(byId(base + 'Icon').value || '').trim(),
      appName: String(byId(base + 'Name').value || '').trim(),
      caption: String(byId(base + 'Caption').value || '').trim(),
      demoLines: parseLines(byId(base + 'Demo').value),
    };
  }

  function populateEditor(script) {
    currentScript = script;
    setField('brandName', script.brandName);
    setField('brandUrl', script.brandUrl);
    setField('ctaUrl', script.ctaUrl);
    setField('tagline', script.tagline);
    setField('brandColor', script.brandColor);
    setField('accentColor', script.accentColor);
    setField('hookLine1', script.hookLine1);
    setField('hookLine2', script.hookLine2);
    setField('hookKeyword', script.hookKeyword);
    setField('integrations', Array.isArray(script.integrations) ? script.integrations.join('\\n') : '');
    setField('narrationSegments', Array.isArray(script.narrationSegments) ? script.narrationSegments.join('\\n') : '');
    populateFeature(1, script.features && script.features[0] ? script.features[0] : null);
    populateFeature(2, script.features && script.features[1] ? script.features[1] : null);
    populateFeature(3, script.features && script.features[2] ? script.features[2] : null);
    domainPackField.value = script.domainPackId || '';
  }

  function buildScriptFromEditor() {
    if (!currentScript) return null;
    const next = JSON.parse(JSON.stringify(currentScript));
    next.brandName = String(byId('brandName').value || '').trim();
    next.brandUrl = String(byId('brandUrl').value || '').trim();
    next.ctaUrl = String(byId('ctaUrl').value || '').trim();
    next.tagline = String(byId('tagline').value || '').trim();
    next.brandColor = String(byId('brandColor').value || '').trim();
    next.accentColor = String(byId('accentColor').value || '').trim();
    next.hookLine1 = String(byId('hookLine1').value || '').trim();
    next.hookLine2 = String(byId('hookLine2').value || '').trim();
    next.hookKeyword = String(byId('hookKeyword').value || '').trim();
    next.integrations = parseIntegrations(byId('integrations').value);
    next.narrationSegments = parseLines(byId('narrationSegments').value);
    next.features = [readFeature(1), readFeature(2), readFeature(3)];
    return next;
  }

  function validateScriptDraft(script) {
    const errors = [];
    if (!script.brandName) errors.push('Brand Name is required.');
    if (!script.hookLine1) errors.push('Hook Line 1 is required.');
    if (!script.hookLine2) errors.push('Hook Line 2 is required.');
    if (!script.hookKeyword) errors.push('Hook Keyword is required.');
    if (!script.ctaUrl) errors.push('CTA URL is required.');
    if (!Array.isArray(script.features) || script.features.length < 3) errors.push('Exactly 3 features are required.');
    if (!Array.isArray(script.narrationSegments) || script.narrationSegments.length < 5) {
      errors.push('Narration needs at least 5 segments.');
    }
    (script.features || []).forEach((feature, idx) => {
      if (!feature.appName) errors.push('Feature ' + (idx + 1) + ' App Name is required.');
      if (!feature.caption) errors.push('Feature ' + (idx + 1) + ' Caption is required.');
      if (!Array.isArray(feature.demoLines) || feature.demoLines.length === 0) {
        errors.push('Feature ' + (idx + 1) + ' needs at least one demo line.');
      }
    });
    return errors;
  }

  function renderQuality(result) {
    if (!result || !result.qualityReport) {
      qualityBox.className = 'quality-box muted';
      qualityBox.textContent = 'No quality check yet.';
      return;
    }
    const report = result.qualityReport;
    const lines = [];
    lines.push('Score: ' + report.score + '/' + report.minScore);
    lines.push('Passed: ' + (report.passed ? 'yes' : 'no'));
    if (Array.isArray(result.autofixActions) && result.autofixActions.length > 0) {
      lines.push('Autofix Actions: ' + result.autofixActions.join(' | '));
    }
    if (Array.isArray(report.blockers) && report.blockers.length > 0) {
      lines.push('Blockers:');
      report.blockers.forEach((item) => lines.push('  - ' + item));
    }
    if (Array.isArray(report.warnings) && report.warnings.length > 0) {
      lines.push('Warnings:');
      report.warnings.forEach((item) => lines.push('  - ' + item));
    }
    qualityBox.textContent = lines.join('\\n');
    qualityBox.className = report.passed ? 'quality-box ok' : 'quality-box bad';
  }

  async function poll() {
    if (!currentId) return;
    const res = await fetch('/api/jobs/' + currentId);
    const data = await res.json();
    setOutput(data);
    if (data.status === 'completed') {
      setStatus('Completed', 'ok');
      currentJobIdField.value = currentId;
      clearInterval(timer);
    } else if (data.status === 'failed') {
      setStatus('Failed', 'bad');
      clearInterval(timer);
    } else {
      setStatus('Running: ' + data.status, 'muted');
    }
  }

  async function loadScript() {
    if (!currentId) {
      setStatus('No active job selected', 'bad');
      return;
    }
    const res = await fetch('/api/jobs/' + currentId + '/script');
    const data = await res.json();
    if (!res.ok) {
      setStatus('Load script failed', 'bad');
      setOutput(data);
      return;
    }
    populateEditor(data.script);
    setStatus('Script loaded', 'ok');
    setOutput(data);
    currentJobIdField.value = currentId;
  }

  async function saveScriptDraft() {
    if (!currentId) {
      setStatus('No active job selected', 'bad');
      return {ok: false, errors: ['No active job selected.']};
    }
    const script = buildScriptFromEditor();
    if (!script) {
      setStatus('Load script first', 'bad');
      return {ok: false, errors: ['Load script first.']};
    }
    const draftErrors = validateScriptDraft(script);
    if (draftErrors.length > 0) {
      setStatus('Fix editor errors first', 'bad');
      qualityBox.className = 'quality-box bad';
      qualityBox.textContent = draftErrors.map((item) => '- ' + item).join('\\n');
      return {ok: false, errors: draftErrors};
    }

    const res = await fetch('/api/jobs/' + currentId + '/script', {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({script})
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus('Save script failed', 'bad');
      setOutput(data);
      return {ok: false, errors: [data.error || 'Save script failed']};
    }
    currentScript = script;
    domainPackField.value = script.domainPackId || '';
    setStatus('Script saved', 'ok');
    setOutput(data);
    await poll();
    return {ok: true, script};
  }

  async function runQualityCheck(autofix) {
    if (!currentId) {
      setStatus('No active job selected', 'bad');
      return null;
    }
    const res = await fetch('/api/jobs/' + currentId + '/validate-script', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({autofix})
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus('Quality check failed', 'bad');
      setOutput(data);
      return null;
    }
    renderQuality(data);
    setOutput(data);
    if (autofix) {
      await loadScript();
    }
    return data;
  }

  async function queueRerender() {
    const payload = {
      quality: document.getElementById('quality').value,
      strict: document.getElementById('strict').value === 'true',
      voice: 'none'
    };
    const res = await fetch('/api/jobs/' + currentId + '/rerender', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus('Rerender failed to queue', 'bad');
      setOutput(data);
      return false;
    }
    currentId = data.id;
    currentJobIdField.value = currentId;
    setStatus('Rerender queued: ' + currentId, 'muted');
    setOutput(data);
    if (timer) clearInterval(timer);
    timer = setInterval(poll, 2000);
    poll();
    return true;
  }

  document.getElementById('submit').addEventListener('click', async () => {
    const payload = {
      url: document.getElementById('url').value,
      quality: document.getElementById('quality').value,
      pack: document.getElementById('pack').value,
      strict: document.getElementById('strict').value === 'true',
      skipRender: document.getElementById('skipRender').value === 'true',
      voice: 'none'
    };

    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus('Submit failed', 'bad');
      setOutput(data);
      return;
    }

    currentId = data.id;
    currentScript = null;
    currentJobIdField.value = currentId;
    domainPackField.value = '';
    qualityBox.className = 'quality-box muted';
    qualityBox.textContent = 'No quality check yet.';
    setStatus('Queued: ' + currentId, 'muted');
    setOutput(data);
    if (timer) clearInterval(timer);
    timer = setInterval(poll, 2000);
    poll();
  });

  document.getElementById('regen').addEventListener('click', async () => {
    if (!currentId) {
      setStatus('No active job selected', 'bad');
      return;
    }
    const section = document.getElementById('section').value;
    const res = await fetch('/api/jobs/' + currentId + '/regenerate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({section})
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus('Regenerate failed', 'bad');
      setOutput(data);
      return;
    }
    setStatus('Section regenerated: ' + section, 'ok');
    setOutput(data);
    renderQuality({qualityReport: data.quality && data.quality.available ? {score: data.quality.score, minScore: 80, passed: data.quality.passed, blockers: [], warnings: []} : null});
    await loadScript();
    poll();
  });

  document.getElementById('loadScript').addEventListener('click', loadScript);

  document.getElementById('saveScript').addEventListener('click', async () => {
    await saveScriptDraft();
  });

  document.getElementById('checkScript').addEventListener('click', async () => {
    const saved = await saveScriptDraft();
    if (!saved || !saved.ok) return;
    const quality = await runQualityCheck(false);
    if (quality && quality.qualityReport) {
      setStatus(quality.qualityReport.passed ? 'Quality check passed' : 'Quality check failed', quality.qualityReport.passed ? 'ok' : 'bad');
    }
  });

  document.getElementById('rerender').addEventListener('click', async () => {
    const saved = await saveScriptDraft();
    if (!saved || !saved.ok) return;
    const quality = await runQualityCheck(false);
    if (!quality || !quality.qualityReport) return;
    if (!quality.qualityReport.passed) {
      setStatus('Rerender blocked by quality guard', 'bad');
      return;
    }
    await queueRerender();
  });

  document.getElementById('autofixRerender').addEventListener('click', async () => {
    const saved = await saveScriptDraft();
    if (!saved || !saved.ok) return;
    const quality = await runQualityCheck(true);
    if (!quality || !quality.qualityReport) return;
    if (!quality.qualityReport.passed) {
      setStatus('Auto-fix could not pass quality guard', 'bad');
      return;
    }
    setStatus('Auto-fix passed. Queueing rerender...', 'ok');
    await queueRerender();
  });
</script>
</body>
</html>`;
}

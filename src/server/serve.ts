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
type VersionOutcome = 'accepted' | 'rejected';

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
    rootOutputName: string;
      version: number;
      scriptPath?: string;
      sourceJobId?: string;
      autoPromoteIfWinner?: boolean;
      autoPromoteMinConfidence?: number;
      autoPromoteEvaluatedAt?: string;
      autoPromoteDecision?: string;
    };
  logs: string[];
}

interface AutoPromotePolicy {
  minConfidence: number;
}

interface VersionMetaEntry {
  label?: string;
  archived?: boolean;
  pinned?: boolean;
  outcome?: VersionOutcome;
  outcomeNote?: string;
  outcomeAt?: string;
  promotedAt?: string;
}

interface VersionMetadata {
  rootOutputName: string;
  updatedAt: string;
  entries: Record<string, VersionMetaEntry>;
  promotionPolicy: AutoPromotePolicy;
}

interface ProjectVersion {
  id: string;
  outputName: string;
  rootOutputName: string;
  version: number;
  status: JobStatus;
  mode: JobMode;
  createdAt: string;
  finishedAt: string | null;
  quality: ReturnType<typeof qualitySummaryFor>;
  artifacts: ReturnType<typeof artifactsFor>;
  videoUrl: string | null;
  meta: {
    label: string | null;
    archived: boolean;
    pinned: boolean;
    outcome: VersionOutcome | null;
    outcomeNote: string | null;
    outcomeAt: string | null;
    promotedAt: string | null;
  };
}

interface OutcomeCounts {
  accepted: number;
  rejected: number;
}

interface OutcomeLearning {
  totalOutcomes: number;
  byPack: Map<string, OutcomeCounts>;
  byTemplate: Map<string, OutcomeCounts>;
  byPackTemplate: Map<string, OutcomeCounts>;
}

interface SectionImprovementRecommendation {
  section: RegenerateSection;
  priority: number;
  confidence: number;
  impact: 'high' | 'medium' | 'low';
  reasons: string[];
}

interface AutoImproveConfig {
  maxSteps: number;
  targetScore: number;
  maxWarnings: number;
  strict: boolean;
  autofix: boolean;
  autoRerender: boolean;
  rerenderStrict: boolean;
  autoPromoteIfWinner: boolean;
  autoPromoteMinConfidence: number;
}

interface AutoImproveIteration {
  step: number;
  section: RegenerateSection;
  before: {
    score: number;
    blockers: number;
    warnings: number;
    passed: boolean;
  };
  after: {
    score: number;
    blockers: number;
    warnings: number;
    passed: boolean;
  };
  improved: boolean;
  reason: string;
  planConfidence: number;
  actions: string[];
  autofixActions: string[];
}

interface ProjectAuditEntry {
  at: string;
  type: 'rerender-queued' | 'autopromote-promoted' | 'autopromote-skipped' | 'autopromote-failed' | 'autopromote-policy-updated';
  rootOutputName: string;
  jobId: string;
  sourceJobId: string | null;
  reason: string;
  details?: Record<string, unknown>;
}

interface ProjectAuditLog {
  rootOutputName: string;
  updatedAt: string;
  entries: ProjectAuditEntry[];
}

const cwd = path.resolve(__dirname, '../..');
const outDir = path.join(cwd, 'out');
const jobsDir = path.join(outDir, 'jobs');
const DEFAULT_AUTO_PROMOTE_MIN_CONFIDENCE = 0.75;
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, {recursive: true});
if (!fs.existsSync(jobsDir)) fs.mkdirSync(jobsDir, {recursive: true});

const jobs = new Map<string, JobRecord>();
const queue: string[] = [];
let activeJobId: string | null = null;
const REGENERATE_SECTIONS: RegenerateSection[] = ['hook', 'feature1', 'feature2', 'feature3', 'cta'];
loadPersistedJobs();
evaluatePendingAutoPromoteJobs('startup');
setInterval(() => {
  evaluatePendingAutoPromoteJobs('watchdog');
}, 30000).unref();

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
        outputName: job.outputName,
        rootOutputName: job.options.rootOutputName,
        version: job.options.version,
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

    if (method === 'POST' && /^\/api\/jobs\/[^/]+\/auto-improve$/.test(url.pathname)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[2];
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, {error: 'job not found'});
      if (job.status === 'running' || activeJobId === id) {
        return sendJson(res, 409, {error: 'job is running; wait until completion'});
      }
      const payload = await readJsonBody(req);
      const policy = readProjectAutoPromotePolicy(getRootOutputName(job));
      const config = resolveAutoImproveConfig(payload, job.options.strict, policy.minConfidence);
      const result = await runAutoImproveLoop(job, config);
      if (!result.ok) {
        return sendJson(res, result.code, {error: result.error});
      }
      return sendJson(res, 200, result.data);
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
      const payload = await readJsonBody(req);
      const strictForGuard = payload.strict === undefined ? job.options.strict : Boolean(payload.strict);
      const qualityReport = scoreScriptQuality({
        script,
        scraped: context.scraped,
        template: context.templateProfile,
        domainPack: context.domainPack,
        groundingHints: context.groundingHints,
        minScore: 80,
        maxWarnings: strictForGuard ? 0 : 3,
        failOnWarnings: strictForGuard,
      });
      if (!qualityReport.passed) {
        return sendJson(res, 409, {
          error: 'quality guard blocked rerender',
          qualityReport,
        });
      }

      const queued = queueVersionedRerenderFromScript({
        job,
        script,
        context,
        qualityReport,
        payload,
        generationMode: 'manual-edit-validation',
        versioningSource: 'manual-rerender',
      });

      return sendJson(res, 201, {
        id: queued.rerenderJob.id,
        sourceJobId: job.id,
        status: queued.rerenderJob.status,
        mode: queued.rerenderJob.options.mode,
        outputName: queued.outputName,
        rootOutputName: queued.rootOutputName,
        version: queued.version,
      });
    }

    if (method === 'GET' && /^\/api\/projects\/[^/]+\/versions$/.test(url.pathname)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const rootOutputName = decodeURIComponent(parts[2] || '');
      if (!rootOutputName) return sendJson(res, 400, {error: 'root output name is required'});
      if (!isSafeOutputName(rootOutputName)) return sendJson(res, 400, {error: 'invalid root output name'});
      const policy = readProjectAutoPromotePolicy(rootOutputName);
      return sendJson(res, 200, {
        rootOutputName,
        promotionPolicy: policy,
        versions: listProjectVersions(rootOutputName),
      });
    }

    if (method === 'GET' && /^\/api\/projects\/[^/]+\/recommendation$/.test(url.pathname)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const rootOutputName = decodeURIComponent(parts[2] || '');
      if (!rootOutputName) return sendJson(res, 400, {error: 'root output name is required'});
      if (!isSafeOutputName(rootOutputName)) return sendJson(res, 400, {error: 'invalid root output name'});
      const recommendation = recommendProjectVersion(rootOutputName);
      return sendJson(res, 200, {
        rootOutputName,
        recommendation,
      });
    }

    if (method === 'GET' && /^\/api\/projects\/[^/]+\/audit$/.test(url.pathname)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const rootOutputName = decodeURIComponent(parts[2] || '');
      if (!rootOutputName) return sendJson(res, 400, {error: 'root output name is required'});
      if (!isSafeOutputName(rootOutputName)) return sendJson(res, 400, {error: 'invalid root output name'});
      const rawLimit = Number(url.searchParams.get('limit') || 50);
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, Math.floor(rawLimit))) : 50;
      const audit = readProjectAudit(rootOutputName);
      return sendJson(res, 200, {
        rootOutputName,
        updatedAt: audit.updatedAt,
        entries: audit.entries.slice(0, limit),
      });
    }

    if (method === 'GET' && /^\/api\/projects\/[^/]+\/promotion-policy$/.test(url.pathname)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const rootOutputName = decodeURIComponent(parts[2] || '');
      if (!rootOutputName) return sendJson(res, 400, {error: 'root output name is required'});
      if (!isSafeOutputName(rootOutputName)) return sendJson(res, 400, {error: 'invalid root output name'});
      return sendJson(res, 200, {
        rootOutputName,
        policy: readProjectAutoPromotePolicy(rootOutputName),
      });
    }

    if (method === 'POST' && /^\/api\/projects\/[^/]+\/promotion-policy$/.test(url.pathname)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const rootOutputName = decodeURIComponent(parts[2] || '');
      if (!rootOutputName) return sendJson(res, 400, {error: 'root output name is required'});
      if (!isSafeOutputName(rootOutputName)) return sendJson(res, 400, {error: 'invalid root output name'});
      const payload = await readJsonBody(req);
      const metadata = readVersionMetadata(rootOutputName);
      const previous = metadata.promotionPolicy.minConfidence;
      const next = normalizeAutoPromoteMinConfidence(payload.minConfidence, metadata.promotionPolicy.minConfidence);
      metadata.promotionPolicy = {
        minConfidence: next,
      };
      metadata.updatedAt = new Date().toISOString();
      writeVersionMetadata(rootOutputName, metadata);
      appendProjectAudit(rootOutputName, {
        type: 'autopromote-policy-updated',
        jobId: 'policy',
        sourceJobId: null,
        reason: `Auto-promote min confidence set to ${next.toFixed(2)}`,
        details: {
          previousMinConfidence: previous,
          minConfidence: next,
        },
      });
      return sendJson(res, 200, {
        rootOutputName,
        policy: metadata.promotionPolicy,
      });
    }

    if (method === 'POST' && /^\/api\/projects\/[^/]+\/promote$/.test(url.pathname)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const rootOutputName = decodeURIComponent(parts[2] || '');
      if (!rootOutputName) return sendJson(res, 400, {error: 'root output name is required'});
      if (!isSafeOutputName(rootOutputName)) return sendJson(res, 400, {error: 'invalid root output name'});
      const payload = await readJsonBody(req);
      const requestedJobId = String(payload.jobId || '').trim() || null;
      const promoted = promoteProjectWinner(rootOutputName, requestedJobId);
      if (!promoted.ok) {
        return sendJson(res, promoted.code, {error: promoted.error});
      }
      return sendJson(res, 200, {
        rootOutputName,
        promoted: promoted.promoted,
        metadata: promoted.metadata,
        versions: listProjectVersions(rootOutputName),
        recommendation: recommendProjectVersion(rootOutputName),
      });
    }

    if (method === 'POST' && /^\/api\/projects\/[^/]+\/version-meta$/.test(url.pathname)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const rootOutputName = decodeURIComponent(parts[2] || '');
      if (!rootOutputName) return sendJson(res, 400, {error: 'root output name is required'});
      if (!isSafeOutputName(rootOutputName)) return sendJson(res, 400, {error: 'invalid root output name'});
      const payload = await readJsonBody(req);
      const action = String(payload.action || '').trim();
      const actionNeedsJobId = new Set(['set-label', 'set-archived', 'set-pinned', 'set-outcome']);
      if (!actionNeedsJobId.has(action)) {
        return sendJson(res, 400, {error: 'action must be one of: set-label, set-archived, set-pinned, set-outcome'});
      }
      const jobId = String(payload.jobId || '').trim();
      if (!jobId) return sendJson(res, 400, {error: 'jobId is required'});
      const job = jobs.get(jobId);
      if (!job) return sendJson(res, 404, {error: 'job not found'});
      if (getRootOutputName(job) !== rootOutputName) {
        return sendJson(res, 400, {error: 'job does not belong to this project root'});
      }

      const metadata = readVersionMetadata(rootOutputName);
      const entry = metadata.entries[jobId] ?? {};

      if (action === 'set-label') {
        const label = String(payload.label || '').trim();
        entry.label = label || undefined;
      } else if (action === 'set-archived') {
        entry.archived = Boolean(payload.archived);
        if (entry.archived) {
          entry.pinned = false;
        }
      } else if (action === 'set-pinned') {
        const pinned = Boolean(payload.pinned);
        if (pinned) {
          for (const [id, item] of Object.entries(metadata.entries)) {
            metadata.entries[id] = {...item, pinned: false};
          }
        }
        entry.pinned = pinned;
        if (pinned) {
          entry.archived = false;
        }
      } else if (action === 'set-outcome') {
        const rawOutcome = String(payload.outcome || '').trim().toLowerCase();
        const note = String(payload.outcomeNote || '').trim();
        if (!rawOutcome) {
          entry.outcome = undefined;
          entry.outcomeAt = undefined;
          entry.outcomeNote = note || undefined;
        } else if (rawOutcome === 'accepted' || rawOutcome === 'rejected') {
          entry.outcome = rawOutcome;
          entry.outcomeAt = new Date().toISOString();
          entry.outcomeNote = note || undefined;
        } else {
          return sendJson(res, 400, {error: 'outcome must be accepted, rejected, or empty'});
        }
      } else {
        return sendJson(res, 400, {error: 'action must be one of: set-label, set-archived, set-pinned, set-outcome'});
      }

      metadata.entries[jobId] = entry;
      metadata.updatedAt = new Date().toISOString();
      writeVersionMetadata(rootOutputName, metadata);

      return sendJson(res, 200, {
        rootOutputName,
        updated: true,
        metadata,
        versions: listProjectVersions(rootOutputName),
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

      if (parts.length === 4 && parts[3] === 'improvement-plan') {
        const rawLimit = Number(url.searchParams.get('limit') || 3);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(5, Math.floor(rawLimit))) : 3;
        const plan = buildSectionImprovementPlan(job, limit);
        return sendJson(res, 200, plan);
      }

      if (parts.length === 4 && parts[3] === 'video') {
        const artifacts = artifactsFor(job);
        if (!artifacts.videoPath) return sendJson(res, 404, {error: 'video artifact missing'});
        return sendVideo(res, artifacts.videoPath);
      }

      if (parts.length === 4 && parts[3] === 'compare') {
        const otherId = String(url.searchParams.get('other') || '').trim();
        if (!otherId) return sendJson(res, 400, {error: 'other job id is required'});
        const otherJob = jobs.get(otherId);
        if (!otherJob) return sendJson(res, 404, {error: 'other job not found'});
        return sendJson(res, 200, compareJobs(job, otherJob));
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
  const rootOutputName = url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
  const outputName = rootOutputName;
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
      rootOutputName,
      version: 1,
    },
    logs: [],
  };
}

function createRerenderJob(
  sourceJob: JobRecord,
  scriptPath: string,
  payload: Record<string, unknown>,
  outputName: string,
  rootOutputName: string,
  version: number,
): JobRecord {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const quality = payload.quality === 'yc' ? 'yc' : sourceJob.options.quality;
  const voice = (['none', 'openai', 'elevenlabs', 'chatterbox'].includes(String(payload.voice))
    ? String(payload.voice)
    : sourceJob.options.voice) as JobRecord['options']['voice'];
  const strict = payload.strict === undefined ? sourceJob.options.strict : Boolean(payload.strict);
  const autoPromoteIfWinner = Boolean(payload.autoPromoteIfWinner);
  const projectPolicy = readProjectAutoPromotePolicy(rootOutputName);
  const autoPromoteMinConfidence = normalizeAutoPromoteMinConfidence(
    payload.autoPromoteMinConfidence,
    projectPolicy.minConfidence,
  );

  return {
    id,
    url: sourceJob.url,
    status: 'queued',
    createdAt: new Date().toISOString(),
    outputName,
    options: {
      mode: 'rerender',
      strict,
      quality,
      voice,
      skipRender: false,
      pack: sourceJob.options.pack,
      rootOutputName,
      version,
      scriptPath,
      sourceJobId: sourceJob.id,
      autoPromoteIfWinner,
      autoPromoteMinConfidence,
    },
    logs: [],
  };
}

function getRootOutputName(job: JobRecord): string {
  return job.options.rootOutputName || parseVersionedOutputName(job.outputName).rootOutputName;
}

function getVersion(job: JobRecord): number {
  return job.options.version || parseVersionedOutputName(job.outputName).version;
}

function parseVersionedOutputName(outputName: string): {rootOutputName: string; version: number} {
  const match = outputName.match(/^(.*)-v(\d+)$/);
  if (!match) {
    return {rootOutputName: outputName, version: 1};
  }
  return {
    rootOutputName: match[1],
    version: Number(match[2]) || 1,
  };
}

function outputNameForVersion(rootOutputName: string, version: number): string {
  return version <= 1 ? rootOutputName : `${rootOutputName}-v${version}`;
}

function nextVersionForRoot(rootOutputName: string): number {
  let maxVersion = 1;
  for (const job of jobs.values()) {
    if (getRootOutputName(job) !== rootOutputName) continue;
    maxVersion = Math.max(maxVersion, getVersion(job));
  }

  const escapedRoot = rootOutputName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const versionedRegex = new RegExp(`^${escapedRoot}-v(\\d+)-job\\.json$`);
  const baseRegex = new RegExp(`^${escapedRoot}-job\\.json$`);
  try {
    for (const name of fs.readdirSync(outDir)) {
      const vMatch = name.match(versionedRegex);
      if (vMatch) {
        maxVersion = Math.max(maxVersion, Number(vMatch[1]) || 1);
        continue;
      }
      if (baseRegex.test(name)) {
        maxVersion = Math.max(maxVersion, 1);
      }
    }
  } catch {
    // ignore readdir failures
  }

  return maxVersion + 1;
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

function queueVersionedRerenderFromScript(args: {
  job: JobRecord;
  script: ScriptResult;
  context: QualityContext;
  qualityReport: ReturnType<typeof scoreScriptQuality>;
  payload: Record<string, unknown>;
  generationMode: string;
  versioningSource: string;
}) {
  const {job, script, context, qualityReport, payload, generationMode, versioningSource} = args;
  const rootOutputName = getRootOutputName(job);
  const version = nextVersionForRoot(rootOutputName);
  const outputName = outputNameForVersion(rootOutputName, version);
  const versionedScriptPath = path.join(outDir, `${outputName}-script.json`);
  fs.writeFileSync(versionedScriptPath, JSON.stringify(toPersistedScript(script), null, 2));

  const versionedQualityPath = path.join(outDir, `${outputName}-quality.json`);
  fs.writeFileSync(
    versionedQualityPath,
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
        grounding: summarizeGroundingUsage(script, context.groundingHints),
        relevanceGuard: {
          enabled: false,
          applied: false,
          actions: [],
          warnings: [],
        },
        generationMode,
        qualityReport,
        versioning: {
          rootOutputName,
          version,
          sourceJobId: job.id,
          source: versioningSource,
        },
      },
      null,
      2,
    ),
  );

  const rerenderJob = createRerenderJob(
    job,
    versionedScriptPath,
    payload,
    outputName,
    rootOutputName,
    version,
  );
  jobs.set(rerenderJob.id, rerenderJob);
  queue.push(rerenderJob.id);
  persistJob(rerenderJob);
  appendLog(job, `[rerender] queued rerender job ${rerenderJob.id} (${outputName}) via ${versioningSource}`);
  appendProjectAudit(rootOutputName, {
    type: 'rerender-queued',
    jobId: rerenderJob.id,
    sourceJobId: job.id,
    reason: `Queued rerender via ${versioningSource}`,
    details: {
      outputName,
      version,
      generationMode,
      qualityScore: qualityReport.score,
      warningCount: qualityReport.warnings.length,
      blockerCount: qualityReport.blockers.length,
      strict: rerenderJob.options.strict,
      autoPromoteIfWinner: Boolean(rerenderJob.options.autoPromoteIfWinner),
      autoPromoteMinConfidence: rerenderJob.options.autoPromoteMinConfidence,
    },
  });
  tickQueue();

  return {
    rerenderJob,
    outputName,
    rootOutputName,
    version,
    versionedScriptPath,
    versionedQualityPath,
  };
}

function resolveAutoImproveConfig(
  payload: Record<string, unknown>,
  defaultStrict: boolean,
  defaultAutoPromoteMinConfidence: number,
): AutoImproveConfig {
  const strict = payload.strict === undefined ? defaultStrict : Boolean(payload.strict);
  const defaultMaxWarnings = strict ? 0 : 3;
  return {
    maxSteps: clampInt(payload.maxSteps, 1, 8, 3),
    targetScore: clampInt(payload.targetScore, 70, 100, 90),
    maxWarnings: clampInt(payload.maxWarnings, 0, 12, defaultMaxWarnings),
    strict,
    autofix: payload.autofix === undefined ? true : Boolean(payload.autofix),
    autoRerender: payload.autoRerender === undefined ? false : Boolean(payload.autoRerender),
    rerenderStrict: payload.rerenderStrict === undefined ? strict : Boolean(payload.rerenderStrict),
    autoPromoteIfWinner: payload.autoPromoteIfWinner === undefined
      ? Boolean(payload.autoRerender)
      : Boolean(payload.autoPromoteIfWinner),
    autoPromoteMinConfidence: normalizeAutoPromoteMinConfidence(
      payload.autoPromoteMinConfidence,
      defaultAutoPromoteMinConfidence,
    ),
  };
}

async function runAutoImproveLoop(
  job: JobRecord,
  config: AutoImproveConfig,
): Promise<
  | {
      ok: true;
      data: {
        id: string;
        mode: 'auto-improve';
        config: AutoImproveConfig;
        stopReason: string;
        initialQuality: ReturnType<typeof summarizeQualityReport>;
        finalQuality: ReturnType<typeof summarizeQualityReport>;
        iterations: AutoImproveIteration[];
        recommendations: SectionImprovementRecommendation[];
        rerender: {
          queued: boolean;
          reason: string;
          id: string | null;
          outputName: string | null;
          rootOutputName: string | null;
          version: number | null;
          autoPromoteIfWinner: boolean;
          autoPromoteMinConfidence: number;
        };
        quality: ReturnType<typeof qualitySummaryFor>;
        artifacts: ReturnType<typeof artifactsFor>;
      };
    }
  | {ok: false; code: number; error: string}
> {
  const artifacts = artifactsFor(job);
  if (!artifacts.scriptPath) {
    return {ok: false, code: 400, error: 'script artifact missing; run job first'};
  }

  const scriptRaw = safeReadJson(artifacts.scriptPath);
  if (!scriptRaw) {
    return {ok: false, code: 500, error: 'script artifact parse failed'};
  }
  let script = normalizeScriptPayload(scriptRaw);
  const existingQuality = artifacts.qualityPath ? safeReadJson(artifacts.qualityPath) : null;
  const context = await resolveQualityContext(job, script, existingQuality);
  let qualityReport = scoreScriptQuality({
    script,
    scraped: context.scraped,
    template: context.templateProfile,
    domainPack: context.domainPack,
    groundingHints: context.groundingHints,
    minScore: 80,
    maxWarnings: config.maxWarnings,
    failOnWarnings: config.strict,
  });

  const initialQuality = summarizeQualityReport(qualityReport);
  const iterations: AutoImproveIteration[] = [];
  const sectionAttempts = new Map<RegenerateSection, number>();
  let stalledSteps = 0;
  let stopReason = '';
  let rerenderResult: {
    queued: boolean;
    reason: string;
    id: string | null;
    outputName: string | null;
    rootOutputName: string | null;
    version: number | null;
    autoPromoteIfWinner: boolean;
    autoPromoteMinConfidence: number;
  } = {
    queued: false,
    reason: 'disabled',
    id: null,
    outputName: null,
    rootOutputName: null,
    version: null,
    autoPromoteIfWinner: config.autoPromoteIfWinner,
    autoPromoteMinConfidence: config.autoPromoteMinConfidence,
  };

  for (let step = 1; step <= config.maxSteps; step++) {
    if (meetsAutoImproveGoal(qualityReport, config)) {
      stopReason = step === 1 ? 'already-meets-target' : 'target-reached';
      break;
    }

    const plan = buildSectionImprovementPlan(job, 5, {
      script,
      quality: {qualityReport},
      sourceUrl: job.url,
    });
    const section = pickAutoImproveSection(plan.recommendations || [], sectionAttempts, 2);
    if (!section) {
      stopReason = 'sections-exhausted';
      break;
    }
    const recommendation = plan.recommendations.find((item) => item.section === section) || null;
    const before = summarizeQualityReport(qualityReport);
    const regenerated = regenerateScriptSection({
      script,
      section,
      scraped: context.scraped,
      domainPack: context.domainPack,
      groundingHints: context.groundingHints,
    });
    let nextScript = regenerated.script;
    let nextQuality = scoreScriptQuality({
      script: nextScript,
      scraped: context.scraped,
      template: context.templateProfile,
      domainPack: context.domainPack,
      groundingHints: context.groundingHints,
      minScore: 80,
      maxWarnings: config.maxWarnings,
      failOnWarnings: config.strict,
    });
    const actions = [...regenerated.actions];
    const autofixActions: string[] = [];
    let generationMode = `auto-improve:${section}:step-${step}`;
    if (config.autofix && !nextQuality.passed) {
      const fixed = autoFixScriptQuality(nextScript, context.scraped, context.domainPack, context.groundingHints);
      nextScript = fixed.script;
      autofixActions.push(...fixed.actions);
      if (fixed.actions.length > 0) {
        actions.push(...fixed.actions.map((item) => `autofix: ${item}`));
      }
      nextQuality = scoreScriptQuality({
        script: nextScript,
        scraped: context.scraped,
        template: context.templateProfile,
        domainPack: context.domainPack,
        groundingHints: context.groundingHints,
        minScore: 80,
        maxWarnings: config.maxWarnings,
        failOnWarnings: config.strict,
      });
      generationMode += '+autofix';
    }

    script = nextScript;
    qualityReport = nextQuality;
    writeScriptAndQualityArtifacts(job, script, context, qualityReport, generationMode, {
      source: 'auto-improve-loop',
      step,
      section,
      actions,
      config,
      recommendation,
      autofixActions,
    });

    const after = summarizeQualityReport(qualityReport);
    const improved = isQualityImproved(before, after);
    iterations.push({
      step,
      section,
      before,
      after,
      improved,
      reason: recommendation?.reasons?.[0] || 'No reason provided',
      planConfidence: recommendation?.confidence ?? 0,
      actions,
      autofixActions,
    });
    sectionAttempts.set(section, (sectionAttempts.get(section) || 0) + 1);
    appendLog(job, `[auto-improve] step ${step} section=${section} score ${before.score}->${after.score} warnings ${before.warnings}->${after.warnings}`);

    if (meetsAutoImproveGoal(qualityReport, config)) {
      stopReason = 'target-reached';
      break;
    }

    if (!improved) {
      stalledSteps += 1;
      if (stalledSteps >= 2) {
        stopReason = 'stalled-no-improvement';
        break;
      }
    } else {
      stalledSteps = 0;
    }
  }

  if (!stopReason) {
    stopReason = meetsAutoImproveGoal(qualityReport, config) ? 'target-reached' : 'max-steps-reached';
  }

  const goalMet = meetsAutoImproveGoal(qualityReport, config);
  if (config.autoRerender && goalMet) {
    const queued = queueVersionedRerenderFromScript({
      job,
      script,
      context,
      qualityReport,
      payload: {
        strict: config.rerenderStrict,
        quality: job.options.quality,
        voice: job.options.voice,
        autoPromoteIfWinner: config.autoPromoteIfWinner,
        autoPromoteMinConfidence: config.autoPromoteMinConfidence,
      },
      generationMode: 'auto-improve-validation',
      versioningSource: 'auto-improve',
    });
    rerenderResult = {
      queued: true,
      reason: 'queued-after-target',
      id: queued.rerenderJob.id,
      outputName: queued.outputName,
      rootOutputName: queued.rootOutputName,
      version: queued.version,
      autoPromoteIfWinner: config.autoPromoteIfWinner,
      autoPromoteMinConfidence: config.autoPromoteMinConfidence,
    };
  } else if (!config.autoRerender) {
    rerenderResult = {
      queued: false,
      reason: 'disabled',
      id: null,
      outputName: null,
      rootOutputName: null,
      version: null,
      autoPromoteIfWinner: config.autoPromoteIfWinner,
      autoPromoteMinConfidence: config.autoPromoteMinConfidence,
    };
  } else {
    rerenderResult = {
      queued: false,
      reason: 'target-not-reached',
      id: null,
      outputName: null,
      rootOutputName: null,
      version: null,
      autoPromoteIfWinner: config.autoPromoteIfWinner,
      autoPromoteMinConfidence: config.autoPromoteMinConfidence,
    };
  }

  persistJob(job);
  const finalPlan = buildSectionImprovementPlan(job, 3, {
    script,
    quality: {qualityReport},
    sourceUrl: job.url,
  });
  appendLog(
    job,
    `[auto-improve] finished: ${stopReason}; score=${qualityReport.score}; blockers=${qualityReport.blockers.length}; warnings=${qualityReport.warnings.length}; rerender=${rerenderResult.queued ? rerenderResult.id : rerenderResult.reason}`,
  );

  return {
    ok: true,
    data: {
      id: job.id,
      mode: 'auto-improve',
      config,
      stopReason,
      initialQuality,
      finalQuality: summarizeQualityReport(qualityReport),
      iterations,
      recommendations: finalPlan.recommendations || [],
      rerender: rerenderResult,
      quality: qualitySummaryFor(job),
      artifacts: artifactsFor(job),
    },
  };
}

function writeScriptAndQualityArtifacts(
  job: JobRecord,
  script: ScriptResult,
  context: QualityContext,
  qualityReport: ReturnType<typeof scoreScriptQuality>,
  generationMode: string,
  extra: Record<string, unknown>,
) {
  const artifacts = artifactsFor(job);
  if (artifacts.scriptPath) {
    fs.writeFileSync(artifacts.scriptPath, JSON.stringify(toPersistedScript(script), null, 2));
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
          grounding: summarizeGroundingUsage(script, context.groundingHints),
          relevanceGuard: {
            enabled: false,
            applied: false,
            actions: [],
            warnings: [],
          },
          generationMode,
          qualityReport,
          autoImprove: extra,
        },
        null,
        2,
      ),
    );
  }
}

function summarizeQualityReport(report: ReturnType<typeof scoreScriptQuality>) {
  return {
    score: report.score,
    blockers: report.blockers.length,
    warnings: report.warnings.length,
    passed: report.passed,
  };
}

function meetsAutoImproveGoal(
  report: ReturnType<typeof scoreScriptQuality>,
  config: AutoImproveConfig,
): boolean {
  return report.blockers.length === 0
    && report.score >= config.targetScore
    && report.warnings.length <= config.maxWarnings;
}

function isQualityImproved(
  before: ReturnType<typeof summarizeQualityReport>,
  after: ReturnType<typeof summarizeQualityReport>,
): boolean {
  if (after.blockers < before.blockers) return true;
  if (after.warnings < before.warnings) return true;
  if (after.score > before.score + 0.5) return true;
  if (!before.passed && after.passed) return true;
  return false;
}

function pickAutoImproveSection(
  recommendations: SectionImprovementRecommendation[],
  attempts: Map<RegenerateSection, number>,
  maxAttemptsPerSection: number,
): RegenerateSection | null {
  for (const recommendation of recommendations) {
    const used = attempts.get(recommendation.section) || 0;
    if (used < maxAttemptsPerSection) {
      return recommendation.section;
    }
  }
  return null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeAutoPromoteMinConfidence(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Number(Math.max(0, Math.min(1, fallback)).toFixed(2));
  }
  return Number(Math.max(0, Math.min(1, parsed)).toFixed(2));
}

function normalizeAutoPromotePolicy(input: unknown): AutoPromotePolicy {
  const source = input && typeof input === 'object'
    ? (input as {minConfidence?: unknown})
    : {};
  return {
    minConfidence: normalizeAutoPromoteMinConfidence(source.minConfidence, DEFAULT_AUTO_PROMOTE_MIN_CONFIDENCE),
  };
}

function tryAutoPromoteIfRerenderWinner(job: JobRecord, source: 'close' | 'watchdog' | 'startup' = 'close') {
  if (job.options.mode !== 'rerender') return;
  if (!job.options.autoPromoteIfWinner) return;
  if (job.options.autoPromoteEvaluatedAt) return;

  const now = new Date().toISOString();
  const rootOutputName = getRootOutputName(job);
  const projectPolicy = readProjectAutoPromotePolicy(rootOutputName);
  const minConfidence = normalizeAutoPromoteMinConfidence(
    job.options.autoPromoteMinConfidence,
    projectPolicy.minConfidence,
  );
  const sourceJobId = job.options.sourceJobId ?? null;
  const markEvaluation = (decision: string) => {
    job.options.autoPromoteDecision = decision;
    job.options.autoPromoteEvaluatedAt = now;
    persistJob(job);
  };

  if (job.status !== 'completed') {
    const reason = 'rerender did not complete successfully';
    appendLog(job, `[autopromote] skipped: ${reason}`);
    appendProjectAudit(rootOutputName, {
      type: 'autopromote-skipped',
      jobId: job.id,
      sourceJobId,
      reason,
      details: {status: job.status, source, minConfidence},
    });
    markEvaluation(`skipped:${reason}`);
    return;
  }

  const recommendation = recommendProjectVersion(rootOutputName);
  const recommendedId = recommendation.recommended?.id || null;
  const confidence = normalizeAutoPromoteMinConfidence(recommendation.recommended?.confidence, 0);
  if (!recommendedId) {
    const reason = 'no recommendation available';
    appendLog(job, `[autopromote] skipped: ${reason}`);
    appendProjectAudit(rootOutputName, {
      type: 'autopromote-skipped',
      jobId: job.id,
      sourceJobId,
      reason,
      details: {source, confidence, minConfidence},
    });
    markEvaluation(`skipped:${reason}`);
    return;
  }
  if (recommendedId !== job.id) {
    const reason = `winner is ${recommendedId}, not this rerender`;
    appendLog(job, `[autopromote] skipped: ${reason}`);
    appendProjectAudit(rootOutputName, {
      type: 'autopromote-skipped',
      jobId: job.id,
      sourceJobId,
      reason,
      details: {recommendedId, source, confidence, minConfidence},
    });
    markEvaluation(`skipped:${reason}`);
    return;
  }
  if (confidence < minConfidence) {
    const reason = `recommendation confidence ${confidence.toFixed(2)} below threshold ${minConfidence.toFixed(2)}`;
    appendLog(job, `[autopromote] skipped: ${reason}`);
    appendProjectAudit(rootOutputName, {
      type: 'autopromote-skipped',
      jobId: job.id,
      sourceJobId,
      reason,
      details: {source, confidence, minConfidence},
    });
    markEvaluation(`skipped:${reason}`);
    return;
  }

  const promoted = promoteProjectWinner(rootOutputName, job.id);
  if (!promoted.ok) {
    appendLog(job, `[autopromote] failed: ${promoted.error}`);
    appendProjectAudit(rootOutputName, {
      type: 'autopromote-failed',
      jobId: job.id,
      sourceJobId,
      reason: promoted.error,
      details: {source},
    });
    markEvaluation(`failed:${promoted.error}`);
    return;
  }
  appendLog(job, `[autopromote] promoted v${promoted.promoted.version} (${promoted.promoted.id})`);
  appendProjectAudit(rootOutputName, {
    type: 'autopromote-promoted',
    jobId: job.id,
    sourceJobId,
    reason: 'rerender became winner and was promoted',
    details: {
      promotedVersion: promoted.promoted.version,
      promotedId: promoted.promoted.id,
      source,
      confidence,
      minConfidence,
    },
  });
  markEvaluation('promoted');
  if (sourceJobId) {
    const sourceJob = jobs.get(sourceJobId);
    if (sourceJob) {
      appendLog(sourceJob, `[autopromote] promoted rerender winner ${promoted.promoted.id}`);
    }
  }
}

function evaluatePendingAutoPromoteJobs(source: 'watchdog' | 'startup') {
  for (const job of jobs.values()) {
    if (job.options.mode !== 'rerender') continue;
    if (!job.options.autoPromoteIfWinner) continue;
    if (job.options.autoPromoteEvaluatedAt) continue;
    if (job.status !== 'completed' && job.status !== 'failed') continue;
    tryAutoPromoteIfRerenderWinner(job, source);
  }
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
    tryAutoPromoteIfRerenderWinner(job);
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
  const artifacts = artifactsFor(job);
  return {
    ...job,
    rootOutputName: getRootOutputName(job),
    version: getVersion(job),
    queuePosition: job.status === 'queued' ? queue.indexOf(job.id) + 1 : 0,
    artifacts,
    videoUrl: artifacts.videoPath ? `/api/jobs/${job.id}/video` : null,
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
      blockerCount: null,
      warningCount: null,
      generationMode: null,
      template: null,
      domainPack: null,
      domainPackConfidence: null,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(qualityPath, 'utf-8')) as {
      generationMode?: string;
      template?: string;
      domainPack?: string;
      domainPackConfidence?: number;
      qualityReport?: {score?: number; passed?: boolean; blockers?: string[]; warnings?: string[]};
    };
    const blockers = Array.isArray(parsed.qualityReport?.blockers) ? parsed.qualityReport?.blockers ?? [] : [];
    const warnings = Array.isArray(parsed.qualityReport?.warnings) ? parsed.qualityReport?.warnings ?? [] : [];
    return {
      available: true,
      path: qualityPath,
      score: parsed.qualityReport?.score ?? null,
      passed: parsed.qualityReport?.passed ?? null,
      blockerCount: blockers.length,
      warningCount: warnings.length,
      generationMode: parsed.generationMode ?? null,
      template: parsed.template ?? null,
      domainPack: parsed.domainPack ?? null,
      domainPackConfidence: parsed.domainPackConfidence ?? null,
    };
  } catch {
    return {
      available: false,
      path: qualityPath,
      score: null,
      passed: null,
      blockerCount: null,
      warningCount: null,
      generationMode: null,
      template: null,
      domainPack: null,
      domainPackConfidence: null,
      error: 'quality file parse failed',
    };
  }
}

function metadataPathForRoot(rootOutputName: string): string {
  return path.join(outDir, `${rootOutputName}-version-meta.json`);
}

function readVersionMetadata(rootOutputName: string): VersionMetadata {
  const filePath = metadataPathForRoot(rootOutputName);
  const parsed = safeReadJson(filePath);
  if (parsed && typeof parsed === 'object' && typeof parsed.rootOutputName === 'string' && parsed.entries && typeof parsed.entries === 'object') {
    return {
      rootOutputName: String(parsed.rootOutputName),
      updatedAt: String(parsed.updatedAt || ''),
      entries: parsed.entries as Record<string, VersionMetaEntry>,
      promotionPolicy: normalizeAutoPromotePolicy((parsed as {promotionPolicy?: unknown}).promotionPolicy),
    };
  }
  return {
    rootOutputName,
    updatedAt: new Date(0).toISOString(),
    entries: {},
    promotionPolicy: normalizeAutoPromotePolicy(null),
  };
}

function writeVersionMetadata(rootOutputName: string, metadata: VersionMetadata) {
  const filePath = metadataPathForRoot(rootOutputName);
  fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));
}

function readProjectAutoPromotePolicy(rootOutputName: string): AutoPromotePolicy {
  const metadata = readVersionMetadata(rootOutputName);
  return metadata.promotionPolicy;
}

function auditPathForRoot(rootOutputName: string): string {
  return path.join(outDir, `${rootOutputName}-audit.json`);
}

function readProjectAudit(rootOutputName: string): ProjectAuditLog {
  const filePath = auditPathForRoot(rootOutputName);
  const parsed = safeReadJson(filePath);
  if (
    parsed
    && typeof parsed === 'object'
    && typeof parsed.rootOutputName === 'string'
    && Array.isArray(parsed.entries)
  ) {
    return {
      rootOutputName: String(parsed.rootOutputName),
      updatedAt: String(parsed.updatedAt || ''),
      entries: (parsed.entries as ProjectAuditEntry[])
        .filter((item) => item && typeof item === 'object' && typeof item.at === 'string' && typeof item.type === 'string')
        .sort((a, b) => b.at.localeCompare(a.at)),
    };
  }
  return {
    rootOutputName,
    updatedAt: new Date(0).toISOString(),
    entries: [],
  };
}

function writeProjectAudit(rootOutputName: string, audit: ProjectAuditLog) {
  const filePath = auditPathForRoot(rootOutputName);
  fs.writeFileSync(filePath, JSON.stringify(audit, null, 2));
}

function appendProjectAudit(rootOutputName: string, entry: Omit<ProjectAuditEntry, 'rootOutputName' | 'at'> & {at?: string}) {
  const audit = readProjectAudit(rootOutputName);
  const at = entry.at || new Date().toISOString();
  audit.entries.unshift({
    ...entry,
    rootOutputName,
    at,
  });
  if (audit.entries.length > 250) {
    audit.entries = audit.entries.slice(0, 250);
  }
  audit.updatedAt = at;
  writeProjectAudit(rootOutputName, audit);
}

function listProjectVersions(rootOutputName: string): ProjectVersion[] {
  const metadata = readVersionMetadata(rootOutputName);
  const items = [...jobs.values()]
    .filter((job) => getRootOutputName(job) === rootOutputName)
    .map((job) => {
      const artifacts = artifactsFor(job);
      const meta = metadata.entries[job.id] ?? {};
      return {
        id: job.id,
        outputName: job.outputName,
        rootOutputName,
        version: getVersion(job),
        status: job.status,
        mode: job.options.mode,
        createdAt: job.createdAt,
        finishedAt: job.finishedAt ?? null,
        quality: qualitySummaryFor(job),
        artifacts,
        videoUrl: artifacts.videoPath ? `/api/jobs/${job.id}/video` : null,
        meta: {
          label: meta.label ?? null,
          archived: Boolean(meta.archived),
          pinned: Boolean(meta.pinned),
          outcome: meta.outcome === 'accepted' || meta.outcome === 'rejected' ? meta.outcome : null,
          outcomeNote: meta.outcomeNote ?? null,
          outcomeAt: meta.outcomeAt ?? null,
          promotedAt: meta.promotedAt ?? null,
        },
      };
    })
    .sort((a, b) => b.version - a.version || b.createdAt.localeCompare(a.createdAt));
  return items;
}

function recommendProjectVersion(rootOutputName: string) {
  const versions = listProjectVersions(rootOutputName);
  const learning = buildOutcomeLearning();
  const activeVersions = versions.filter((item) => !item.meta.archived);
  if (activeVersions.length === 0) {
    return {
      recommended: null,
      ranking: [],
      reason: 'No active versions available.',
      learning: {
        totalOutcomes: learning.totalOutcomes,
      },
    };
  }

  const pinned = activeVersions.find((item) => item.meta.pinned);
  if (pinned) {
    const confidence = pinned.meta.outcome === 'rejected' ? 0.6 : 1;
    return {
      recommended: {
        id: pinned.id,
        version: pinned.version,
        outputName: pinned.outputName,
        composite: 999,
        confidence,
        rationale: [`Pinned by operator (status=${pinned.status})`],
      },
      ranking: activeVersions.map((item) => ({
        id: item.id,
        version: item.version,
        outputName: item.outputName,
        composite: item.id === pinned.id ? 999 : scoreVersionCandidate(item, learning).composite,
      })),
      reason: 'Pinned version takes precedence.',
      learning: {
        totalOutcomes: learning.totalOutcomes,
      },
    };
  }

  const scored = activeVersions
    .map((item) => {
      const score = scoreVersionCandidate(item, learning);
      return {
        id: item.id,
        version: item.version,
        outputName: item.outputName,
        composite: score.composite,
        rationale: score.rationale,
        outcome: item.meta.outcome,
      };
    })
    .sort((a, b) => b.composite - a.composite || b.version - a.version);

  const confidence = recommendationConfidence(scored, learning.totalOutcomes);
  const ranking = scored.map(({outcome: _outcome, ...item}) => item);
  const top = scored[0] ?? null;
  const recommended = top
    ? {
        id: top.id,
        version: top.version,
        outputName: top.outputName,
        composite: top.composite,
        confidence,
        rationale: top.rationale,
      }
    : null;
  return {
    recommended,
    ranking,
    reason: recommended
      ? `Selected highest composite score (${recommended.composite}) with confidence ${confidence}.`
      : 'No comparable versions found.',
    learning: {
      totalOutcomes: learning.totalOutcomes,
    },
  };
}

function scoreVersionCandidate(version: ProjectVersion, learning: OutcomeLearning) {
  let composite = Number(version.quality.score ?? 0);
  const rationale: string[] = [`base quality score=${version.quality.score ?? 0}`];

  if (version.quality.passed === true) {
    composite += 20;
    rationale.push('+20 quality pass bonus');
  } else {
    composite -= 20;
    rationale.push('-20 quality fail penalty');
  }

  if (typeof version.quality.blockerCount === 'number' && version.quality.blockerCount > 0) {
    const penalty = version.quality.blockerCount * 8;
    composite -= penalty;
    rationale.push(`-${penalty} blockers penalty`);
  }
  if (typeof version.quality.warningCount === 'number' && version.quality.warningCount > 0) {
    const penalty = version.quality.warningCount * 2;
    composite -= penalty;
    rationale.push(`-${penalty} warnings penalty`);
  }

  if (version.status !== 'completed') {
    composite -= 30;
    rationale.push('-30 non-completed penalty');
  }
  if (!version.artifacts.videoPath) {
    composite -= 25;
    rationale.push('-25 missing-video penalty');
  }
  if (version.mode === 'rerender') {
    composite += 1;
    rationale.push('+1 rerender iteration bonus');
  }
  const recency = Math.min(version.version, 8) * 0.75;
  composite += recency;
  rationale.push(`+${recency.toFixed(2)} recency bonus`);

  if (version.meta.label) {
    composite += 0.5;
    rationale.push('+0.5 labeled-version preference');
  }
  if (version.meta.promotedAt) {
    composite += 0.5;
    rationale.push('+0.5 prior promotion stability bonus');
  }

  if (version.meta.outcome === 'accepted') {
    composite += 18;
    rationale.push('+18 accepted-outcome bonus');
  } else if (version.meta.outcome === 'rejected') {
    composite -= 18;
    rationale.push('-18 rejected-outcome penalty');
  }

  const packKey = normalizeOutcomeKey(version.quality.domainPack);
  const templateKey = normalizeOutcomeKey(version.quality.template);
  if (packKey !== 'unknown' && templateKey !== 'unknown') {
    const pairLift = outcomeLift(learning.byPackTemplate.get(`${packKey}|${templateKey}`), 16);
    if (pairLift.evidence > 0) {
      composite += pairLift.adjustment;
      rationale.push(`${formatSigned(pairLift.adjustment)} historical pack+template lift (${Math.round(pairLift.rate * 100)}% over ${pairLift.evidence} outcomes)`);
    }
  }
  if (packKey !== 'unknown') {
    const packLift = outcomeLift(learning.byPack.get(packKey), 10);
    if (packLift.evidence > 0) {
      composite += packLift.adjustment;
      rationale.push(`${formatSigned(packLift.adjustment)} historical pack lift (${Math.round(packLift.rate * 100)}% over ${packLift.evidence} outcomes)`);
    }
  }
  if (templateKey !== 'unknown') {
    const templateLift = outcomeLift(learning.byTemplate.get(templateKey), 8);
    if (templateLift.evidence > 0) {
      composite += templateLift.adjustment;
      rationale.push(`${formatSigned(templateLift.adjustment)} historical template lift (${Math.round(templateLift.rate * 100)}% over ${templateLift.evidence} outcomes)`);
    }
  }

  composite = Number(composite.toFixed(2));
  return {composite, rationale};
}

function recommendationConfidence(
  scored: Array<{composite: number; outcome: VersionOutcome | null}>,
  totalOutcomes: number,
): number {
  if (scored.length === 0) return 0;
  const top = scored[0];
  const second = scored[1];
  const gap = second ? top.composite - second.composite : 12;
  const gapScore = clamp01((gap + 3) / 20);
  const evidenceScore = clamp01(totalOutcomes / 18);
  let confidence = 0.7 * gapScore + 0.3 * evidenceScore;
  if (top.outcome === 'accepted') confidence += 0.08;
  if (top.outcome === 'rejected') confidence -= 0.2;
  return Number(clamp01(confidence).toFixed(2));
}

function buildOutcomeLearning(): OutcomeLearning {
  const byPack = new Map<string, OutcomeCounts>();
  const byTemplate = new Map<string, OutcomeCounts>();
  const byPackTemplate = new Map<string, OutcomeCounts>();
  const metadataCache = new Map<string, VersionMetadata>();
  let totalOutcomes = 0;

  for (const job of jobs.values()) {
    const root = getRootOutputName(job);
    const metadata = metadataCache.get(root) ?? readVersionMetadata(root);
    if (!metadataCache.has(root)) metadataCache.set(root, metadata);
    const entry = metadata.entries[job.id];
    const outcome = entry?.outcome;
    if (outcome !== 'accepted' && outcome !== 'rejected') continue;
    const quality = qualitySummaryFor(job);
    const packKey = normalizeOutcomeKey(quality.domainPack);
    const templateKey = normalizeOutcomeKey(quality.template);
    totalOutcomes += 1;
    incrementOutcomeCounts(byPack, packKey, outcome);
    incrementOutcomeCounts(byTemplate, templateKey, outcome);
    incrementOutcomeCounts(byPackTemplate, `${packKey}|${templateKey}`, outcome);
  }

  return {
    totalOutcomes,
    byPack,
    byTemplate,
    byPackTemplate,
  };
}

function incrementOutcomeCounts(map: Map<string, OutcomeCounts>, key: string, outcome: VersionOutcome) {
  const existing = map.get(key) ?? {accepted: 0, rejected: 0};
  if (outcome === 'accepted') existing.accepted += 1;
  else existing.rejected += 1;
  map.set(key, existing);
}

function normalizeOutcomeKey(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'unknown';
}

function outcomeLift(counts: OutcomeCounts | undefined, weight: number) {
  const accepted = counts?.accepted ?? 0;
  const rejected = counts?.rejected ?? 0;
  const evidence = accepted + rejected;
  if (evidence === 0) {
    return {
      adjustment: 0,
      evidence: 0,
      rate: 0.5,
    };
  }
  const rate = (accepted + 1) / (accepted + rejected + 2);
  const lift = rate - 0.5;
  const evidenceWeight = Math.min(1, evidence / 6);
  const adjustment = Number((weight * lift * evidenceWeight).toFixed(2));
  return {
    adjustment,
    evidence,
    rate,
  };
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function formatSigned(value: number): string {
  const rounded = Number(value.toFixed(2));
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}

function promoteProjectWinner(
  rootOutputName: string,
  requestedJobId: string | null,
): {ok: true; promoted: {id: string; version: number; outputName: string}; metadata: VersionMetadata}
  | {ok: false; code: number; error: string} {
  const versions = listProjectVersions(rootOutputName);
  if (versions.length === 0) {
    return {ok: false, code: 404, error: 'no versions available for this project'};
  }

  let targetId = requestedJobId;
  if (!targetId) {
    const recommendation = recommendProjectVersion(rootOutputName);
    if (!recommendation.recommended?.id) {
      return {ok: false, code: 409, error: 'no promotable recommendation available'};
    }
    targetId = recommendation.recommended.id;
  }

  const target = versions.find((item) => item.id === targetId);
  if (!target) {
    return {ok: false, code: 404, error: 'target version not found'};
  }
  if (target.status !== 'completed') {
    return {ok: false, code: 409, error: 'target version is not completed'};
  }
  if (!target.artifacts.videoPath) {
    return {ok: false, code: 409, error: 'target version has no rendered video to promote'};
  }

  const metadata = readVersionMetadata(rootOutputName);
  for (const [id, item] of Object.entries(metadata.entries)) {
    metadata.entries[id] = {...item, pinned: false};
  }
  const now = new Date().toISOString();
  const next = metadata.entries[target.id] ?? {};
  next.pinned = true;
  next.archived = false;
  next.promotedAt = now;
  if (!next.label) next.label = 'publish-candidate';
  if (!next.outcome) {
    next.outcome = 'accepted';
    next.outcomeAt = now;
  }
  metadata.entries[target.id] = next;
  metadata.updatedAt = now;
  writeVersionMetadata(rootOutputName, metadata);

  return {
    ok: true,
    promoted: {
      id: target.id,
      version: target.version,
      outputName: target.outputName,
    },
    metadata,
  };
}

function buildSectionImprovementPlan(
  job: JobRecord,
  limit = 3,
  input?: {
    script?: ScriptResult | null;
    quality?: {
      qualityReport?: {score?: number; passed?: boolean; blockers?: string[]; warnings?: string[]};
      template?: string;
      domainPack?: string;
    } | null;
    sourceUrl?: string;
  },
) {
  const artifacts = artifactsFor(job);
  const script = input?.script ?? loadScriptFromArtifact(artifacts.scriptPath);
  if (!script) {
    return {
      jobId: job.id,
      outputName: job.outputName,
      available: false,
      reason: 'Script artifact missing; run the job first.',
      recommendations: [] as SectionImprovementRecommendation[],
    };
  }

  const quality = input?.quality ?? readQualityArtifact(job);
  const scoreMap = new Map<RegenerateSection, {score: number; reasons: Set<string>}>();
  for (const section of REGENERATE_SECTIONS) {
    scoreMap.set(section, {score: 0, reasons: new Set()});
  }
  const add = (section: RegenerateSection, points: number, reason: string) => {
    const entry = scoreMap.get(section);
    if (!entry) return;
    entry.score += points;
    entry.reasons.add(reason);
  };

  const report = quality?.qualityReport;
  for (const blocker of report?.blockers ?? []) {
    for (const section of inferSectionsFromIssue(blocker)) {
      add(section, 12, `Blocker: ${blocker}`);
    }
  }
  for (const warning of report?.warnings ?? []) {
    for (const section of inferSectionsFromIssue(warning)) {
      add(section, 6, `Warning: ${warning}`);
    }
  }

  const hookParts = [script.hookLine1, script.hookLine2, script.hookKeyword].map((value) => String(value || '').trim());
  const invalidHookLines = hookParts.filter((part) => {
    const words = countWords(part);
    return words < 2 || words > 4;
  }).length;
  if (invalidHookLines > 0) add('hook', invalidHookLines * 4, `${invalidHookLines} hook line(s) outside 2-4 words.`);
  const hookCorpus = hookParts.join(' ');
  if (/right now|game changer|next level|all in one|revolutionary/i.test(hookCorpus)) {
    add('hook', 4, 'Hook uses generic hype language.');
  }
  if (!script.narrationSegments[0] || !script.narrationSegments[1] || !script.narrationSegments[2]) {
    add('hook', 8, 'Opening narration segments are incomplete.');
  }

  if (!script.ctaUrl) {
    add('cta', 12, 'CTA URL is missing.');
  } else {
    const ctaDomain = domainHost(script.ctaUrl);
    const sourceDomain = domainHost(input?.sourceUrl || job.url);
    if (ctaDomain && sourceDomain && !ctaDomain.includes(sourceDomain) && !sourceDomain.includes(ctaDomain)) {
      add('cta', 8, `CTA domain (${ctaDomain}) differs from source (${sourceDomain}).`);
    }
  }
  if (!script.narrationSegments[7]) {
    add('cta', 6, 'Closing narration segment is missing.');
  }

  const seenFeatureNames = new Set<string>();
  for (let i = 0; i < 3; i++) {
    const section = i === 0 ? 'feature1' : i === 1 ? 'feature2' : 'feature3';
    const feature = script.features[i];
    if (!feature) {
      add(section, 12, `Feature ${i + 1} block is missing.`);
      continue;
    }
    const appName = normalizeText(feature.appName);
    if (!feature.appName) add(section, 9, `Feature ${i + 1} app name is empty.`);
    if (!feature.caption) add(section, 5, `Feature ${i + 1} caption is empty.`);
    if (seenFeatureNames.has(appName) && appName) add(section, 5, `Feature ${i + 1} app name duplicates another feature.`);
    if (appName) seenFeatureNames.add(appName);
    if (!Array.isArray(feature.demoLines) || feature.demoLines.length === 0) {
      add(section, 10, `Feature ${i + 1} has no demo lines.`);
    } else {
      const joined = feature.demoLines.join(' ');
      if (countWords(joined) < 6) add(section, 4, `Feature ${i + 1} demo content is thin.`);
      if (!/\d/.test(joined)) add(section, 2, `Feature ${i + 1} demo has no numeric signal.`);
    }
    const narration = script.narrationSegments[3 + i] ?? '';
    if (appName && !normalizeText(narration).includes(appName.slice(0, Math.max(3, appName.length - 2)))) {
      add(section, 3, `Narration segment ${4 + i} weakly references feature ${i + 1}.`);
    }
  }

  if (!report && job.status === 'completed') {
    add('hook', 2, 'No quality report found; run Quality Check and improve hook first.');
  }

  const ranked = [...scoreMap.entries()]
    .map(([section, value]) => ({section, score: value.score, reasons: [...value.reasons]}))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || REGENERATE_SECTIONS.indexOf(a.section) - REGENERATE_SECTIONS.indexOf(b.section));

  const fallback = ranked.length === 0
    ? [{
        section: 'hook' as RegenerateSection,
        score: 1,
        reasons: ['No major issues detected. Optional polish starts with hook refresh.'],
      }]
    : ranked;
  const maxScore = Math.max(...fallback.map((item) => item.score), 1);
  const recommendations: SectionImprovementRecommendation[] = fallback
    .slice(0, limit)
    .map((item) => ({
      section: item.section,
      priority: item.score,
      confidence: Number(clamp01(item.score / maxScore).toFixed(2)),
      impact: item.score >= 18 ? 'high' : item.score >= 10 ? 'medium' : 'low',
      reasons: item.reasons.slice(0, 4),
    }));

  return {
    jobId: job.id,
    outputName: job.outputName,
    status: job.status,
    quality: {
      score: report?.score ?? null,
      passed: report?.passed ?? null,
      blockerCount: Array.isArray(report?.blockers) ? report!.blockers.length : 0,
      warningCount: Array.isArray(report?.warnings) ? report!.warnings.length : 0,
    },
    recommendations,
  };
}

function readQualityArtifact(job: JobRecord):
  | {
      qualityReport?: {score?: number; passed?: boolean; blockers?: string[]; warnings?: string[]};
      template?: string;
      domainPack?: string;
    }
  | null {
  const artifacts = artifactsFor(job);
  if (!artifacts.qualityPath) return null;
  const parsed = safeReadJson(artifacts.qualityPath);
  if (!parsed || typeof parsed !== 'object') return null;
  return parsed as {
    qualityReport?: {score?: number; passed?: boolean; blockers?: string[]; warnings?: string[]};
    template?: string;
    domainPack?: string;
  };
}

function inferSectionsFromIssue(issue: string): RegenerateSection[] {
  const text = String(issue || '').toLowerCase();
  const sections = new Set<RegenerateSection>();

  if (text.includes('hook') || text.includes('wordmark narration') || /narration segment [123]\b/.test(text)) {
    sections.add('hook');
  }
  if (text.includes('cta') || text.includes('closing narration')) {
    sections.add('cta');
  }
  if (/feature 1\b/.test(text)) sections.add('feature1');
  if (/feature 2\b/.test(text)) sections.add('feature2');
  if (/feature 3\b/.test(text)) sections.add('feature3');

  if (
    text.includes('feature "') ||
    text.includes('feature app names') ||
    text.includes('feature blocks') ||
    text.includes('feature demos') ||
    text.includes('script must contain exactly 3 features')
  ) {
    sections.add('feature1');
    sections.add('feature2');
    sections.add('feature3');
  }

  if (
    text.includes('narration must contain exactly 8 scene segments') ||
    text.includes('placeholder content')
  ) {
    sections.add('hook');
    sections.add('feature1');
    sections.add('feature2');
    sections.add('feature3');
    sections.add('cta');
  }

  if (
    text.includes('grounding') ||
    text.includes('source language') ||
    text.includes('numeric signals') ||
    text.includes('domain mismatch term')
  ) {
    sections.add('feature1');
    sections.add('feature2');
    sections.add('feature3');
    sections.add('hook');
  }

  if (sections.size === 0) {
    sections.add('hook');
  }
  return [...sections];
}

function domainHost(value: string): string {
  try {
    const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(normalized).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizeText(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function compareJobs(left: JobRecord, right: JobRecord) {
  const leftArtifacts = artifactsFor(left);
  const rightArtifacts = artifactsFor(right);
  const leftQuality = qualitySummaryFor(left);
  const rightQuality = qualitySummaryFor(right);
  const leftScript = loadScriptFromArtifact(leftArtifacts.scriptPath);
  const rightScript = loadScriptFromArtifact(rightArtifacts.scriptPath);

  const leftFeatures = leftScript?.features?.map((feature) => feature.appName) ?? [];
  const rightFeatures = rightScript?.features?.map((feature) => feature.appName) ?? [];
  const leftIntegrations = new Set(leftScript?.integrations ?? []);
  const rightIntegrations = new Set(rightScript?.integrations ?? []);
  const sharedIntegrations = [...leftIntegrations].filter((item) => rightIntegrations.has(item));

  return {
    left: {
      id: left.id,
      outputName: left.outputName,
      rootOutputName: getRootOutputName(left),
      version: getVersion(left),
      quality: leftQuality,
      videoUrl: leftArtifacts.videoPath ? `/api/jobs/${left.id}/video` : null,
    },
    right: {
      id: right.id,
      outputName: right.outputName,
      rootOutputName: getRootOutputName(right),
      version: getVersion(right),
      quality: rightQuality,
      videoUrl: rightArtifacts.videoPath ? `/api/jobs/${right.id}/video` : null,
    },
    diff: {
      scoreDelta: (rightQuality.score ?? 0) - (leftQuality.score ?? 0),
      passTransition: `${String(leftQuality.passed)} -> ${String(rightQuality.passed)}`,
      packTransition: `${leftQuality.domainPack ?? 'n/a'} -> ${rightQuality.domainPack ?? 'n/a'}`,
      hookChanged: leftScript && rightScript
        ? leftScript.hookLine1 !== rightScript.hookLine1
          || leftScript.hookLine2 !== rightScript.hookLine2
          || leftScript.hookKeyword !== rightScript.hookKeyword
        : null,
      ctaChanged: leftScript && rightScript ? leftScript.ctaUrl !== rightScript.ctaUrl : null,
      featureNameChanges: compareLists(leftFeatures, rightFeatures),
      narrationWordDelta: leftScript && rightScript
        ? countWords(leftScript.narrationSegments.join(' ')) - countWords(rightScript.narrationSegments.join(' '))
        : null,
      sharedIntegrationsCount: sharedIntegrations.length,
      sharedIntegrations: sharedIntegrations.slice(0, 12),
    },
  };
}

function compareLists(left: string[], right: string[]) {
  const max = Math.max(left.length, right.length);
  const changes: Array<{slot: number; from: string; to: string}> = [];
  for (let i = 0; i < max; i++) {
    const from = left[i] ?? '';
    const to = right[i] ?? '';
    if (from !== to) {
      changes.push({slot: i + 1, from, to});
    }
  }
  return changes;
}

function loadScriptFromArtifact(scriptPath: string | null): ScriptResult | null {
  if (!scriptPath) return null;
  const parsed = safeReadJson(scriptPath);
  if (!parsed) return null;
  try {
    return normalizeScriptPayload(parsed);
  } catch {
    return null;
  }
}

function sendVideo(res: http.ServerResponse, videoPath: string) {
  if (!fs.existsSync(videoPath)) {
    return sendJson(res, 404, {error: 'video artifact missing'});
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(videoPath).pipe(res);
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function isSafeOutputName(value: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(value);
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

function loadPersistedJobs() {
  try {
    const files = fs.readdirSync(jobsDir).filter((name) => name.endsWith('.json'));
    for (const file of files) {
      const full = path.join(jobsDir, file);
      const parsed = safeReadJson(full);
      if (!parsed || typeof parsed !== 'object') continue;
      const raw = parsed as JobRecord;
      if (!raw.id || !raw.outputName || !raw.options) continue;
      const rootOutputName = raw.options.rootOutputName || parseVersionedOutputName(raw.outputName).rootOutputName;
      const version = raw.options.version || parseVersionedOutputName(raw.outputName).version;
      const status = raw.status === 'running' || raw.status === 'queued' ? 'failed' : raw.status;
      const recovered: JobRecord = {
        ...raw,
        status,
        options: {
          ...raw.options,
          rootOutputName,
          version,
        },
      };
      if (status === 'failed' && !recovered.error && (raw.status === 'running' || raw.status === 'queued')) {
        recovered.error = 'Recovered after server restart.';
      }
      jobs.set(recovered.id, recovered);
    }
  } catch {
    // best-effort restore only
  }
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
    .versions-list { border: 1px solid #e5e7eb; border-radius: 10px; padding: 8px; background: #fcfcfc; max-height: 210px; overflow: auto; font-size: 12px; }
    .version-item { padding: 6px 8px; border-bottom: 1px solid #eee; display:flex; justify-content: space-between; gap: 8px; align-items: center; }
    .version-item:last-child { border-bottom: none; }
    .video-grid { display:grid; grid-template-columns: 1fr; gap: 8px; }
    .video-card { border:1px solid #e5e7eb; border-radius:10px; padding:8px; background:#fcfcfc; }
    .video-card video { width:100%; border-radius:8px; background:#000; min-height: 140px; }
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
          <div class="field">
            <label>Project Root</label>
            <input id="rootOutputName" type="text" readonly />
          </div>
          <div class="row">
            <button id="refreshVersions" class="secondary">Refresh Versions</button>
            <button id="recommendBest" class="secondary">Recommend Best</button>
            <button id="promoteWinner">Promote Winner</button>
          </div>
          <div class="row">
            <button id="recommendFixes" class="secondary">Recommend Next Fixes</button>
            <button id="applyTopFix" class="secondary">Apply Top Fix</button>
          </div>
          <div class="row">
            <input id="autoMaxSteps" type="number" min="1" max="8" value="3" style="width:90px" title="Max auto steps" />
            <input id="autoTargetScore" type="number" min="70" max="100" value="90" style="width:110px" title="Target score" />
            <input id="autoMaxWarnings" type="number" min="0" max="12" value="1" style="width:120px" title="Max warnings" />
            <input id="autoPromoteMinConfidence" type="number" min="0" max="1" step="0.05" value="0.75" style="width:150px" title="Auto promote min confidence" />
            <select id="autoAutofix">
              <option value="true">autofix on</option>
              <option value="false">autofix off</option>
            </select>
            <select id="autoRerender">
              <option value="false">no auto rerender</option>
              <option value="true">auto rerender on target</option>
            </select>
            <select id="autoRerenderStrict">
              <option value="true">rerender strict</option>
              <option value="false">rerender standard</option>
            </select>
            <select id="autoPromoteIfWinner">
              <option value="true">auto promote if winner</option>
              <option value="false">no auto promote</option>
            </select>
            <button id="runAutoImprove" class="secondary">Run Auto Improve</button>
          </div>
          <div class="row">
            <button id="savePromotionPolicy" class="secondary">Save Promote Policy</button>
            <button id="loadPromotionPolicy" class="secondary">Load Promote Policy</button>
          </div>
          <div id="promotionPolicyBox" class="quality-box muted">No promotion policy loaded.</div>
          <div id="fixPlanBox" class="quality-box muted">No section improvement plan yet.</div>
          <div id="autoImproveBox" class="quality-box muted">No auto-improve run yet.</div>
          <div class="row">
            <button id="refreshAudit" class="secondary">Refresh Audit</button>
          </div>
          <div id="auditBox" class="quality-box muted">No automation audit yet.</div>
          <div id="versionsList" class="versions-list muted">No versions loaded yet.</div>
          <div id="recommendationBox" class="quality-box muted">No recommendation yet.</div>
          <div class="field">
            <label>Manage Version (Job ID)</label>
            <select id="metaTarget"></select>
          </div>
          <div class="field">
            <label>Version Label</label>
            <input id="metaLabel" type="text" placeholder="e.g. publish-candidate" />
          </div>
          <div class="field">
            <label>Outcome</label>
            <select id="metaOutcome">
              <option value="">unrated</option>
              <option value="accepted">accepted</option>
              <option value="rejected">rejected</option>
            </select>
          </div>
          <div class="field">
            <label>Outcome Note</label>
            <input id="metaOutcomeNote" type="text" placeholder="optional context" />
          </div>
          <div class="row">
            <button id="saveLabel" class="secondary">Save Label</button>
            <button id="saveOutcome" class="secondary">Save Outcome</button>
            <button id="toggleArchive" class="secondary">Toggle Archive</button>
            <button id="togglePin" class="secondary">Toggle Pin</button>
          </div>
          <div class="field">
            <label>Compare Left Job ID</label>
            <select id="compareLeft"></select>
          </div>
          <div class="field">
            <label>Compare Right Job ID</label>
            <select id="compareRight"></select>
          </div>
          <button id="runCompare" class="secondary">Run Compare</button>
          <div id="compareBox" class="quality-box muted">No compare run yet.</div>
          <div class="video-grid">
            <div class="video-card">
              <div class="hint">Left version preview</div>
              <video id="videoLeft" controls></video>
            </div>
            <div class="video-card">
              <div class="hint">Right version preview</div>
              <video id="videoRight" controls></video>
            </div>
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
  const rootOutputField = document.getElementById('rootOutputName');
  const versionsList = document.getElementById('versionsList');
  const recommendationBox = document.getElementById('recommendationBox');
  const promotionPolicyBox = document.getElementById('promotionPolicyBox');
  const fixPlanBox = document.getElementById('fixPlanBox');
  const autoImproveBox = document.getElementById('autoImproveBox');
  const auditBox = document.getElementById('auditBox');
  const metaTarget = document.getElementById('metaTarget');
  const metaLabel = document.getElementById('metaLabel');
  const metaOutcome = document.getElementById('metaOutcome');
  const metaOutcomeNote = document.getElementById('metaOutcomeNote');
  const compareLeft = document.getElementById('compareLeft');
  const compareRight = document.getElementById('compareRight');
  const compareBox = document.getElementById('compareBox');
  const videoLeft = document.getElementById('videoLeft');
  const videoRight = document.getElementById('videoRight');
  let timer = null;
  let currentId = null;
  let currentScript = null;
  let currentRootOutputName = '';
  let currentVersions = [];
  let currentRecommendation = null;
  let currentFixPlan = null;
  let currentPromotionPolicy = null;

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

  function readAutoPromoteMinConfidenceInput() {
    const raw = Number(byId('autoPromoteMinConfidence').value);
    if (!Number.isFinite(raw)) return 0.75;
    return Math.max(0, Math.min(1, Math.round(raw * 100) / 100));
  }

  function renderPromotionPolicy(policy, sourceText) {
    if (!policy || typeof policy.minConfidence !== 'number') {
      currentPromotionPolicy = null;
      promotionPolicyBox.className = 'quality-box muted';
      promotionPolicyBox.textContent = 'No promotion policy loaded.';
      return;
    }
    currentPromotionPolicy = policy;
    byId('autoPromoteMinConfidence').value = String(policy.minConfidence.toFixed(2));
    promotionPolicyBox.className = 'quality-box';
    promotionPolicyBox.textContent = [
      'Auto-promote min confidence: ' + policy.minConfidence.toFixed(2),
      sourceText || 'Policy source: project setting',
    ].join('\\n');
  }

  function setCurrentRoot(rootOutputName) {
    currentRootOutputName = String(rootOutputName || '').trim();
    rootOutputField.value = currentRootOutputName;
  }

  function renderVersionOptions(versions) {
    const options = versions.map((item) => {
      const flags = []
      if (item.meta && item.meta.pinned) flags.push('pinned');
      if (item.meta && item.meta.archived) flags.push('archived');
      if (item.meta && item.meta.outcome) flags.push(item.meta.outcome);
      if (item.meta && item.meta.promotedAt) flags.push('promoted');
      if (item.meta && item.meta.label) flags.push(item.meta.label);
      const suffix = flags.length > 0 ? ' [' + flags.join(', ') + ']' : '';
      return '<option value=\"' + item.id + '\">v' + item.version + ' · ' + item.id + suffix + '</option>';
    });
    compareLeft.innerHTML = options.join('');
    compareRight.innerHTML = options.join('');
    metaTarget.innerHTML = options.join('');
    if (versions.length >= 2) {
      compareLeft.value = versions[0].id;
      compareRight.value = versions[1].id;
      metaTarget.value = versions[0].id;
    } else if (versions.length === 1) {
      compareLeft.value = versions[0].id;
      compareRight.value = versions[0].id;
      metaTarget.value = versions[0].id;
    }
    syncMetaForm();
  }

  function renderVersionsList(versions) {
    currentVersions = versions;
    if (!Array.isArray(versions) || versions.length === 0) {
      versionsList.className = 'versions-list muted';
      versionsList.textContent = 'No versions yet.';
      renderVersionOptions([]);
      return;
    }
    versionsList.className = 'versions-list';
    versionsList.innerHTML = versions
      .map((item) => {
        const statusBadge = item.status === 'completed'
          ? '<span class=\"ok\">completed</span>'
          : item.status === 'failed'
            ? '<span class=\"bad\">failed</span>'
            : '<span class=\"muted\">' + item.status + '</span>';
        const tags = [];
        if (item.meta && item.meta.pinned) tags.push('pinned');
        if (item.meta && item.meta.archived) tags.push('archived');
        if (item.meta && item.meta.promotedAt) tags.push('promoted');
        if (item.meta && item.meta.outcome) tags.push('outcome:' + item.meta.outcome);
        if (item.meta && item.meta.label) tags.push('label:' + item.meta.label);
        const tagLine = tags.length > 0 ? '<span class=\"hint\">' + tags.join(' · ') + '</span>' : '';
        return '<div class=\"version-item\">'
          + '<div><strong>v' + item.version + '</strong> · ' + item.id + '<br/><span class=\"muted\">' + item.outputName + '</span><br/>' + tagLine + '</div>'
          + '<div>' + statusBadge + '</div>'
          + '</div>';
      })
      .join('');
    renderVersionOptions(versions);
  }

  async function refreshVersions() {
    if (!currentRootOutputName) {
      versionsList.className = 'versions-list muted';
      versionsList.textContent = 'No project root selected yet.';
      renderVersionOptions([]);
      renderPromotionPolicy(null, '');
      return;
    }
    const res = await fetch('/api/projects/' + encodeURIComponent(currentRootOutputName) + '/versions');
    const data = await res.json();
    if (!res.ok) {
      versionsList.className = 'versions-list bad';
      versionsList.textContent = data.error || 'Failed to load versions';
      return;
    }
    if (data.promotionPolicy) {
      renderPromotionPolicy(data.promotionPolicy, 'Policy source: versions snapshot');
    } else {
      await fetchPromotionPolicy();
    }
    renderVersionsList(data.versions || []);
  }

  async function fetchRecommendation() {
    if (!currentRootOutputName) {
      currentRecommendation = null;
      recommendationBox.className = 'quality-box muted';
      recommendationBox.textContent = 'No project root selected yet.';
      return null;
    }
    const res = await fetch('/api/projects/' + encodeURIComponent(currentRootOutputName) + '/recommendation');
    const data = await res.json();
    if (!res.ok) {
      currentRecommendation = null;
      recommendationBox.className = 'quality-box bad';
      recommendationBox.textContent = data.error || 'Recommendation failed';
      return null;
    }
    const rec = data.recommendation || {};
    currentRecommendation = rec;
    if (!rec.recommended) {
      recommendationBox.className = 'quality-box muted';
      recommendationBox.textContent = rec.reason || 'No recommendation available.';
      return data;
    }
    const lines = [
      'Recommended: v' + rec.recommended.version + ' · ' + rec.recommended.id,
      'Output: ' + rec.recommended.outputName,
      'Composite: ' + rec.recommended.composite,
      'Confidence: ' + (rec.recommended.confidence == null ? 'n/a' : rec.recommended.confidence),
      'Learning outcomes: ' + (((rec.learning && rec.learning.totalOutcomes) || 0)),
      'Why: ' + (rec.reason || ''),
    ];
    if (Array.isArray(rec.recommended.rationale) && rec.recommended.rationale.length > 0) {
      lines.push('Rationale:');
      rec.recommended.rationale.forEach((item) => lines.push('  - ' + item));
    }
    recommendationBox.className = 'quality-box ok';
    recommendationBox.textContent = lines.join('\\n');
    const best = versionById(rec.recommended.id);
    if (best) {
      compareRight.value = best.id;
      const leftCandidate = currentVersions.find((item) => item.id !== best.id) || best;
      compareLeft.value = leftCandidate.id;
      if (best.videoUrl) videoRight.src = best.videoUrl;
      if (leftCandidate.videoUrl) videoLeft.src = leftCandidate.videoUrl;
    }
    setOutput(data);
    return data;
  }

  async function fetchPromotionPolicy() {
    if (!currentRootOutputName) {
      renderPromotionPolicy(null, '');
      return null;
    }
    const res = await fetch('/api/projects/' + encodeURIComponent(currentRootOutputName) + '/promotion-policy');
    const data = await res.json();
    if (!res.ok) {
      promotionPolicyBox.className = 'quality-box bad';
      promotionPolicyBox.textContent = data.error || 'Promotion policy fetch failed';
      return null;
    }
    renderPromotionPolicy(data.policy, 'Policy source: project setting');
    return data;
  }

  async function savePromotionPolicy() {
    if (!currentRootOutputName) {
      setStatus('No project root selected', 'bad');
      return null;
    }
    const minConfidence = readAutoPromoteMinConfidenceInput();
    const res = await fetch('/api/projects/' + encodeURIComponent(currentRootOutputName) + '/promotion-policy', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({minConfidence})
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus('Save promotion policy failed', 'bad');
      promotionPolicyBox.className = 'quality-box bad';
      promotionPolicyBox.textContent = data.error || 'Save promotion policy failed';
      setOutput(data);
      return null;
    }
    renderPromotionPolicy(data.policy, 'Policy source: saved to project');
    setStatus('Promotion policy saved', 'ok');
    setOutput(data);
    await fetchAudit();
    return data;
  }

  async function fetchAudit() {
    if (!currentRootOutputName) {
      auditBox.className = 'quality-box muted';
      auditBox.textContent = 'No project root selected yet.';
      return null;
    }
    const res = await fetch('/api/projects/' + encodeURIComponent(currentRootOutputName) + '/audit?limit=20');
    const data = await res.json();
    if (!res.ok) {
      auditBox.className = 'quality-box bad';
      auditBox.textContent = data.error || 'Audit fetch failed';
      return null;
    }
    const entries = Array.isArray(data.entries) ? data.entries : [];
    if (entries.length === 0) {
      auditBox.className = 'quality-box muted';
      auditBox.textContent = 'No automation audit yet.';
      return data;
    }
    const lines = entries.slice(0, 8).map((item, idx) => {
      const when = String(item.at || '').replace('T', ' ').replace('Z', 'Z');
      const source = item.sourceJobId ? (' source=' + item.sourceJobId) : '';
      return (idx + 1) + '. [' + when + '] ' + item.type + ' job=' + item.jobId + source + ' :: ' + item.reason;
    });
    auditBox.className = 'quality-box';
    auditBox.textContent = lines.join('\\n');
    return data;
  }

  async function fetchImprovementPlan() {
    if (!currentId) {
      currentFixPlan = null;
      fixPlanBox.className = 'quality-box muted';
      fixPlanBox.textContent = 'No active job selected yet.';
      return null;
    }
    const res = await fetch('/api/jobs/' + currentId + '/improvement-plan?limit=3');
    const data = await res.json();
    if (!res.ok) {
      currentFixPlan = null;
      fixPlanBox.className = 'quality-box bad';
      fixPlanBox.textContent = data.error || 'Improvement plan failed';
      return null;
    }
    currentFixPlan = data;
    const recs = Array.isArray(data.recommendations) ? data.recommendations : [];
    if (recs.length === 0) {
      fixPlanBox.className = 'quality-box muted';
      fixPlanBox.textContent = 'No section recommendations available yet.';
      setOutput(data);
      return data;
    }
    const lines = recs.map((item, idx) => {
      const reason = Array.isArray(item.reasons) && item.reasons[0] ? item.reasons[0] : 'No reason provided';
      return [
        (idx + 1) + '. ' + item.section + ' (priority=' + item.priority + ', impact=' + item.impact + ', confidence=' + item.confidence + ')',
        '   ' + reason,
      ].join('\\n');
    });
    fixPlanBox.className = 'quality-box';
    fixPlanBox.textContent = lines.join('\\n');
    setOutput(data);
    return data;
  }

  async function updateVersionMeta(action, payload) {
    if (!currentRootOutputName) {
      setStatus('No project root selected', 'bad');
      return null;
    }
    const res = await fetch('/api/projects/' + encodeURIComponent(currentRootOutputName) + '/version-meta', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(Object.assign({action}, payload || {}))
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus('Version metadata update failed', 'bad');
      setOutput(data);
      return null;
    }
    renderVersionsList(data.versions || []);
    setOutput(data);
    return data;
  }

  async function promoteWinner() {
    if (!currentRootOutputName) {
      setStatus('No project root selected', 'bad');
      return null;
    }
    const res = await fetch('/api/projects/' + encodeURIComponent(currentRootOutputName) + '/promote', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus('Promote winner failed', 'bad');
      setOutput(data);
      return null;
    }
    renderVersionsList(data.versions || []);
    if (data.promoted && data.promoted.id) {
      metaTarget.value = data.promoted.id;
      syncMetaForm();
    }
    setOutput(data);
    return data;
  }

  function versionById(id) {
    return currentVersions.find((item) => item.id === id) || null;
  }

  function syncMetaForm() {
    const target = versionById(metaTarget.value);
    metaLabel.value = target && target.meta && target.meta.label ? target.meta.label : '';
    metaOutcome.value = target && target.meta && target.meta.outcome ? target.meta.outcome : '';
    metaOutcomeNote.value = target && target.meta && target.meta.outcomeNote ? target.meta.outcomeNote : '';
  }

  async function runCompare() {
    const leftId = compareLeft.value;
    const rightId = compareRight.value;
    if (!leftId || !rightId) {
      setStatus('Select two versions first', 'bad');
      return;
    }
    const res = await fetch('/api/jobs/' + leftId + '/compare?other=' + encodeURIComponent(rightId));
    const data = await res.json();
    if (!res.ok) {
      compareBox.className = 'quality-box bad';
      compareBox.textContent = data.error || 'Compare failed';
      return;
    }
    const diff = data.diff || {};
    const lines = [
      'Score delta (right-left): ' + String(diff.scoreDelta),
      'Pass transition: ' + String(diff.passTransition),
      'Pack transition: ' + String(diff.packTransition),
      'Hook changed: ' + String(diff.hookChanged),
      'CTA changed: ' + String(diff.ctaChanged),
      'Narration word delta (left-right): ' + String(diff.narrationWordDelta),
      'Shared integrations: ' + String(diff.sharedIntegrationsCount),
    ];
    if (Array.isArray(diff.featureNameChanges) && diff.featureNameChanges.length > 0) {
      lines.push('Feature name changes:');
      diff.featureNameChanges.forEach((change) => {
        lines.push('  - slot ' + change.slot + ': \"' + change.from + '\" -> \"' + change.to + '\"');
      });
    }
    compareBox.className = 'quality-box';
    compareBox.textContent = lines.join('\\n');
    if (data.left && data.left.videoUrl) videoLeft.src = data.left.videoUrl;
    else videoLeft.removeAttribute('src');
    if (data.right && data.right.videoUrl) videoRight.src = data.right.videoUrl;
    else videoRight.removeAttribute('src');
    setOutput(data);
  }

  async function poll() {
    if (!currentId) return;
    const res = await fetch('/api/jobs/' + currentId);
    const data = await res.json();
    setOutput(data);
    if (data.rootOutputName) {
      setCurrentRoot(data.rootOutputName);
    }
    if (data.status === 'completed') {
      setStatus('Completed', 'ok');
      currentJobIdField.value = currentId;
      await refreshVersions();
      await fetchRecommendation();
      await fetchImprovementPlan();
      await fetchAudit();
      clearInterval(timer);
    } else if (data.status === 'failed') {
      setStatus('Failed', 'bad');
      await refreshVersions();
      await fetchRecommendation();
      await fetchImprovementPlan();
      await fetchAudit();
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
    await fetchImprovementPlan();
    await fetchAudit();
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
    await fetchImprovementPlan();
    return data;
  }

  async function queueRerender() {
    const payload = {
      quality: document.getElementById('quality').value,
      strict: document.getElementById('strict').value === 'true',
      voice: 'none',
      autoPromoteMinConfidence: readAutoPromoteMinConfidenceInput()
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
    if (data.rootOutputName) {
      setCurrentRoot(data.rootOutputName);
    }
    currentId = data.id;
    currentJobIdField.value = currentId;
    setStatus('Rerender queued: ' + currentId + (data.version ? ' (v' + data.version + ')' : ''), 'muted');
    setOutput(data);
    await refreshVersions();
    if (timer) clearInterval(timer);
    timer = setInterval(poll, 2000);
    poll();
    return true;
  }

  async function regenerateSection(section) {
    if (!currentId) {
      setStatus('No active job selected', 'bad');
      return false;
    }
    const res = await fetch('/api/jobs/' + currentId + '/regenerate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({section})
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus('Regenerate failed', 'bad');
      setOutput(data);
      return false;
    }
    setStatus('Section regenerated: ' + section, 'ok');
    setOutput(data);
    renderQuality({qualityReport: data.quality && data.quality.available ? {score: data.quality.score, minScore: 80, passed: data.quality.passed, blockers: [], warnings: []} : null});
    await loadScript();
    await poll();
    await fetchImprovementPlan();
    return true;
  }

  async function applyTopSectionFix() {
    if (!currentId) {
      setStatus('No active job selected', 'bad');
      return false;
    }
    if (!currentFixPlan || !Array.isArray(currentFixPlan.recommendations) || currentFixPlan.recommendations.length === 0) {
      const planned = await fetchImprovementPlan();
      if (!planned || !Array.isArray(planned.recommendations) || planned.recommendations.length === 0) {
        setStatus('No top fix available', 'muted');
        return false;
      }
    }
    const top = currentFixPlan.recommendations[0];
    if (!top || !top.section) {
      setStatus('No top fix available', 'muted');
      return false;
    }
    setStatus('Applying top fix: ' + top.section, 'muted');
    return regenerateSection(top.section);
  }

  function renderAutoImproveResult(data) {
    if (!data || !Array.isArray(data.iterations)) {
      autoImproveBox.className = 'quality-box muted';
      autoImproveBox.textContent = 'No auto-improve run yet.';
      return;
    }
    const lines = [];
    lines.push('Stop reason: ' + (data.stopReason || 'n/a'));
    if (data.initialQuality) {
      lines.push('Initial: score=' + data.initialQuality.score + ', blockers=' + data.initialQuality.blockers + ', warnings=' + data.initialQuality.warnings);
    }
    if (data.finalQuality) {
      lines.push('Final: score=' + data.finalQuality.score + ', blockers=' + data.finalQuality.blockers + ', warnings=' + data.finalQuality.warnings);
    }
    if (data.rerender) {
      lines.push('Rerender: ' + (data.rerender.queued ? ('queued ' + data.rerender.id + ' (v' + data.rerender.version + ')') : data.rerender.reason));
      lines.push('Auto promote if winner: ' + String(Boolean(data.rerender.autoPromoteIfWinner)));
      lines.push('Auto promote min confidence: ' + String(data.rerender.autoPromoteMinConfidence));
    }
    if (data.iterations.length > 0) {
      lines.push('Iterations:');
      data.iterations.forEach((item) => {
        lines.push('  - step ' + item.step + ' [' + item.section + '] ' + item.before.score + ' -> ' + item.after.score + ' (improved=' + item.improved + ')');
      });
    }
    autoImproveBox.className = 'quality-box';
    autoImproveBox.textContent = lines.join('\\n');
  }

  async function runAutoImprove() {
    if (!currentId) {
      setStatus('No active job selected', 'bad');
      return null;
    }
    const payload = {
      maxSteps: Number(document.getElementById('autoMaxSteps').value),
      targetScore: Number(document.getElementById('autoTargetScore').value),
      maxWarnings: Number(document.getElementById('autoMaxWarnings').value),
      autofix: document.getElementById('autoAutofix').value === 'true',
      autoRerender: document.getElementById('autoRerender').value === 'true',
      rerenderStrict: document.getElementById('autoRerenderStrict').value === 'true',
      autoPromoteIfWinner: document.getElementById('autoPromoteIfWinner').value === 'true',
      autoPromoteMinConfidence: readAutoPromoteMinConfidenceInput()
    };
    setStatus('Running auto improve...', 'muted');
    const res = await fetch('/api/jobs/' + currentId + '/auto-improve', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      autoImproveBox.className = 'quality-box bad';
      autoImproveBox.textContent = data.error || 'Auto improve failed';
      setStatus('Auto improve failed', 'bad');
      setOutput(data);
      return null;
    }
    renderAutoImproveResult(data);
    setOutput(data);
    if (data.finalQuality) {
      renderQuality({
        qualityReport: {
          score: data.finalQuality.score,
          minScore: 80,
          passed: data.finalQuality.passed,
          blockers: [],
          warnings: []
        }
      });
    }
    await loadScript();
    await fetchImprovementPlan();
    await fetchAudit();
    if (data.rerender && data.rerender.queued && data.rerender.id) {
      currentId = data.rerender.id;
      currentJobIdField.value = currentId;
      setStatus('Auto improve queued rerender: ' + data.rerender.id, 'ok');
      await refreshVersions();
      if (timer) clearInterval(timer);
      timer = setInterval(poll, 2000);
      poll();
      return data;
    }
    setStatus('Auto improve finished: ' + (data.stopReason || 'done'), 'ok');
    return data;
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
    currentRecommendation = null;
    currentFixPlan = null;
    currentPromotionPolicy = null;
    setCurrentRoot(data.rootOutputName || '');
    currentJobIdField.value = currentId;
    domainPackField.value = '';
    qualityBox.className = 'quality-box muted';
    qualityBox.textContent = 'No quality check yet.';
    recommendationBox.className = 'quality-box muted';
    recommendationBox.textContent = 'No recommendation yet.';
    fixPlanBox.className = 'quality-box muted';
    fixPlanBox.textContent = 'No section improvement plan yet.';
    autoImproveBox.className = 'quality-box muted';
    autoImproveBox.textContent = 'No auto-improve run yet.';
    promotionPolicyBox.className = 'quality-box muted';
    promotionPolicyBox.textContent = 'No promotion policy loaded.';
    auditBox.className = 'quality-box muted';
    auditBox.textContent = 'No automation audit yet.';
    compareBox.className = 'quality-box muted';
    compareBox.textContent = 'No compare run yet.';
    videoLeft.removeAttribute('src');
    videoRight.removeAttribute('src');
    setStatus('Queued: ' + currentId, 'muted');
    setOutput(data);
    if (timer) clearInterval(timer);
    timer = setInterval(poll, 2000);
    poll();
  });

  document.getElementById('regen').addEventListener('click', async () => {
    const section = document.getElementById('section').value;
    await regenerateSection(section);
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

  document.getElementById('refreshVersions').addEventListener('click', async () => {
    await refreshVersions();
  });

  document.getElementById('runCompare').addEventListener('click', async () => {
    await runCompare();
  });

  document.getElementById('recommendBest').addEventListener('click', async () => {
    await refreshVersions();
    await fetchRecommendation();
  });

  document.getElementById('refreshAudit').addEventListener('click', async () => {
    await fetchAudit();
  });

  document.getElementById('savePromotionPolicy').addEventListener('click', async () => {
    await savePromotionPolicy();
  });

  document.getElementById('loadPromotionPolicy').addEventListener('click', async () => {
    await fetchPromotionPolicy();
  });

  document.getElementById('recommendFixes').addEventListener('click', async () => {
    await fetchImprovementPlan();
  });

  document.getElementById('applyTopFix').addEventListener('click', async () => {
    await applyTopSectionFix();
  });

  document.getElementById('runAutoImprove').addEventListener('click', async () => {
    await runAutoImprove();
  });

  document.getElementById('promoteWinner').addEventListener('click', async () => {
    await refreshVersions();
    const result = await promoteWinner();
    if (!result) return;
    setStatus('Promoted winner: v' + result.promoted.version + ' · ' + result.promoted.id, 'ok');
    await fetchRecommendation();
    await fetchAudit();
  });

  document.getElementById('saveLabel').addEventListener('click', async () => {
    const jobId = String(metaTarget.value || '').trim();
    if (!jobId) {
      setStatus('Choose a version first', 'bad');
      return;
    }
    await updateVersionMeta('set-label', {jobId, label: String(metaLabel.value || '').trim()});
    setStatus('Label saved', 'ok');
    await fetchRecommendation();
  });

  document.getElementById('saveOutcome').addEventListener('click', async () => {
    const jobId = String(metaTarget.value || '').trim();
    if (!jobId) {
      setStatus('Choose a version first', 'bad');
      return;
    }
    const outcome = String(metaOutcome.value || '').trim();
    const outcomeNote = String(metaOutcomeNote.value || '').trim();
    await updateVersionMeta('set-outcome', {jobId, outcome, outcomeNote});
    setStatus(outcome ? ('Outcome set to ' + outcome) : 'Outcome cleared', 'ok');
    await fetchRecommendation();
  });

  document.getElementById('toggleArchive').addEventListener('click', async () => {
    const jobId = String(metaTarget.value || '').trim();
    if (!jobId) {
      setStatus('Choose a version first', 'bad');
      return;
    }
    const target = versionById(jobId);
    const nextArchived = !(target && target.meta && target.meta.archived);
    await updateVersionMeta('set-archived', {jobId, archived: nextArchived});
    setStatus(nextArchived ? 'Version archived' : 'Version restored', 'ok');
    await fetchRecommendation();
  });

  document.getElementById('togglePin').addEventListener('click', async () => {
    const jobId = String(metaTarget.value || '').trim();
    if (!jobId) {
      setStatus('Choose a version first', 'bad');
      return;
    }
    const target = versionById(jobId);
    const nextPinned = !(target && target.meta && target.meta.pinned);
    await updateVersionMeta('set-pinned', {jobId, pinned: nextPinned});
    setStatus(nextPinned ? 'Version pinned' : 'Version unpinned', 'ok');
    await fetchRecommendation();
  });

  metaTarget.addEventListener('change', syncMetaForm);
</script>
</body>
</html>`;
}

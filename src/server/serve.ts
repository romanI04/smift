import http from 'http';
import fs from 'fs';
import path from 'path';
import {spawn} from 'child_process';
import {
  DOMAIN_PACK_IDS,
  getDomainPack,
  selectDomainPack,
  type DomainPackId,
} from '../pipeline/domain-packs';
import {scrapeUrl} from '../pipeline/scraper';
import {extractGroundingHints, summarizeGroundingUsage} from '../pipeline/grounding';
import {selectTemplate, getTemplateProfile, type TemplateId} from '../pipeline/templates';
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
      return sendJson(res, 200, {
        id: job.id,
        path: artifacts.scriptPath,
        script: parsed,
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
    :root { --bg:#f6f6f4; --panel:#ffffff; --ink:#111111; --muted:#666; --accent:#0b6dfc; --ok:#138a36; --bad:#b42318; }
    body { margin:0; font-family: ui-sans-serif, -apple-system, Segoe UI, sans-serif; background: radial-gradient(circle at 10% 10%, #e8efe9 0, #f6f6f4 38%); color: var(--ink); }
    .wrap { max-width: 860px; margin: 32px auto; padding: 0 16px; }
    .card { background:var(--panel); border:1px solid #e8e8e8; border-radius:14px; padding:16px; box-shadow:0 8px 26px rgba(0,0,0,0.05); }
    h1 { margin: 0 0 10px; font-size: 26px; }
    .row { display:flex; gap:10px; flex-wrap: wrap; margin-bottom: 10px; }
    input, select { padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:14px; }
    input[type=text] { flex:1; min-width:260px; }
    button { border:none; background:var(--accent); color:#fff; border-radius:8px; padding:10px 14px; font-weight:600; cursor:pointer; }
    textarea { width: 100%; min-height: 220px; border:1px solid #ddd; border-radius:8px; padding:10px 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; }
    pre { background:#fafafa; border:1px solid #eee; border-radius:8px; padding:12px; overflow:auto; font-size:12px; }
    .muted { color:var(--muted); }
    .ok { color:var(--ok); font-weight:600; }
    .bad { color:var(--bad); font-weight:600; }
    .split { display:grid; grid-template-columns: 1fr; gap: 12px; margin-top: 12px; }
    .hint { font-size: 12px; color: var(--muted); }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>smift self-serve runner</h1>
      <p class="muted">Submit a URL, queue a job, and poll status/artifacts.</p>
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
        <button id="regen">Regenerate Section</button>
        <button id="loadScript">Load Script</button>
        <button id="saveScript">Save Script</button>
        <button id="rerender">Rerender Edited Script</button>
      </div>
      <div class="split">
        <div>
          <div class="hint">Script editor (JSON). Edit hook/features/cta/narrationSegments, then save and rerender.</div>
          <textarea id="scriptEditor" placeholder="{\n  &quot;brandName&quot;: &quot;...&quot;\n}"></textarea>
        </div>
      </div>
      <div id="status" class="muted">Idle.</div>
      <pre id="out">No job yet.</pre>
    </div>
  </div>
<script>
  const out = document.getElementById('out');
  const status = document.getElementById('status');
  const editor = document.getElementById('scriptEditor');
  let timer = null;
  let currentId = null;

  function setStatus(text, kind='') {
    status.textContent = text;
    status.className = kind;
  }

  async function poll() {
    if (!currentId) return;
    const res = await fetch('/api/jobs/' + currentId);
    const data = await res.json();
    out.textContent = JSON.stringify(data, null, 2);
    if (data.status === 'completed') {
      setStatus('Completed', 'ok');
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
      out.textContent = JSON.stringify(data, null, 2);
      return;
    }
    editor.value = JSON.stringify(data.script, null, 2);
    setStatus('Script loaded', 'ok');
    out.textContent = JSON.stringify(data, null, 2);
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
      out.textContent = JSON.stringify(data, null, 2);
      return;
    }

    currentId = data.id;
    setStatus('Queued: ' + currentId, 'muted');
    out.textContent = JSON.stringify(data, null, 2);
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
      out.textContent = JSON.stringify(data, null, 2);
      return;
    }
    setStatus('Section regenerated: ' + section, 'ok');
    out.textContent = JSON.stringify(data, null, 2);
    poll();
  });

  document.getElementById('loadScript').addEventListener('click', loadScript);

  document.getElementById('saveScript').addEventListener('click', async () => {
    if (!currentId) {
      setStatus('No active job selected', 'bad');
      return;
    }
    if (!editor.value.trim()) {
      setStatus('Script editor is empty', 'bad');
      return;
    }
    let script;
    try {
      script = JSON.parse(editor.value);
    } catch (e) {
      setStatus('Script JSON is invalid', 'bad');
      return;
    }
    const res = await fetch('/api/jobs/' + currentId + '/script', {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({script})
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus('Save script failed', 'bad');
      out.textContent = JSON.stringify(data, null, 2);
      return;
    }
    setStatus('Script saved', 'ok');
    out.textContent = JSON.stringify(data, null, 2);
    poll();
  });

  document.getElementById('rerender').addEventListener('click', async () => {
    if (!currentId) {
      setStatus('No active job selected', 'bad');
      return;
    }
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
      out.textContent = JSON.stringify(data, null, 2);
      return;
    }
    currentId = data.id;
    setStatus('Rerender queued: ' + currentId, 'muted');
    out.textContent = JSON.stringify(data, null, 2);
    if (timer) clearInterval(timer);
    timer = setInterval(poll, 2000);
    poll();
  });
</script>
</body>
</html>`;
}

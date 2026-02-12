import http from 'http';
import fs from 'fs';
import path from 'path';
import {spawn} from 'child_process';
import {DOMAIN_PACK_IDS, type DomainPackId} from '../pipeline/domain-packs';

type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

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
    strict: boolean;
    quality: 'draft' | 'yc';
    voice: 'none' | 'openai' | 'elevenlabs' | 'chatterbox';
    skipRender: boolean;
    pack: 'auto' | DomainPackId;
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

    if (method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[2];
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, {error: 'job not found'});

      if (parts.length === 3) {
        return sendJson(res, 200, enrichJob(job));
      }

      if (parts.length === 4 && parts[3] === 'artifacts') {
        return sendJson(res, 200, artifactsFor(job));
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
      strict,
      quality,
      voice,
      skipRender,
      pack,
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

  const args = [
    'run',
    'generate',
    '--',
    job.url,
    `--voice=${job.options.voice}`,
    `--quality=${job.options.quality}`,
    `--pack=${job.options.pack}`,
    '--template=auto',
    '--max-script-attempts=2',
    '--min-quality=80',
  ];

  if (job.options.strict) args.push('--strict');
  if (job.options.skipRender) args.push('--skip-render');

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
  };
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
    pre { background:#fafafa; border:1px solid #eee; border-radius:8px; padding:12px; overflow:auto; font-size:12px; }
    .muted { color:var(--muted); }
    .ok { color:var(--ok); font-weight:600; }
    .bad { color:var(--bad); font-weight:600; }
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
      <div id="status" class="muted">Idle.</div>
      <pre id="out">No job yet.</pre>
    </div>
  </div>
<script>
  const out = document.getElementById('out');
  const status = document.getElementById('status');
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
</script>
</body>
</html>`;
}

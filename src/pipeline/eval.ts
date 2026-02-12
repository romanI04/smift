import {spawnSync} from 'child_process';
import fs from 'fs';
import path from 'path';
import {BENCHMARK_URLS} from './benchmark-urls';

interface EvalResult {
  url: string;
  score: number | null;
  passed: boolean;
  generationMode: string | null;
  scriptModePassed: boolean;
  hasVideo: boolean;
  durationSec: number;
  error?: string;
}

interface QualityReportFile {
  generationMode?: string;
  qualityReport?: {
    score?: number;
    passed?: boolean;
  };
}

async function run() {
  const args = process.argv.slice(2);
  const outDir = path.resolve(__dirname, '../../out');
  const minQuality = parseNumberArg(args, '--min-quality', 80);
  const maxWarnings = parseNumberArg(args, '--max-warnings', 1);
  const limit = parseNumberArg(args, '--limit', BENCHMARK_URLS.length);
  const strict = args.includes('--strict');
  const withRender = args.includes('--with-render');
  const voice = parseStringArg(args, '--voice') ?? 'none';
  const quality = parseStringArg(args, '--quality') ?? 'draft';
  const maxScriptAttempts = parseNumberArg(args, '--max-script-attempts', 2);

  const urls = BENCHMARK_URLS.slice(0, Math.max(1, limit));
  const startedAt = Date.now();
  const results: EvalResult[] = [];

  console.log(`Running eval on ${urls.length} URL(s)...`);

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const started = Date.now();
    console.log(`\n[${i + 1}/${urls.length}] ${url}`);

    const cmdArgs = [
      'run',
      'generate',
      '--',
      url,
      `--voice=${voice}`,
      `--quality=${quality}`,
      '--template=auto',
      `--min-quality=${minQuality}`,
      `--max-warnings=${maxWarnings}`,
      `--max-script-attempts=${maxScriptAttempts}`,
      '--no-autofix',
      '--allow-low-quality',
    ];

    if (!withRender) cmdArgs.push('--skip-render');
    if (strict) cmdArgs.push('--strict');

    const child = spawnSync('npm', cmdArgs, {
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 1000 * 60 * 8,
    });

    const outputName = url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
    const qualityPath = path.join(outDir, `${outputName}-quality.json`);
    const videoPath = path.join(outDir, `${outputName}.mp4`);

    const durationSec = Math.round((Date.now() - started) / 1000);
    let score: number | null = null;
    let passed = false;
    let generationMode: string | null = null;
    let parseError: string | undefined;

    try {
      const parsed = JSON.parse(fs.readFileSync(qualityPath, 'utf-8')) as QualityReportFile;
      score = parsed.qualityReport?.score ?? null;
      passed = Boolean(parsed.qualityReport?.passed);
      generationMode = parsed.generationMode ?? null;
    } catch (e: any) {
      parseError = `quality parse failed: ${e.message}`;
    }

    const hasVideo = withRender ? fs.existsSync(videoPath) : false;
    const errorText = child.status === 0 ? parseError : `generate failed (${child.status}): ${stderrTail(child.stderr)}`;

    const result: EvalResult = {
      url,
      score,
      passed,
      generationMode,
      scriptModePassed: child.status === 0,
      hasVideo,
      durationSec,
      ...(errorText ? {error: errorText} : {}),
    };

    results.push(result);

    const scoreLabel = score === null ? 'n/a' : String(score);
    console.log(`  -> score=${scoreLabel}, passed=${passed}, mode=${generationMode ?? 'n/a'}, video=${hasVideo}, duration=${durationSec}s`);
    if (errorText) console.log(`  -> error=${errorText}`);
  }

  const totalSec = Math.round((Date.now() - startedAt) / 1000);
  const total = results.length;
  const validScores = results.filter((r) => r.score !== null) as Array<EvalResult & {score: number}>;
  const passed = results.filter((r) => r.passed).length;
  const passRate = total === 0 ? 0 : Number(((passed / total) * 100).toFixed(1));
  const avgScore = validScores.length === 0
    ? null
    : Number((validScores.reduce((acc, cur) => acc + cur.score, 0) / validScores.length).toFixed(1));

  const summary = {
    generatedAt: new Date().toISOString(),
    settings: {
      minQuality,
      maxWarnings,
      strict,
      withRender,
      quality,
      voice,
      maxScriptAttempts,
      urlsEvaluated: total,
    },
    aggregate: {
      passRate,
      passed,
      total,
      avgScore,
      totalDurationSec: totalSec,
    },
    results,
  };

  const stamp = timestamp();
  const summaryJson = path.join(outDir, `eval-summary-${stamp}.json`);
  const summaryCsv = path.join(outDir, `eval-summary-${stamp}.csv`);
  fs.writeFileSync(summaryJson, JSON.stringify(summary, null, 2));
  fs.writeFileSync(summaryCsv, toCsv(results));

  console.log('\nEval complete');
  console.log(`  -> pass rate: ${passRate}% (${passed}/${total})`);
  console.log(`  -> avg score: ${avgScore ?? 'n/a'}`);
  console.log(`  -> duration: ${totalSec}s`);
  console.log(`  -> summary json: ${summaryJson}`);
  console.log(`  -> summary csv: ${summaryCsv}`);
}

function parseStringArg(args: string[], key: string): string | undefined {
  const raw = args.find((arg) => arg.startsWith(`${key}=`));
  return raw ? raw.split('=')[1] : undefined;
}

function parseNumberArg(args: string[], key: string, fallback: number): number {
  const raw = parseStringArg(args, key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function stderrTail(stderr: string): string {
  const trimmed = (stderr || '').trim();
  if (!trimmed) return 'no stderr';
  const lines = trimmed.split('\n');
  return lines.slice(-3).join(' | ');
}

function toCsv(results: EvalResult[]): string {
  const header = ['url', 'score', 'passed', 'generationMode', 'scriptModePassed', 'hasVideo', 'durationSec', 'error'];
  const rows = results.map((r) => [
    r.url,
    r.score === null ? '' : String(r.score),
    String(r.passed),
    r.generationMode ?? '',
    String(r.scriptModePassed),
    String(r.hasVideo),
    String(r.durationSec),
    (r.error ?? '').replace(/"/g, '""'),
  ]);
  return [header, ...rows]
    .map((cols) => cols.map((col) => `"${col}"`).join(','))
    .join('\n');
}

run().catch((e) => {
  console.error('Eval failed:', e.message);
  process.exit(1);
});

import {spawnSync} from 'child_process';
import fs from 'fs';
import path from 'path';
import {REAL_BENCHMARK_CASES} from './benchmark-real-urls';
import {REAL_SMOKE_BENCHMARK_CASES} from './benchmark-real-smoke-urls';
import {CUSTOMER_BENCHMARK_CASES} from './benchmark-customer-urls';

interface RealEvalResult {
  url: string;
  expectedPack: string;
  selectedPack: string | null;
  packMatch: boolean | null;
  packConfidence: number | null;
  score: number | null;
  passed: boolean;
  generationMode: string | null;
  scriptModePassed: boolean;
  durationSec: number;
  error?: string;
}

interface QualityReportFile {
  generationMode?: string;
  domainPack?: string;
  domainPackConfidence?: number;
  qualityReport?: {
    score?: number;
    passed?: boolean;
  };
}

interface BenchmarkCaseLike {
  url: string;
  expectedPack: string;
  segment?: string;
}

async function run() {
  const args = process.argv.slice(2);
  const outDir = path.resolve(__dirname, '../../out');
  const suite = parseStringArg(args, '--suite') ?? 'full';
  const segment = parseStringArg(args, '--segment');
  const minQuality = parseNumberArg(args, '--min-quality', 80);
  const maxWarnings = parseNumberArg(args, '--max-warnings', 1);
  const benchmarkCases: BenchmarkCaseLike[] = suite === 'smoke'
    ? REAL_SMOKE_BENCHMARK_CASES
    : suite === 'customer'
      ? CUSTOMER_BENCHMARK_CASES
      : REAL_BENCHMARK_CASES;
  const filteredCases = segment
    ? benchmarkCases.filter((item) => item.segment === segment)
    : benchmarkCases;
  const limit = parseNumberArg(args, '--limit', filteredCases.length);
  const minPassRate = parseOptionalNumberArg(args, '--min-pass-rate');
  const minPackAccuracy = parseOptionalNumberArg(args, '--min-pack-accuracy');
  const minPackComparable = parseOptionalNumberArg(args, '--min-pack-comparable');
  const maxErrors = parseOptionalNumberArg(args, '--max-errors');
  const strict = args.includes('--strict');
  const voice = parseStringArg(args, '--voice') ?? 'none';
  const quality = parseStringArg(args, '--quality') ?? 'draft';
  const maxScriptAttempts = parseNumberArg(args, '--max-script-attempts', 2);
  const allowLowQuality = args.includes('--allow-low-quality');
  const noAutofix = args.includes('--no-autofix');

  const cases = filteredCases.slice(0, Math.max(1, limit));
  const startedAt = Date.now();
  const results: RealEvalResult[] = [];

  console.log(`Running ${suite}${segment ? `/${segment}` : ''} real benchmark on ${cases.length} URL(s)...`);

  for (let i = 0; i < cases.length; i++) {
    const testCase = cases[i];
    const started = Date.now();
    console.log(`\n[${i + 1}/${cases.length}] ${testCase.url} (expect ${testCase.expectedPack})`);

    const cmdArgs = [
      'run',
      'generate',
      '--',
      testCase.url,
      '--template=auto',
      '--pack=auto',
      '--skip-render',
      `--voice=${voice}`,
      `--quality=${quality}`,
      `--min-quality=${minQuality}`,
      `--max-warnings=${maxWarnings}`,
      `--max-script-attempts=${maxScriptAttempts}`,
    ];

    if (allowLowQuality) cmdArgs.push('--allow-low-quality');
    if (noAutofix) cmdArgs.push('--no-autofix');
    if (strict) cmdArgs.push('--strict');

    const child = spawnSync('npm', cmdArgs, {
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 1000 * 60 * 8,
    });

    const outputName = testCase.url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
    const qualityPath = path.join(outDir, `${outputName}-quality.json`);
    const durationSec = Math.round((Date.now() - started) / 1000);

    let score: number | null = null;
    let passed = false;
    let generationMode: string | null = null;
    let selectedPack: string | null = null;
    let packConfidence: number | null = null;
    let parseError: string | undefined;

    try {
      const parsed = JSON.parse(fs.readFileSync(qualityPath, 'utf-8')) as QualityReportFile;
      score = parsed.qualityReport?.score ?? null;
      passed = Boolean(parsed.qualityReport?.passed);
      generationMode = parsed.generationMode ?? null;
      selectedPack = parsed.domainPack ?? null;
      packConfidence = parsed.domainPackConfidence ?? null;
    } catch (e: any) {
      parseError = `quality parse failed: ${e.message}`;
    }

    const packMatch = selectedPack ? selectedPack === testCase.expectedPack : null;
    const errorText = child.status === 0 ? parseError : `generate failed (${child.status}): ${stderrTail(child.stderr)}`;

    const result: RealEvalResult = {
      url: testCase.url,
      expectedPack: testCase.expectedPack,
      selectedPack,
      packMatch,
      packConfidence,
      score,
      passed,
      generationMode,
      scriptModePassed: child.status === 0,
      durationSec,
      ...(errorText ? {error: errorText} : {}),
    };
    results.push(result);

    const matchLabel = packMatch === null ? 'n/a' : String(packMatch);
    console.log(
      `  -> pack=${selectedPack ?? 'n/a'} match=${matchLabel} confidence=${packConfidence ?? 'n/a'} score=${score ?? 'n/a'} passed=${passed} duration=${durationSec}s`,
    );
    if (errorText) console.log(`  -> error=${errorText}`);
  }

  const totalSec = Math.round((Date.now() - startedAt) / 1000);
  const total = results.length;
  const validScores = results.filter((r) => r.score !== null) as Array<RealEvalResult & {score: number}>;
  const passed = results.filter((r) => r.passed).length;
  const passRate = total === 0 ? 0 : Number(((passed / total) * 100).toFixed(1));
  const avgScore = validScores.length === 0
    ? null
    : Number((validScores.reduce((acc, cur) => acc + cur.score, 0) / validScores.length).toFixed(1));

  const packComparable = results.filter((r) => r.packMatch !== null) as Array<RealEvalResult & {packMatch: boolean}>;
  const packMatches = packComparable.filter((r) => r.packMatch).length;
  const packAccuracy = packComparable.length === 0
    ? null
    : Number(((packMatches / packComparable.length) * 100).toFixed(1));
  const errorCount = results.filter((r) => Boolean(r.error)).length;

  const summary = {
    generatedAt: new Date().toISOString(),
    settings: {
      minQuality,
      maxWarnings,
      strict,
      quality,
      voice,
      maxScriptAttempts,
      allowLowQuality,
      noAutofix,
      suite,
      segment,
      urlsEvaluated: total,
    },
    aggregate: {
      passRate,
      passed,
      total,
      avgScore,
      packAccuracy,
      packMatches,
      packComparable: packComparable.length,
      errorCount,
      totalDurationSec: totalSec,
    },
    results,
  };

  const stamp = timestamp();
  const summaryJson = path.join(outDir, `eval-real-summary-${stamp}.json`);
  const summaryCsv = path.join(outDir, `eval-real-summary-${stamp}.csv`);
  fs.writeFileSync(summaryJson, JSON.stringify(summary, null, 2));
  fs.writeFileSync(summaryCsv, toCsv(results));

  console.log('\nReal benchmark complete');
  console.log(`  -> pack accuracy: ${packAccuracy ?? 'n/a'}% (${packMatches}/${packComparable.length})`);
  console.log(`  -> pass rate: ${passRate}% (${passed}/${total})`);
  console.log(`  -> avg score: ${avgScore ?? 'n/a'}`);
  console.log(`  -> errors: ${errorCount}`);
  console.log(`  -> duration: ${totalSec}s`);
  console.log(`  -> summary json: ${summaryJson}`);
  console.log(`  -> summary csv: ${summaryCsv}`);

  const failures: string[] = [];
  if (minPassRate !== undefined && passRate < minPassRate) {
    failures.push(`pass rate ${passRate}% is below required ${minPassRate}%`);
  }
  if (minPackAccuracy !== undefined) {
    if (packAccuracy === null) failures.push(`pack accuracy unavailable (need >= ${minPackAccuracy}%)`);
    else if (packAccuracy < minPackAccuracy) failures.push(`pack accuracy ${packAccuracy}% is below required ${minPackAccuracy}%`);
  }
  if (minPackComparable !== undefined && packComparable.length < minPackComparable) {
    failures.push(`pack-comparable cases ${packComparable.length} is below required ${minPackComparable}`);
  }
  if (maxErrors !== undefined && errorCount > maxErrors) {
    failures.push(`error count ${errorCount} exceeds max ${maxErrors}`);
  }

  if (failures.length > 0) {
    console.error('\nReal benchmark threshold check failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
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

function parseOptionalNumberArg(args: string[], key: string): number | undefined {
  const raw = parseStringArg(args, key);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
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

function toCsv(results: RealEvalResult[]): string {
  const header = [
    'url',
    'expectedPack',
    'selectedPack',
    'packMatch',
    'packConfidence',
    'score',
    'passed',
    'generationMode',
    'scriptModePassed',
    'durationSec',
    'error',
  ];
  const rows = results.map((result) => [
    result.url,
    result.expectedPack,
    result.selectedPack ?? '',
    result.packMatch === null ? '' : String(result.packMatch),
    result.packConfidence === null ? '' : String(result.packConfidence),
    result.score === null ? '' : String(result.score),
    String(result.passed),
    result.generationMode ?? '',
    String(result.scriptModePassed),
    String(result.durationSec),
    (result.error ?? '').replace(/"/g, '""'),
  ]);
  return [header, ...rows]
    .map((cols) => cols.map((col) => `"${col}"`).join(','))
    .join('\n');
}

run().catch((e) => {
  console.error('Real benchmark failed:', e.message);
  process.exit(1);
});

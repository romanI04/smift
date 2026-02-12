import fs from 'fs';
import path from 'path';
import {PACK_FIXTURES} from './pack-fixtures';
import {selectDomainPack, type DomainPackId} from './domain-packs';

interface PackEvalResult {
  id: string;
  expectedPack: DomainPackId;
  selectedPack: DomainPackId;
  pass: boolean;
  expectedMinConfidence: number;
  confidence: number;
  confidencePass: boolean;
  reason: string;
  topCandidates: Array<{id: DomainPackId; score: number}>;
}

async function run() {
  const args = process.argv.slice(2);
  const outDir = path.resolve(__dirname, '../../out');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, {recursive: true});

  const filter = parseStringArg(args, '--filter');
  const allowFail = args.includes('--allow-fail');

  const fixtures = filter
    ? PACK_FIXTURES.filter((fixture) => fixture.id.includes(filter))
    : PACK_FIXTURES;

  if (fixtures.length === 0) {
    console.error(`No fixtures matched --filter=${filter}`);
    process.exit(1);
  }

  console.log(`Evaluating ${fixtures.length} pack fixture(s)...`);

  const results: PackEvalResult[] = fixtures.map((fixture) => {
    const selected = selectDomainPack(fixture.scraped, 'auto');
    const expectedMinConfidence = fixture.minConfidence ?? 0;
    const confidencePass = selected.confidence >= expectedMinConfidence;
    const selectedPack = selected.pack.id;
    const pass = selectedPack === fixture.expectedPack && confidencePass;
    return {
      id: fixture.id,
      expectedPack: fixture.expectedPack,
      selectedPack,
      pass,
      expectedMinConfidence,
      confidence: selected.confidence,
      confidencePass,
      reason: selected.reason,
      topCandidates: selected.topCandidates,
    };
  });

  for (const result of results) {
    const marker = result.pass ? 'PASS' : 'FAIL';
    console.log(
      `${marker} ${result.id}: expected=${result.expectedPack} selected=${result.selectedPack} confidence=${result.confidence.toFixed(2)} min=${result.expectedMinConfidence.toFixed(2)}`,
    );
    if (!result.pass) {
      console.log(`  reason: ${result.reason}`);
      console.log(`  top: ${formatTopCandidates(result.topCandidates)}`);
    }
  }

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const failed = total - passed;
  const accuracy = Number(((passed / total) * 100).toFixed(1));

  const summary = {
    generatedAt: new Date().toISOString(),
    settings: {
      filter: filter ?? null,
      totalFixtures: total,
      allowFail,
    },
    aggregate: {
      passed,
      failed,
      accuracy,
    },
    results,
  };

  const stamp = timestamp();
  const outPath = path.join(outDir, `pack-eval-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

  console.log('\nPack eval complete');
  console.log(`  -> accuracy: ${accuracy}% (${passed}/${total})`);
  console.log(`  -> summary: ${outPath}`);

  if (failed > 0 && !allowFail) {
    process.exit(1);
  }
}

function parseStringArg(args: string[], key: string): string | undefined {
  const raw = args.find((arg) => arg.startsWith(`${key}=`));
  return raw ? raw.slice(key.length + 1) : undefined;
}

function formatTopCandidates(topCandidates: Array<{id: DomainPackId; score: number}>): string {
  return topCandidates.map((candidate) => `${candidate.id}:${candidate.score.toFixed(2)}`).join(', ');
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

run().catch((e) => {
  console.error('Pack eval failed:', e.message);
  process.exit(1);
});

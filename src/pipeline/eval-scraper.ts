import fs from 'fs';
import path from 'path';
import {SCRAPER_FIXTURES} from './scraper-fixtures';
import {
  detectBlockedPageSignals,
  extractMetadataFallback,
  sanitizeBlockedMetadata,
} from './scraper';

interface ScraperEvalResult {
  id: string;
  expectedMode: 'full' | 'metadata-fallback';
  detectedMode: 'full' | 'metadata-fallback';
  pass: boolean;
  reasons: string[];
  featuresCount: number;
  notes: string[];
}

async function run() {
  const args = process.argv.slice(2);
  const outDir = path.resolve(__dirname, '../../out');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, {recursive: true});

  const filter = parseStringArg(args, '--filter');
  const allowFail = args.includes('--allow-fail');
  const fixtures = filter
    ? SCRAPER_FIXTURES.filter((fixture) => fixture.id.includes(filter))
    : SCRAPER_FIXTURES;

  if (fixtures.length === 0) {
    console.error(`No fixtures matched --filter=${filter}`);
    process.exit(1);
  }

  console.log(`Evaluating ${fixtures.length} scraper fixture(s)...`);

  const results: ScraperEvalResult[] = fixtures.map((fixture) => {
    const detection = detectBlockedPageSignals({
      title: fixture.title,
      description: fixture.description,
      ogTitle: fixture.ogTitle,
      ogDescription: fixture.ogDescription,
      bodyText: fixture.bodyText,
    });

    const detectedMode: 'full' | 'metadata-fallback' = detection.blockedLikely ? 'metadata-fallback' : 'full';
    const notes: string[] = [];
    const failures: string[] = [];
    let featuresCount = 0;

    if (detectedMode !== fixture.expectedMode) {
      failures.push(`expected mode=${fixture.expectedMode}, got=${detectedMode}`);
    }

    if (fixture.expectedReasons && fixture.expectedReasons.length > 0) {
      for (const reason of fixture.expectedReasons) {
        if (!detection.reasons.includes(reason)) {
          failures.push(`missing expected reason=${reason}`);
        }
      }
    }

    if (detectedMode === 'metadata-fallback') {
      const sanitized = sanitizeBlockedMetadata({
        title: fixture.title,
        description: fixture.description,
        ogTitle: fixture.ogTitle,
        ogDescription: fixture.ogDescription,
        domain: fixture.domain,
      });

      const fallback = extractMetadataFallback({
        title: sanitized.title,
        description: sanitized.description,
        ogTitle: sanitized.ogTitle,
        ogDescription: sanitized.ogDescription,
        structuredHints: fixture.structuredHints,
        domain: fixture.domain,
      });

      const forbidden = ['unsupported', 'browser', 'cloudflare', 'captcha', 'forbidden', 'access denied', 'javascript'];
      const fallbackCorpus = [...fallback.headings, ...fallback.features, fallback.bodyText].join(' ').toLowerCase();
      for (const token of forbidden) {
        if (fallbackCorpus.includes(token)) failures.push(`forbidden token leaked into fallback: "${token}"`);
      }

      featuresCount = fallback.features.length;
      if (featuresCount < 3) failures.push(`fallback features too few: ${featuresCount}`);

      if (fixture.expectedFeatureTerms && fixture.expectedFeatureTerms.length > 0) {
        const featureText = fallback.features.join(' ').toLowerCase();
        const hasAny = fixture.expectedFeatureTerms.some((term) => featureText.includes(term.toLowerCase()));
        if (!hasAny) failures.push(`fallback features missing expected term(s): ${fixture.expectedFeatureTerms.join(', ')}`);
      }

      notes.push(`fallback features=${fallback.features.slice(0, 3).join(' | ')}`);
    }

    return {
      id: fixture.id,
      expectedMode: fixture.expectedMode,
      detectedMode,
      pass: failures.length === 0,
      reasons: detection.reasons,
      featuresCount,
      notes: [...notes, ...failures],
    };
  });

  for (const result of results) {
    const marker = result.pass ? 'PASS' : 'FAIL';
    console.log(`${marker} ${result.id}: expected=${result.expectedMode} detected=${result.detectedMode}`);
    if (result.reasons.length > 0) console.log(`  reasons: ${result.reasons.join(', ')}`);
    if (result.notes.length > 0) console.log(`  notes: ${result.notes.join(' | ')}`);
  }

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const failed = total - passed;
  const accuracy = Number(((passed / total) * 100).toFixed(1));

  const summary = {
    generatedAt: new Date().toISOString(),
    settings: {filter: filter ?? null, allowFail, totalFixtures: total},
    aggregate: {passed, failed, accuracy},
    results,
  };

  const stamp = timestamp();
  const outPath = path.join(outDir, `scraper-eval-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

  console.log('\nScraper eval complete');
  console.log(`  -> accuracy: ${accuracy}% (${passed}/${total})`);
  console.log(`  -> summary: ${outPath}`);

  if (failed > 0 && !allowFail) process.exit(1);
}

function parseStringArg(args: string[], key: string): string | undefined {
  const raw = args.find((arg) => arg.startsWith(`${key}=`));
  return raw ? raw.slice(key.length + 1) : undefined;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

run().catch((e) => {
  console.error('Scraper eval failed:', e.message);
  process.exit(1);
});

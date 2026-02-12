import type {ScrapedData} from './scraper';
import type {ScriptResult} from './script-types';
import type {TemplateProfile} from './templates';
import type {DomainPack} from './domain-packs';

export interface QualityReport {
  score: number;
  minScore: number;
  passed: boolean;
  blockers: string[];
  warnings: string[];
  notes: string[];
}

interface ScoreArgs {
  script: ScriptResult;
  scraped: ScrapedData;
  template: TemplateProfile;
  domainPack: DomainPack;
  minScore: number;
  maxWarnings?: number;
  failOnWarnings?: boolean;
}

const PLACEHOLDER_PATTERNS = [
  /lorem ipsum/i,
  /tbd/i,
  /insert .* here/i,
  /your brand/i,
  /example\.com/i,
];

export function scoreScriptQuality(args: ScoreArgs): QualityReport {
  const {script, scraped, template, domainPack, minScore, maxWarnings = 3, failOnWarnings = false} = args;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  let score = 100;

  if (!Array.isArray(script.features) || script.features.length !== 3) {
    blockers.push('Script must contain exactly 3 features.');
    score -= 35;
  }

  if (!Array.isArray(script.narrationSegments) || script.narrationSegments.length !== 8) {
    blockers.push('Narration must contain exactly 8 scene segments.');
    score -= 35;
  }

  const narrationWords = countWords(script.narrationSegments.join(' '));
  if (narrationWords < 100 || narrationWords > 140) {
    warnings.push(`Narration word count ${narrationWords} is outside target range (100-140).`);
    score -= 10;
  } else {
    notes.push(`Narration length in target range (${narrationWords} words).`);
  }

  const hookWords = [script.hookLine1, script.hookLine2, script.hookKeyword].map((line) => countWords(line));
  hookWords.forEach((wordCount, i) => {
    if (wordCount < 2 || wordCount > 4) {
      warnings.push(`Hook line ${i + 1} should be 2-4 words.`);
      score -= 3;
    }
  });

  const ctaDomain = normalizeDomain(script.ctaUrl);
  const scrapedDomain = normalizeDomain(scraped.domain);
  if (!ctaDomain.includes(scrapedDomain) && !scrapedDomain.includes(ctaDomain)) {
    warnings.push(`CTA URL (${script.ctaUrl}) does not match scraped domain (${scraped.domain}).`);
    score -= 8;
  }

  const brandNameNormalized = normalize(script.brandName);
  const titleNormalized = normalize(scraped.title);
  const domainCore = normalize(scraped.domain.split('.')[0] ?? '');
  if (!titleNormalized.includes(brandNameNormalized) && !brandNameNormalized.includes(domainCore)) {
    warnings.push('Brand name appears weakly aligned with source site title/domain.');
    score -= 6;
  }

  const appNames = new Set<string>();
  for (const feature of script.features) {
    const app = normalize(feature.appName);
    if (appNames.has(app)) {
      warnings.push('Feature app names should be distinct contexts.');
      score -= 4;
      break;
    }
    appNames.add(app);

    if (!domainPack.allowedIcons.includes(feature.icon as any)) {
      warnings.push(`Feature icon "${feature.icon}" is not allowed for domain pack "${domainPack.id}".`);
      score -= 5;
    }
  }

  for (const feature of script.features) {
    if (!feature.caption || countWords(feature.caption) > 6) {
      warnings.push(`Feature caption "${feature.caption}" should be concise (<=6 words).`);
      score -= 2;
    }

    if (!feature.demoLines || feature.demoLines.length === 0) {
      blockers.push(`Feature "${feature.appName}" has no demo lines.`);
      score -= 12;
      continue;
    }

    const joined = feature.demoLines.join(' ');
    if (countWords(joined) < 6) {
      warnings.push(`Feature "${feature.appName}" demo content is too thin.`);
      score -= 3;
    }

    if (!containsConcreteSignal(joined, domainPack.concreteFields)) {
      warnings.push(`Feature "${feature.appName}" lacks concrete on-screen detail (names/numbers/status).`);
      score -= 3;
    }
  }

  const textCorpus = [
    script.brandName,
    script.tagline,
    script.hookLine1,
    script.hookLine2,
    script.hookKeyword,
    ...script.narrationSegments,
    ...script.features.flatMap((f) => [f.appName, f.caption, ...f.demoLines]),
    ...script.integrations,
  ].join(' ');

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(textCorpus)) {
      blockers.push(`Detected placeholder content matching /${pattern.source}/.`);
      score -= 20;
    }
  }

  for (const forbidden of domainPack.forbiddenTerms) {
    if (containsTerm(textCorpus, forbidden)) {
      warnings.push(`Domain mismatch term detected for pack ${domainPack.id}: "${forbidden}".`);
      score -= 6;
    }
  }

  if (!script.narrationSegments[2]?.toLowerCase().includes(script.brandName.toLowerCase().split(' ')[0] ?? '')) {
    warnings.push('Wordmark narration segment should explicitly introduce the brand name.');
    score -= 4;
  }

  if (script.integrations.length < 2 || script.integrations.length > 12) {
    warnings.push('Integrations should contain 2-12 items.');
    score -= 3;
  }

  const integrationOverlap = script.integrations.some((item) =>
    domainPack.fallbackIntegrations.some((candidate) => normalize(item) === normalize(candidate)),
  );
  if (!integrationOverlap) {
    warnings.push(`No integrations overlap with domain pack defaults for "${domainPack.id}".`);
    score -= 2;
  }

  if (script.domainPackId && script.domainPackId !== domainPack.id) {
    warnings.push(`Script pack id "${script.domainPackId}" does not match selected pack "${domainPack.id}".`);
    score -= 4;
  }

  const targetWeight = template.sceneWeightHint;
  if (Array.isArray(script.sceneWeights) && script.sceneWeights.length === 8) {
    const deviation = averageDeviation(script.sceneWeights, targetWeight);
    if (deviation > 5) {
      notes.push(`Scene pacing deviation vs template: ${deviation.toFixed(1)}.`);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const warningGatePassed = failOnWarnings ? warnings.length === 0 : warnings.length <= maxWarnings;

  return {
    score,
    minScore,
    passed: blockers.length === 0 && score >= minScore && warningGatePassed,
    blockers,
    warnings,
    notes,
  };
}

export function toQualityFeedback(report: QualityReport): string[] {
  return [...report.blockers, ...report.warnings].slice(0, 8);
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeDomain(urlOrDomain: string): string {
  const candidate = urlOrDomain.startsWith('http') ? urlOrDomain : `https://${urlOrDomain}`;
  try {
    return new URL(candidate).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return urlOrDomain.replace(/^www\./, '').toLowerCase();
  }
}

function containsConcreteSignal(value: string, fields: string[]): boolean {
  const fieldRegex = fields.length > 0
    ? new RegExp(fields.map((f) => escapeRegex(f)).join('|'), 'i')
    : null;
  return /\d/.test(value) || /(status|due|owner|assigned|priority|revenue|conversion|ticket|order|ETA)/i.test(value) || Boolean(fieldRegex && fieldRegex.test(value));
}

function averageDeviation(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const total = a.reduce((acc, cur, idx) => acc + Math.abs(cur - b[idx]), 0);
  return total / a.length;
}

function containsTerm(haystack: string, term: string): boolean {
  const normalized = term.toLowerCase().trim();
  if (!normalized) return false;
  const phrase = normalized.split(/\s+/).map((part) => escapeRegex(part)).join('\\s+');
  return new RegExp(`(^|\\W)${phrase}(?=\\W|$)`, 'i').test(haystack.toLowerCase());
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

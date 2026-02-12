import type {ScrapedData} from './scraper';
import type {ScriptResult} from './script-types';

export interface GroundingHints {
  terms: string[];
  phrases: string[];
  numbers: string[];
  integrationCandidates: string[];
}

export interface GroundingSummary {
  coverage: number;
  matchedTerms: number;
  totalTerms: number;
  matchedPhrases: number;
  totalPhrases: number;
  matchedNumbers: number;
  totalNumbers: number;
  sampleMatches: string[];
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'you', 'our', 'are', 'was', 'were', 'will', 'have',
  'has', 'had', 'into', 'over', 'under', 'across', 'about', 'their', 'them', 'they', 'its', 'more', 'less', 'than',
  'not', 'all', 'one', 'two', 'three', 'best', 'top', 'new', 'now', 'can', 'get', 'use', 'used', 'using', 'app',
  'apps', 'platform', 'product', 'solution', 'services', 'service', 'build', 'built', 'help', 'helps', 'make',
  'made', 'teams', 'team', 'users', 'user',
]);

const KNOWN_TOOLS = [
  'Slack', 'Notion', 'HubSpot', 'Zapier', 'GitHub', 'Vercel', 'Sentry', 'Linear',
  'Shopify', 'Stripe', 'Klaviyo', 'Zendesk', 'Plaid', 'QuickBooks', 'Salesforce',
  'Discord', 'Twitch', 'YouTube', 'TikTok', 'Instagram', 'Substack',
  'Google Classroom', 'Canvas', 'Zoom', 'Zillow', 'Redfin', 'DocuSign', 'Calendly',
  'Booking.com', 'Airbnb', 'Expedia', 'ShipStation', 'UPS', 'FedEx', 'SAP',
  'Reddit', 'Telegram', 'Google Drive',
];

export function extractGroundingHints(scraped: ScrapedData): GroundingHints {
  const text = [
    scraped.title,
    scraped.description,
    scraped.ogTitle,
    scraped.ogDescription,
    ...scraped.headings,
    ...scraped.features,
    ...(scraped.structuredHints ?? []),
    scraped.bodyText,
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const phrases = collectPhrases(scraped);
  const numbers = collectNumbers(text);
  const terms = collectTerms(text, scraped.domain);
  const integrationCandidates = collectIntegrationCandidates(scraped, text);

  return {
    terms,
    phrases,
    numbers,
    integrationCandidates,
  };
}

export function hasGroundingSignal(text: string, hints: GroundingHints): boolean {
  if (!text.trim()) return false;
  const lower = text.toLowerCase();
  if (hints.phrases.some((phrase) => lower.includes(phrase.toLowerCase()))) return true;
  if (hints.numbers.some((num) => lower.includes(num.toLowerCase()))) return true;
  if (hints.terms.some((term) => hasWholePhrase(lower, term))) return true;
  return false;
}

export function pickGroundedPhrase(hints: GroundingHints, index: number): string | null {
  if (hints.phrases.length > 0) return hints.phrases[index % hints.phrases.length];
  if (hints.terms.length > 0) return toTitleCase(hints.terms[index % hints.terms.length]);
  return null;
}

export function pickGroundedNumber(hints: GroundingHints, index: number): string | null {
  if (hints.numbers.length === 0) return null;
  return hints.numbers[index % hints.numbers.length];
}

export function pickGroundedIntegration(hints: GroundingHints, index: number): string | null {
  if (hints.integrationCandidates.length === 0) return null;
  return hints.integrationCandidates[index % hints.integrationCandidates.length];
}

export function summarizeGroundingUsage(script: ScriptResult, hints: GroundingHints): GroundingSummary {
  const corpus = [
    script.brandName,
    script.tagline,
    script.hookLine1,
    script.hookLine2,
    script.hookKeyword,
    ...script.narrationSegments,
    ...script.features.flatMap((feature) => [feature.appName, feature.caption, ...feature.demoLines]),
    ...script.integrations,
  ].join(' ').toLowerCase();

  const matchedTerms = hints.terms.filter((term) => hasWholePhrase(corpus, term));
  const matchedPhrases = hints.phrases.filter((phrase) => corpus.includes(phrase.toLowerCase()));
  const matchedNumbers = hints.numbers.filter((num) => corpus.includes(num.toLowerCase()));

  const denominator = Math.max(1, hints.terms.length + hints.phrases.length + hints.numbers.length);
  const coverage = Number(((matchedTerms.length + matchedPhrases.length + matchedNumbers.length) / denominator).toFixed(2));

  return {
    coverage,
    matchedTerms: matchedTerms.length,
    totalTerms: hints.terms.length,
    matchedPhrases: matchedPhrases.length,
    totalPhrases: hints.phrases.length,
    matchedNumbers: matchedNumbers.length,
    totalNumbers: hints.numbers.length,
    sampleMatches: [...matchedPhrases, ...matchedTerms.slice(0, 5), ...matchedNumbers.slice(0, 3)].slice(0, 8),
  };
}

function collectPhrases(scraped: ScrapedData): string[] {
  const raw = [
    ...scraped.headings,
    ...scraped.features,
    ...splitSentences(scraped.description),
    ...splitSentences(scraped.ogDescription),
    ...(scraped.structuredHints ?? []),
  ];

  const phrases = raw
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length >= 12 && line.length <= 72)
    .filter((line) => countWords(line) >= 2 && countWords(line) <= 9)
    .map((line) => line.replace(/[.!?;:]+$/, '').trim());

  return dedupeByNormalized(phrases).slice(0, 18);
}

function collectTerms(text: string, domain: string): string[] {
  const freq = new Map<string, number>();
  const domainRoot = domain.replace(/^www\./, '').split('.')[0]?.toLowerCase() ?? '';

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  for (const token of words) {
    if (token.length < 3 || token.length > 24) continue;
    if (/^\d+$/.test(token)) continue;
    if (STOP_WORDS.has(token)) continue;
    if (token === domainRoot) continue;
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token)
    .slice(0, 30);
}

function collectNumbers(text: string): string[] {
  const matches = text.match(/\$?\d[\d,.]*(?:\.\d+)?%?/g) || [];
  return dedupeByNormalized(matches.map((m) => m.trim())).slice(0, 20);
}

function collectIntegrationCandidates(scraped: ScrapedData, text: string): string[] {
  const fromLinks = scraped.links
    .map((entry) => normalizeWhitespace(entry.split(':')[0] || ''))
    .filter((label) => label.length >= 2 && label.length <= 30);

  const fromKnownTools = KNOWN_TOOLS.filter((tool) => hasWholePhrase(text.toLowerCase(), tool.toLowerCase()));
  return dedupeByNormalized([...fromLinks, ...fromKnownTools]).slice(0, 12);
}

function splitSentences(value: string): string[] {
  if (!value.trim()) return [];
  return value
    .split(/[.!?]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function countWords(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function dedupeByNormalized(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function hasWholePhrase(haystackLower: string, phraseLower: string): boolean {
  const phrase = phraseLower.trim().split(/\s+/).map((part) => escapeRegex(part)).join('\\s+');
  if (!phrase) return false;
  return new RegExp(`(^|\\W)${phrase}(?=\\W|$)`, 'i').test(haystackLower);
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

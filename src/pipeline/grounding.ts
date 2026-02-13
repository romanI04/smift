import type {ScrapedData} from './scraper';
import type {ScriptResult} from './script-types';
import type {DomainPackId} from './domain-packs';

export interface GroundingHints {
  terms: string[];
  phrases: string[];
  featureNameCandidates: string[];
  numbers: string[];
  integrationCandidates: string[];
}

export interface FeatureEvidencePlanItem {
  slot: number;
  featureName: string;
  requiredPhrases: string[];
  preferredNumber?: string;
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
  'made', 'teams', 'team', 'users', 'user', 'company', 'companies',
]);

const FEATURE_NOISE_WORDS = new Set([
  'all', 'one', 'next', 'nextbig', 'best', 'future', 'today', 'available', 'line', 'behind', 'they', 'their',
  'every', 'across', 'more', 'less', 'great', 'better', 'new', 'modern', 'ultimate',
  'here', 'there', 'forever', 'everyone', 'mers', 'thing', 'things',
  'leading', 'highest', 'trusted', 'deliver', 'delivering', 'powerful', 'smarter',
]);

const FEATURE_VERB_WORDS = new Set([
  'make', 'move', 'define', 'review', 'understand', 'build', 'built', 'turn', 'plan', 'deploy', 'take',
  'care', 'grow', 'start', 'manage', 'track', 'improve', 'launch', 'ship', 'run',
]);

const KNOWN_TOOLS = [
  'Slack', 'Notion', 'HubSpot', 'Zapier', 'GitHub', 'Vercel', 'Sentry', 'Linear',
  'Shopify', 'Stripe', 'Klaviyo', 'Zendesk', 'Plaid', 'QuickBooks', 'Salesforce',
  'Discord', 'Twitch', 'YouTube', 'TikTok', 'Instagram', 'Substack',
  'Google Classroom', 'Canvas', 'Zoom', 'Zillow', 'Redfin', 'DocuSign', 'Calendly',
  'Booking.com', 'Airbnb', 'Expedia', 'ShipStation', 'UPS', 'FedEx', 'SAP',
  'Reddit', 'Telegram', 'Google Drive',
];

const INTEGRATION_ALIAS_MAP: Record<string, string> = {
  'google docs': 'Google Drive',
  'google sheets': 'Google Drive',
  'gdrive': 'Google Drive',
  'gtm': 'Google Drive',
  'github.com': 'GitHub',
  'gh': 'GitHub',
  'yt': 'YouTube',
  'google classroom': 'Google Classroom',
  'quick books': 'QuickBooks',
  'bookings': 'Booking.com',
  'booking': 'Booking.com',
  'air bnb': 'Airbnb',
  'fed ex': 'FedEx',
  'docu sign': 'DocuSign',
};

const TOOL_KEY_TO_CANONICAL = buildToolDictionary();
const SPARSE_PACK_FALLBACK_NAMES: Record<DomainPackId, string[]> = {
  general: ['Workflow Signals', 'Execution Visibility', 'Action Pipeline'],
  'b2b-saas': ['Support Inbox', 'Customer Timeline', 'AI Agent Routing'],
  devtools: ['Build Health', 'Release Pipeline', 'Incident Triage'],
  'ecommerce-retail': ['Catalog Performance', 'Checkout Flow', 'Retention Campaigns'],
  fintech: ['Risk Monitoring', 'Transaction Controls', 'Settlement Visibility'],
  gaming: ['Meta Tracking', 'Comp Guidance', 'Patch Readiness'],
  'media-creator': ['Content Pipeline', 'Audience Signals', 'Publishing Analytics'],
  education: ['Learner Progress', 'Course Milestones', 'Assessment Signals'],
  'real-estate': ['Listing Pipeline', 'Offer Tracking', 'Close Readiness'],
  'travel-hospitality': ['Booking Ops', 'Guest Journey', 'Property Readiness'],
  'logistics-ops': ['Route Tracking', 'Dispatch Visibility', 'ETA Reliability'],
  'social-community': ['Community Health', 'Moderation Queue', 'Engagement Signals'],
};

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
  const featureNameCandidates = collectFeatureNameCandidates(scraped, phrases);
  const numbers = collectNumbers(text);
  const terms = collectTerms(text, scraped.domain);
  const integrationCandidates = collectIntegrationCandidates(scraped, text);

  return {
    terms,
    phrases,
    featureNameCandidates,
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
  if (hints.featureNameCandidates.length > 0) return hints.featureNameCandidates[index % hints.featureNameCandidates.length];
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

export function buildFeatureEvidencePlan(
  hints: GroundingHints,
  count = 3,
  packId: DomainPackId = 'general',
): FeatureEvidencePlanItem[] {
  const slots = Math.max(1, count);
  let phrasePool = dedupeByNormalized([
    ...hints.featureNameCandidates,
    ...hints.phrases,
  ])
    .map((phrase) => normalizeWhitespace(phrase))
    .filter((phrase) => phrase.length >= 8)
    .slice(0, 24);

  if (isSparseGrounding(hints) || phrasePool.length < slots + 2) {
    const sparseSynth = synthesizeSparseFeaturePhrases(hints, slots * 4);
    phrasePool = dedupeByNormalized([
      ...phrasePool,
      ...SPARSE_PACK_FALLBACK_NAMES[packId],
      ...sparseSynth,
    ]).slice(0, 28);
  }

  const plan: FeatureEvidencePlanItem[] = [];
  const usedNames = new Set<string>();
  for (let i = 0; i < slots; i++) {
    const sourceName = phrasePool[i] ?? pickGroundedPhrase(hints, i) ?? `Feature ${i + 1}`;
    let featureName = canonicalizeFeatureName(sourceName, hints, i);
    if (usedNames.has(featureName.toLowerCase())) {
      const synthesized = synthesizeFeatureName(hints, i);
      featureName = usedNames.has(synthesized.toLowerCase()) ? `${synthesized} ${i + 1}` : synthesized;
    }
    usedNames.add(featureName.toLowerCase());
    const requiredPhrases = dedupeByNormalized([
      phrasePool[i] ?? '',
      phrasePool[(i + slots) % Math.max(1, phrasePool.length)] ?? '',
      featureName,
    ]
      .map((phrase) => phrase.replace(/[.!?;:]+$/, '').trim())
      .filter((phrase) => phrase.length >= 6))
      .slice(0, 2);

    plan.push({
      slot: i + 1,
      featureName,
      requiredPhrases: requiredPhrases.length > 0 ? requiredPhrases : [featureName],
      ...(pickGroundedNumber(hints, i) ? {preferredNumber: pickGroundedNumber(hints, i) as string} : {}),
    });
  }

  return plan;
}

export function canonicalizeFeatureName(raw: string, hints: GroundingHints, index: number): string {
  const candidate = cleanupFeatureLabel(raw);
  const similarity = bestLabelSimilarity(candidate, hints.featureNameCandidates);
  const specificity = labelSpecificityScore(candidate, hints);
  const sparseNoPhraseGrounding = hints.featureNameCandidates.length === 0 && hints.phrases.length === 0;
  if (
    isStrongFeatureLabel(candidate)
    && (
      (hasGroundingSignal(candidate, hints) && (hints.featureNameCandidates.length === 0 || similarity >= 0.34))
      || sparseNoPhraseGrounding
    )
    && specificity >= 2
  ) {
    return candidate;
  }

  const fallback = hints.featureNameCandidates[index % Math.max(1, hints.featureNameCandidates.length)]
    ?? hints.phrases[index % Math.max(1, hints.phrases.length)]
    ?? toTitleCase(hints.terms[index % Math.max(1, hints.terms.length)] ?? `Feature ${index + 1}`);
  const cleanedFallback = cleanupFeatureLabel(fallback);
  if (isStrongFeatureLabel(cleanedFallback) && labelSpecificityScore(cleanedFallback, hints) >= 2) {
    return cleanedFallback;
  }

  return synthesizeFeatureName(hints, index);
}

export function canonicalizeIntegrations(
  integrations: string[],
  hints: GroundingHints,
  fallbackIntegrations: string[] = [],
  limit = 12,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | null) => {
    if (!value) return;
    const canonical = resolveIntegrationName(value) ?? titleTokenize(value);
    const key = normalizeToolKey(canonical);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(canonical);
  };

  for (const integration of integrations) add(integration);
  for (const integration of hints.integrationCandidates) add(integration);
  for (const integration of fallbackIntegrations) add(integration);

  return out.slice(0, limit);
}

export function resolveIntegrationName(value: string): string | null {
  const raw = normalizeWhitespace(value);
  if (!raw) return null;
  const alias = INTEGRATION_ALIAS_MAP[raw.toLowerCase()];
  if (alias) return alias;

  const key = normalizeToolKey(raw);
  if (!key) return null;
  if (TOOL_KEY_TO_CANONICAL[key]) return TOOL_KEY_TO_CANONICAL[key];

  const best = KNOWN_TOOLS.find((tool) => hasWholePhrase(raw.toLowerCase(), tool.toLowerCase()));
  return best ?? null;
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

function collectFeatureNameCandidates(scraped: ScrapedData, phrases: string[]): string[] {
  const phraseDerived = phrases
    .map((phrase) => featureLabelFromPhrase(phrase))
    .filter((line) => isStrongFeatureLabel(line));

  const titleChunks = scraped.title
    .split(/[|:\-]/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
  const raw = [...scraped.headings, ...scraped.features, ...titleChunks, ...phrases];

  const rawDerived = raw
    .map((line) => cleanupFeatureLabel(line))
    .filter((line) => isStrongFeatureLabel(line));

  return dedupeByNormalized([...phraseDerived, ...rawDerived]).slice(0, 24);
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
  const out: string[] = [];
  for (const entry of scraped.links) {
    const [label, href] = entry.split(':').map((x) => normalizeWhitespace(x || ''));
    const resolvedLabel = resolveIntegrationName(label);
    if (resolvedLabel) out.push(resolvedLabel);
    const resolvedHref = resolveIntegrationName(href);
    if (resolvedHref) out.push(resolvedHref);
  }

  for (const tool of KNOWN_TOOLS) {
    if (hasWholePhrase(text.toLowerCase(), tool.toLowerCase())) out.push(tool);
  }

  return dedupeByNormalized(out).slice(0, 12);
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

function cleanupFeatureLabel(value: string): string {
  const tokens = value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => sanitizeFeatureToken(token))
    .filter(Boolean)
    .filter((token) => {
      const lower = token.toLowerCase();
      if (lower.length < 3 || lower.length > 16) return false;
      if (STOP_WORDS.has(lower) || FEATURE_NOISE_WORDS.has(lower)) return false;
      if (/^\d+$/.test(lower)) return false;
      return true;
    })
    .slice(0, 4);

  if (tokens.length === 0) return '';
  return toTitleCase(tokens.join(' '));
}

function isStrongFeatureLabel(label: string): boolean {
  if (!label) return false;
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  const lowerWords = words.map((w) => w.toLowerCase());
  if (lowerWords.some((word) => FEATURE_NOISE_WORDS.has(word))) return false;
  if (lowerWords.some((word) => /andthe|theand|withthe|forthe/.test(word))) return false;
  if (lowerWords.some((word) => word.length > 16)) return false;
  // Labels ending in bare verbs read as awkward artifacts ("Direction Define").
  if (FEATURE_VERB_WORDS.has(lowerWords[lowerWords.length - 1])) return false;
  return true;
}

function sanitizeFeatureToken(token: string): string {
  return token.toLowerCase().trim();
}

function featureLabelFromPhrase(phrase: string): string {
  const tokens = phrase
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => sanitizeFeatureToken(token))
    .filter(Boolean)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token) && !FEATURE_NOISE_WORDS.has(token));

  const nonVerbs = tokens.filter((token) => !FEATURE_VERB_WORDS.has(token));
  const verbs = tokens.filter((token) => FEATURE_VERB_WORDS.has(token));

  // Prefer noun-like terms. Only borrow verbs if there are too few non-verb tokens.
  const selected = [...nonVerbs.slice(0, 3)];
  for (const verb of verbs) {
    if (selected.length >= 2) break;
    selected.push(verb);
  }

  if (selected.length >= 3 && FEATURE_VERB_WORDS.has(selected[selected.length - 1])) {
    selected.pop();
  }

  const label = toTitleCase(selected.slice(0, 3).join(' '));
  return cleanupFeatureLabel(label);
}

function bestLabelSimilarity(label: string, candidates: string[]): number {
  if (!label || candidates.length === 0) return 0;
  let best = 0;
  for (const candidate of candidates) {
    best = Math.max(best, tokenOverlap(label, candidate));
  }
  return best;
}

function tokenOverlap(a: string, b: string): number {
  const aTokens = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const bTokens = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let common = 0;
  for (const token of aTokens) if (bTokens.has(token)) common += 1;
  return common / Math.max(aTokens.size, bTokens.size);
}

function labelSpecificityScore(label: string, hints: GroundingHints): number {
  const tokens = label.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;

  const topTerms = new Set(hints.terms.slice(0, 20));
  let score = 0;
  for (const token of tokens) {
    if (token.length >= 4) score += 1;
    if (topTerms.has(token)) score += 1;
    if (FEATURE_NOISE_WORDS.has(token) || STOP_WORDS.has(token)) score -= 2;
  }
  return score;
}

function synthesizeFeatureName(hints: GroundingHints, index: number): string {
  const baseTerms = hints.terms
    .filter((term) => term.length >= 4 && !STOP_WORDS.has(term) && !FEATURE_NOISE_WORDS.has(term))
    .slice(0, 12);
  if (baseTerms.length === 0) return `Feature ${index + 1}`;

  const first = baseTerms[(index * 2) % baseTerms.length];
  const second = baseTerms[(index * 2 + 1) % baseTerms.length];
  const third = baseTerms[(index * 2 + 2) % baseTerms.length];
  const composed = [first, second, third]
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
  return toTitleCase(composed || `Feature ${index + 1}`);
}

function synthesizeSparseFeaturePhrases(hints: GroundingHints, limit: number): string[] {
  const baseTerms = hints.terms
    .filter((term) => term.length >= 4 && !STOP_WORDS.has(term) && !FEATURE_NOISE_WORDS.has(term))
    .slice(0, 12);
  const out: string[] = [];
  const suffixes = ['Workflows', 'Signals', 'Insights', 'Automation', 'Operations', 'Tracking'];
  for (let i = 0; i < baseTerms.length; i++) {
    const first = toTitleCase(baseTerms[i]);
    const second = baseTerms[(i + 1) % baseTerms.length];
    if (second) out.push(`${first} ${toTitleCase(second)}`);
    out.push(`${first} ${suffixes[i % suffixes.length]}`);
    if (out.length >= limit) break;
  }
  return dedupeByNormalized(out).slice(0, limit);
}

function isSparseGrounding(hints: GroundingHints): boolean {
  return hints.featureNameCandidates.length < 2 && hints.phrases.length < 2;
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

function titleTokenize(value: string): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
  return normalized ? toTitleCase(normalized) : '';
}

function normalizeToolKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildToolDictionary(): Record<string, string> {
  const dict: Record<string, string> = {};
  for (const tool of KNOWN_TOOLS) {
    dict[normalizeToolKey(tool)] = tool;
  }
  for (const [alias, canonical] of Object.entries(INTEGRATION_ALIAS_MAP)) {
    dict[normalizeToolKey(alias)] = canonical;
  }
  return dict;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

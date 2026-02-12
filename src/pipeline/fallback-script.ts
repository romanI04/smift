import type {Feature} from '../types';
import type {ScrapedData} from './scraper';
import type {ScriptResult} from './script-types';
import type {TemplateProfile} from './templates';
import type {DomainPack, DomainPackId, FeatureIconId} from './domain-packs';
import {
  buildFeatureEvidencePlan,
  canonicalizeFeatureName,
  canonicalizeIntegrations,
  extractGroundingHints,
  pickGroundedNumber,
  pickGroundedPhrase,
  type FeatureEvidencePlanItem,
  type GroundingHints,
} from './grounding';

export function buildFallbackScript(
  scraped: ScrapedData,
  template: TemplateProfile,
  domainPack: DomainPack,
  groundingHintsArg?: GroundingHints,
): ScriptResult {
  const groundingHints = groundingHintsArg ?? extractGroundingHints(scraped);
  const brandName = inferBrandName(scraped);
  const brandUrl = scraped.domain;
  const brandColor = pickBrandColor(scraped.colors);
  const accentColor = pickAccentColor(scraped.colors, brandColor);

  const tagline = makeTagline(scraped);
  const hooks = buildHooks(domainPack.id);

  const features = buildFeatures(scraped, domainPack, groundingHints);
  const integrations = buildIntegrations(scraped, domainPack, groundingHints);
  const ctaUrl = scraped.domain;

  const narrationSegments = buildNarration({
    brandName,
    ctaUrl,
    features,
    integrations,
    template,
    domainPack,
  });

  const sceneWeights = narrationSegments.map((segment, i) => {
    const words = Math.max(2, segment.trim().split(/\s+/).filter(Boolean).length);
    const templateBias = template.sceneWeightHint[i] ?? words;
    return Math.round((words + templateBias) / 2);
  });

  return {
    brandName,
    brandUrl,
    brandColor,
    accentColor,
    tagline,
    hookLine1: hooks.hookLine1,
    hookLine2: hooks.hookLine2,
    hookKeyword: hooks.hookKeyword,
    features,
    integrations,
    ctaUrl,
    domainPackId: domainPack.id,
    narrationSegments,
    sceneWeights,
  };
}

function inferBrandName(scraped: ScrapedData): string {
  const titleHead = scraped.title.split(/[|\-:]/)[0]?.trim();
  if (titleHead && titleHead.length >= 2 && titleHead.length <= 42) return titleHead;

  const domainCore = scraped.domain.replace(/^www\./, '').split('.')[0] ?? 'Brand';
  return domainCore.charAt(0).toUpperCase() + domainCore.slice(1);
}

function pickBrandColor(colors: string[]): string {
  return normalizeHex(colors.find((c) => c.startsWith('#')) ?? '#111111');
}

function pickAccentColor(colors: string[], brandColor: string): string {
  const hexColors = colors.map(normalizeHex).filter(Boolean) as string[];
  const candidate = hexColors.find((color) => color.toLowerCase() !== brandColor.toLowerCase());
  return candidate ?? '#2563EB';
}

function normalizeHex(color: string): string {
  if (!color) return '#111111';
  if (color.startsWith('#')) {
    if (color.length === 4) {
      return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`.toUpperCase();
    }
    return color.slice(0, 7).toUpperCase();
  }
  return '#111111';
}

function makeTagline(scraped: ScrapedData): string {
  const source = scraped.description || scraped.ogDescription || scraped.headings[0] || 'Built for faster execution';
  const words = source
    .replace(/[|,:;.!?]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  if (words.length < 3) return 'Built for better decisions';
  return words.join(' ');
}

function buildHooks(packId: DomainPackId): {hookLine1: string; hookLine2: string; hookKeyword: string} {
  const map: Record<DomainPackId, {hookLine1: string; hookLine2: string; hookKeyword: string}> = {
    general: {hookLine1: 'your process', hookLine2: 'loses momentum', hookKeyword: 'fix the flow'},
    'b2b-saas': {hookLine1: 'your workflows', hookLine2: 'are fragmented', hookKeyword: 'ship clearer'},
    devtools: {hookLine1: 'your releases', hookLine2: 'slow down', hookKeyword: 'debug faster'},
    'ecommerce-retail': {hookLine1: 'your store', hookLine2: 'leaks conversions', hookKeyword: 'optimize checkout'},
    fintech: {hookLine1: 'your money ops', hookLine2: 'lack visibility', hookKeyword: 'control risk'},
    gaming: {hookLine1: 'your climb', hookLine2: 'stalls mid patch', hookKeyword: 'play the meta'},
    'media-creator': {hookLine1: 'your content', hookLine2: 'needs consistency', hookKeyword: 'grow audience'},
    education: {hookLine1: 'your learners', hookLine2: 'need momentum', hookKeyword: 'improve outcomes'},
    'real-estate': {hookLine1: 'your pipeline', hookLine2: 'drops deals', hookKeyword: 'close faster'},
    'travel-hospitality': {hookLine1: 'your bookings', hookLine2: 'need precision', hookKeyword: 'delight guests'},
    'logistics-ops': {hookLine1: 'your operations', hookLine2: 'lose timing', hookKeyword: 'move reliably'},
    'social-community': {hookLine1: 'your community', hookLine2: 'needs structure', hookKeyword: 'raise engagement'},
  };
  return map[packId];
}

function buildFeatures(scraped: ScrapedData, domainPack: DomainPack, groundingHints: GroundingHints): Feature[] {
  const evidencePlan = buildFeatureEvidencePlan(groundingHints, 3);
  const groundedSeeds = groundingHints.phrases.slice(0, 8);
  const seeds = [
    ...evidencePlan.flatMap((item) => item.requiredPhrases),
    ...groundedSeeds,
    ...scraped.features.filter((f) => f.length > 20),
  ].slice(0, 14);
  const selected = pickDistinctSeeds(seeds, 3);

  while (selected.length < 3) {
    selected.push(defaultSeedForPack(domainPack.id, selected.length));
  }

  return selected.map((seed, index) => {
    const evidence = evidencePlan[index];
    const icon = inferIcon(seed, domainPack.allowedIcons);
    const groundedPhrase = evidence?.requiredPhrases[0] ?? pickGroundedPhrase(groundingHints, index);
    const caption = captionFromSeed(groundedPhrase ?? seed);
    const appName = evidence?.featureName ?? canonicalizeFeatureName(groundedPhrase ?? seed, groundingHints, index);
    const demoLines = demoLinesFromSeed(seed, index, domainPack, groundingHints, evidence);
    return {
      icon,
      appName,
      caption,
      demoLines,
    };
  });
}

function pickDistinctSeeds(seeds: string[], count: number): string[] {
  const out: string[] = [];
  for (const seed of seeds) {
    const normalized = normalize(seed);
    if (out.some((existing) => overlap(normalize(existing), normalized) > 0.7)) continue;
    out.push(seed);
    if (out.length >= count) break;
  }
  return out;
}

function overlap(a: string, b: string): number {
  const aTokens = new Set(a.split(/\s+/).filter(Boolean));
  const bTokens = new Set(b.split(/\s+/).filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let common = 0;
  for (const token of aTokens) if (bTokens.has(token)) common += 1;
  return common / Math.min(aTokens.size, bTokens.size);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function inferIcon(seed: string, allowedIcons: FeatureIconId[]): Feature['icon'] {
  const text = seed.toLowerCase();
  const ranked: FeatureIconId[] = [];

  if (/mail|inbox|email/.test(text)) ranked.push('mail');
  if (/support|ticket|case|help/.test(text)) ranked.push('support');
  if (/calendar|schedule|meeting|booking/.test(text)) ranked.push('calendar');
  if (/analytics|metrics|insights|trend|rate|rank/.test(text)) ranked.push('analytics');
  if (/checkout|order|cart|product|shop/.test(text)) ranked.push('commerce');
  if (/code|developer|api|deploy|sdk/.test(text)) ranked.push('code');
  if (/chat|message|conversation|community/.test(text)) ranked.push('chat');
  if (/finance|billing|invoice|payment|risk/.test(text)) ranked.push('finance');
  if (/video|stream|content|media/.test(text)) ranked.push('media');
  if (/social|creator|audience/.test(text)) ranked.push('social');

  ranked.push('generic');

  for (const icon of ranked) {
    if (allowedIcons.includes(icon)) return icon;
  }

  return allowedIcons[0] ?? 'generic';
}

function captionFromSeed(seed: string): string {
  const words = seed
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  if (words.length < 2) return 'Clear execution signal';
  return words.join(' ');
}

function demoLinesFromSeed(
  seed: string,
  index: number,
  pack: DomainPack,
  groundingHints: GroundingHints,
  evidence?: FeatureEvidencePlanItem,
): string[] {
  const groundedPhrase = evidence?.requiredPhrases[0] ?? pickGroundedPhrase(groundingHints, index) ?? seed;
  const firstLine = groundedPhrase.length > 64 ? `${groundedPhrase.slice(0, 61)}...` : groundedPhrase;
  const fields = pack.concreteFields;
  const groundedNumber = evidence?.preferredNumber ?? pickGroundedNumber(groundingHints, index);

  return [
    firstLine,
    `${fields[0] ?? 'Status'}: ${groundedNumber ?? sampleValue(fields[0] ?? 'Status', index)}`,
    `${fields[1] ?? 'Update'}: ${sampleValue(fields[1] ?? 'Update', index + 1)}`,
    `${fields[2] ?? 'Next Step'}: ${sampleValue(fields[2] ?? 'Next Step', index + 2)}`,
  ];
}

function sampleValue(field: string, seed: number): string {
  const key = field.toLowerCase();
  const n = (seed % 5) + 1;
  if (key.includes('patch')) return `14.${n}`;
  if (key.includes('win')) return `${52 + n}.${n}%`;
  if (key.includes('rank')) return `Top ${n * 100}`;
  if (key.includes('build')) return `Variant ${String.fromCharCode(64 + n)}`;
  if (key.includes('order')) return `#ORD-${4200 + n}`;
  if (key.includes('conversion')) return `${2 + n * 0.3}%`;
  if (key.includes('stock')) return `${90 - n * 8} units`;
  if (key.includes('risk')) return `${60 + n * 5}/100`;
  if (key.includes('txn')) return `${n * 240} / hr`;
  if (key.includes('deploy')) return `build-${100 + n}`;
  if (key.includes('latency')) return `${110 + n * 7}ms`;
  if (key.includes('error')) return `${0.2 + n * 0.1}%`;
  if (key.includes('views')) return `${12 + n * 4}k`;
  if (key.includes('retention')) return `${38 + n * 3}%`;
  if (key.includes('cohort')) return `C${2026}${n}`;
  if (key.includes('occupancy')) return `${72 + n * 4}%`;
  if (key.includes('arrival')) return `Today ${9 + n}:00`;
  if (key.includes('eta')) return `${15 + n} min`;
  if (key.includes('route')) return `R-${30 + n}`;
  if (key.includes('members')) return `${n * 1200}`;
  if (key.includes('engagement')) return `${6 + n * 0.8}%`;
  if (key.includes('status')) return ['Ready', 'In Progress', 'Blocked'][seed % 3];
  return `${field} ${n}`;
}

function buildIntegrations(scraped: ScrapedData, pack: DomainPack, groundingHints: GroundingHints): string[] {
  const fromLinks = scraped.links
    .map((entry) => entry.split(':')[0].trim())
    .filter((label) => label.length >= 2 && label.length <= 24)
    .slice(0, 12);
  return canonicalizeIntegrations(fromLinks, groundingHints, pack.fallbackIntegrations, 6);
}

function buildNarration(args: {
  brandName: string;
  ctaUrl: string;
  features: Feature[];
  integrations: string[];
  template: TemplateProfile;
  domainPack: DomainPack;
}): string[] {
  const {brandName, ctaUrl, features, integrations, template, domainPack} = args;

  const valuePhrase = domainOutcomePhrase(domainPack.id);

  const segments = [
    `What if your ${domainNoun(domainPack.id)} could improve every cycle?`,
    `Most teams lose momentum because signals arrive late and decisions stay fragmented across tools and channels.`,
    `Meet ${brandName}, built for clearer execution in this domain.`,
    `${features[0].appName} gives your team live context, so priorities are obvious and the next move happens faster.`,
    `${features[1].appName} reduces lag between insight and action by keeping key updates structured and visible.`,
    `${features[2].appName} turns raw updates into practical decisions, so ${valuePhrase}.`,
    `It connects with ${integrations.slice(0, 3).join(', ')} so you can keep your current workflow and move faster.`,
    `See ${brandName} in action at ${ctaUrl}.`,
  ];

  return normalizeNarrationLength(segments, template.id);
}

function domainOutcomePhrase(packId: DomainPackId): string {
  const map: Record<DomainPackId, string> = {
    general: 'results improve without extra overhead',
    'b2b-saas': 'teams ship work with less status churn',
    devtools: 'engineering cycles stay stable under pressure',
    'ecommerce-retail': 'conversion and retention move in the right direction',
    fintech: 'risk and control stay visible in real time',
    gaming: 'players stay ahead of every patch shift',
    'media-creator': 'content output and engagement stay consistent',
    education: 'learners progress with more confidence',
    'real-estate': 'deals move from interest to close faster',
    'travel-hospitality': 'guest experience stays smooth from booking to arrival',
    'logistics-ops': 'operations stay on time with fewer surprises',
    'social-community': 'community quality and engagement stay healthy',
  };
  return map[packId];
}

function domainNoun(packId: DomainPackId): string {
  const map: Record<DomainPackId, string> = {
    general: 'product',
    'b2b-saas': 'operations stack',
    devtools: 'engineering workflow',
    'ecommerce-retail': 'commerce operation',
    fintech: 'financial workflow',
    gaming: 'competitive play',
    'media-creator': 'content engine',
    education: 'learning experience',
    'real-estate': 'deal pipeline',
    'travel-hospitality': 'guest operation',
    'logistics-ops': 'supply operation',
    'social-community': 'community workflow',
  };
  return map[packId];
}

function normalizeNarrationLength(segments: string[], templateId: TemplateProfile['id']): string[] {
  const addOns = templateId === 'founder-story'
    ? [
      'It keeps every decision grounded in clear context.',
      'You can see what changed and what to do next.',
    ]
    : [
      'This shortens the gap between signal and execution.',
      'Your team gets predictable momentum across each cycle.',
    ];

  const countWords = () => segments.join(' ').trim().split(/\s+/).filter(Boolean).length;

  let i = 0;
  while (countWords() < 100 && i < 10) {
    const target = 3 + (i % 4);
    segments[target] = `${segments[target]} ${addOns[i % addOns.length]}`;
    i += 1;
  }

  if (countWords() > 140) {
    const caps = [12, 16, 12, 21, 21, 21, 18, 14];
    for (let idx = 0; idx < segments.length; idx++) {
      const words = segments[idx].split(/\s+/).filter(Boolean);
      if (words.length > caps[idx]) {
        segments[idx] = `${words.slice(0, caps[idx]).join(' ').replace(/[,.!?;:]+$/, '')}.`;
      }
    }
  }

  return segments;
}

function defaultSeedForPack(packId: DomainPackId, index: number): string {
  const defaults: Record<DomainPackId, string[]> = {
    general: ['Structured execution view', 'Signal tracking in one place', 'Action-ready updates'],
    'b2b-saas': ['Workflow automation visibility', 'Cross-team status clarity', 'Prioritized execution queue'],
    devtools: ['Deploy and incident visibility', 'Build signal aggregation', 'Runtime performance tracking'],
    'ecommerce-retail': ['Checkout flow optimization', 'Inventory and demand signals', 'Retention performance updates'],
    fintech: ['Real-time transaction monitoring', 'Risk and compliance signal board', 'Settlement and reconciliation visibility'],
    gaming: ['Patch-by-patch tier tracking', 'Meta trend signal board', 'Comp and rank optimization insights'],
    'media-creator': ['Content pipeline planning', 'Audience signal visibility', 'Publishing performance tracking'],
    education: ['Learner progress tracking', 'Curriculum sequencing visibility', 'Assessment performance insights'],
    'real-estate': ['Listing and showing timeline', 'Offer progression tracking', 'Close readiness signals'],
    'travel-hospitality': ['Reservation operations visibility', 'Guest journey status tracking', 'Property readiness signals'],
    'logistics-ops': ['Shipment and route visibility', 'Capacity planning signals', 'On-time performance tracking'],
    'social-community': ['Community engagement tracking', 'Moderation status visibility', 'Member health signal board'],
  };

  return defaults[packId][index] ?? defaults.general[index] ?? 'Execution signal update';
}

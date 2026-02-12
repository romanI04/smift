import type {Feature} from '../types';
import type {ScrapedData} from './scraper';
import type {ScriptResult} from './script-types';
import type {TemplateProfile} from './templates';

const DEFAULT_INTEGRATIONS = ['Slack', 'Notion', 'Google Drive', 'GitHub', 'Zapier', 'HubSpot'];

export function buildFallbackScript(scraped: ScrapedData, template: TemplateProfile): ScriptResult {
  const brandName = inferBrandName(scraped);
  const brandUrl = scraped.domain;
  const brandColor = pickBrandColor(scraped.colors);
  const accentColor = pickAccentColor(scraped.colors, brandColor);

  const tagline = makeTagline(scraped);
  const hookLine1 = 'your workflow';
  const hookLine2 = 'is overloaded';
  const hookKeyword = 'ship faster';

  const features = buildFeatures(scraped);
  const integrations = buildIntegrations(scraped);
  const ctaUrl = scraped.domain;

  const narrationSegments = buildNarration({
    brandName,
    ctaUrl,
    features,
    integrations,
    template,
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
    hookLine1,
    hookLine2,
    hookKeyword,
    features,
    integrations,
    ctaUrl,
    narrationSegments,
    sceneWeights,
  };
}

function inferBrandName(scraped: ScrapedData): string {
  const titleHead = scraped.title.split(/[|\-:]/)[0]?.trim();
  if (titleHead && titleHead.length >= 2 && titleHead.length <= 40) return titleHead;

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
  const source = scraped.description || scraped.ogDescription || scraped.headings[0] || 'Work moves faster here';
  const words = source
    .replace(/[|,:;.!?]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  if (words.length < 3) return 'Workflows that move faster';
  return words.join(' ');
}

function buildFeatures(scraped: ScrapedData): Feature[] {
  const seeds = scraped.features.filter((f) => f.length > 20).slice(0, 12);
  const selected = pickDistinctSeeds(seeds, 3);

  while (selected.length < 3) {
    selected.push(['Automated workflow handoff', 'Real-time team visibility', 'Faster execution across tools'][selected.length]);
  }

  return selected.map((seed, index) => {
    const icon = inferIcon(seed);
    const caption = captionFromSeed(seed);
    const appName = appNameFromSeed(seed, index);
    const demoLines = demoLinesFromSeed(seed, index);
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
    if (out.some((existing) => overlap(normalize(existing), normalized) > 0.7)) {
      continue;
    }
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
  for (const t of aTokens) if (bTokens.has(t)) common += 1;
  return common / Math.min(aTokens.size, bTokens.size);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function inferIcon(seed: string): Feature['icon'] {
  const text = seed.toLowerCase();
  if (/mail|inbox|email/.test(text)) return 'mail';
  if (/support|ticket|case|help/.test(text)) return 'support';
  if (/calendar|schedule|meeting/.test(text)) return 'calendar';
  if (/analytics|metrics|revenue|dashboard/.test(text)) return 'analytics';
  if (/checkout|order|cart|product|shop/.test(text)) return 'commerce';
  if (/code|developer|api/.test(text)) return 'code';
  if (/chat|message|conversation/.test(text)) return 'chat';
  if (/finance|billing|invoice|payment/.test(text)) return 'finance';
  return 'generic';
}

function captionFromSeed(seed: string): string {
  const words = seed
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  if (words.length < 2) return 'Faster team execution';
  return words.join(' ');
}

function appNameFromSeed(seed: string, index: number): string {
  const cleaned = seed
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(' ')
    .trim();

  if (cleaned.length >= 3) return cleaned;

  const defaults = ['Execution Board', 'Ops Queue', 'Team Timeline'];
  return defaults[index] ?? `Feature ${index + 1}`;
}

function demoLinesFromSeed(seed: string, index: number): string[] {
  const defaults = [
    ['Project rollout status', 'Owner: Maya', 'Due: Friday 4:00 PM', 'Priority: High'],
    ['Customer escalation queue', 'Status: In Progress', 'Assigned to: Jordan', 'SLA: 2h'],
    ['Weekly growth dashboard', 'Revenue: $48.2k', 'Conversion: 3.8%', 'Action: Launch experiment B'],
  ];

  const base = defaults[index] ?? defaults[0];
  const firstLine = seed.length > 60 ? `${seed.slice(0, 57)}...` : seed;
  return [firstLine, ...base.slice(1)];
}

function buildIntegrations(scraped: ScrapedData): string[] {
  const normalized = new Set<string>();
  const fromLinks = scraped.links
    .map((entry) => entry.split(':')[0].trim())
    .filter((label) => label.length >= 2 && label.length <= 24)
    .slice(0, 12);

  const picked: string[] = [];
  for (const candidate of [...fromLinks, ...DEFAULT_INTEGRATIONS]) {
    const key = candidate.toLowerCase();
    if (normalized.has(key)) continue;
    normalized.add(key);
    picked.push(candidate);
    if (picked.length >= 6) break;
  }

  return picked;
}

function buildNarration(args: {
  brandName: string;
  ctaUrl: string;
  features: Feature[];
  integrations: string[];
  template: TemplateProfile;
}): string[] {
  const {brandName, ctaUrl, features, integrations, template} = args;

  const segments = [
    'Why do teams still lose momentum after great planning?',
    'Your workflow is overloaded, updates are scattered, and execution slows when context gets fragmented.',
    `Meet ${brandName}. A clearer way to execute.`,
    `${features[0].appName} keeps critical work visible with clear ownership, priority, and next action so decisions turn into shipping steps faster.`,
    `${features[1].appName} removes handoff friction by capturing context where work happens, so teams can resolve blockers before timelines slip.`,
    `${features[2].appName} gives live performance signals and concrete metrics, helping you focus on outcomes that move conversion and retention.`,
    `It plugs into ${integrations.slice(0, 3).join(', ')} and your existing stack, so adoption is fast and workflows stay intact.`,
    `Launch faster with ${brandName} at ${ctaUrl}.`,
  ];

  return normalizeNarrationLength(segments, template.id);
}

function normalizeNarrationLength(segments: string[], templateId: TemplateProfile['id']): string[] {
  const addOns = templateId === 'founder-story'
    ? [
      'It keeps teams aligned without adding another layer of overhead.',
      'You can see exactly what to do next, and why it matters now.',
    ]
    : [
      'This cuts status churn and shortens the path from planning to delivery.',
      'Everyone sees ownership, risk, and momentum in one operating view.',
    ];

  const countWords = () => segments.join(' ').trim().split(/\s+/).filter(Boolean).length;

  let i = 0;
  while (countWords() < 100 && i < 10) {
    const target = 3 + (i % 4);
    segments[target] = `${segments[target]} ${addOns[i % addOns.length]}`;
    i += 1;
  }

  if (countWords() > 140) {
    const caps = [10, 16, 10, 22, 22, 22, 20, 12];
    for (let idx = 0; idx < segments.length; idx++) {
      const words = segments[idx].split(/\s+/).filter(Boolean);
      if (words.length > caps[idx]) {
        segments[idx] = `${words.slice(0, caps[idx]).join(' ').replace(/[,.!?;:]+$/, '')}.`;
      }
    }
  }

  return segments;
}

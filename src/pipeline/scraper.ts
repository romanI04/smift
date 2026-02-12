import * as cheerio from 'cheerio';

export interface ScrapedData {
  url: string;
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  headings: string[];
  features: string[];
  bodyText: string;
  structuredHints: string[];
  colors: string[];
  links: string[];
  domain: string;
  scrapeMode?: 'full' | 'metadata-fallback';
  scrapeWarnings?: string[];
}

export async function scrapeUrl(url: string): Promise<ScrapedData> {
  if (!url.startsWith('http')) url = `https://${url}`;
  const primary = new URL(url);
  const fetchCandidates = buildFetchCandidates(primary);

  let html = '';
  let finalUrl = primary.toString();
  let lastError = '';

  for (const candidate of fetchCandidates) {
    try {
      const res = await fetch(candidate, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });

      if (!res.ok) {
        lastError = `Failed to fetch ${candidate}: ${res.status}`;
        continue;
      }

      html = await res.text();
      finalUrl = candidate;
      break;
    } catch (e: any) {
      lastError = `Fetch error for ${candidate}: ${e.message}`;
    }
  }

  if (!html) {
    throw new Error(lastError || `Failed to fetch ${url}`);
  }

  const domain = new URL(finalUrl).hostname.replace('www.', '');
  const $ = cheerio.load(html);

  // Capture CSS before removing style tags.
  const styleText = [
    $('style').text(),
    $('[style]')
      .map((_, el) => $(el).attr('style'))
      .get()
      .join(' '),
  ].join(' ');

  // Title
  let title = normalizeWhitespace($('title').text());

  // Meta
  let description = normalizeWhitespace($('meta[name="description"]').attr('content') || '');
  let ogTitle = normalizeWhitespace($('meta[property="og:title"]').attr('content') || '');
  let ogDescription = normalizeWhitespace($('meta[property="og:description"]').attr('content') || '');
  const ogImage = $('meta[property="og:image"]').attr('content') || '';

  // Remove noisy elements for cleaner semantic text extraction.
  $('script, style, noscript, svg, nav, footer, header, iframe').remove();

  const structuredHints = extractStructuredHints($);
  const rawBodyText = normalizeWhitespace($('body').text()).slice(0, 3200);
  const blockSignals = detectBlockedSignals({
    title,
    description,
    ogTitle,
    ogDescription,
    bodyText: rawBodyText,
  });

  let scrapeMode: 'full' | 'metadata-fallback' = 'full';
  let scrapeWarnings: string[] = [];

  // Headings (h1, h2, h3)
  const headings: string[] = [];
  $('h1, h2, h3').each((_, el) => {
    const text = normalizeWhitespace($(el).text());
    if (text && text.length > 3 && text.length < 200) {
      headings.push(text);
    }
  });

  // Feature-like content from headings, list items, and lead paragraphs.
  const textCandidates: string[] = [];
  $('h2, h3, li, p').each((_, el) => {
    const text = normalizeWhitespace($(el).text());
    if (!text) return;
    textCandidates.push(text);
  });

  let features: string[] = [];
  for (const text of textCandidates) {
    if (looksLikeFeature(text) && !features.includes(text)) {
      features.push(text);
    }
  }

  let bodyText = rawBodyText;

  if (blockSignals.blockedLikely) {
    const sanitizedMeta = sanitizeBlockedMetadata({title, description, ogTitle, ogDescription, domain});
    title = sanitizedMeta.title;
    description = sanitizedMeta.description;
    ogTitle = sanitizedMeta.ogTitle;
    ogDescription = sanitizedMeta.ogDescription;

    const fallback = extractMetadataFallback({
      title,
      description,
      ogTitle,
      ogDescription,
      structuredHints,
      domain,
    });
    scrapeMode = 'metadata-fallback';
    scrapeWarnings = blockSignals.reasons;
    headings.splice(0, headings.length, ...fallback.headings);
    features = fallback.features;
    bodyText = fallback.bodyText;
  }

  // Colors from inline styles and CSS custom properties
  const colors: string[] = [];
  const colorRegex = /#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|hsl\([^)]+\)/g;
  const foundColors = styleText.match(colorRegex) || [];
  // Deduplicate and take top 10
  const uniqueColors = [...new Set(foundColors)]
    .filter((c) => !['#fff', '#ffffff', '#000', '#000000'].includes(c.toLowerCase()))
    .slice(0, 12);
  colors.push(...uniqueColors);

  // Important links
  const links: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = normalizeWhitespace($(el).text());
    if (text && href && !href.startsWith('#') && text.length < 120) {
      links.push(`${text}: ${href}`);
    }
  });

  return {
    url: finalUrl,
    title,
    description,
    ogTitle,
    ogDescription,
    ogImage,
    headings: headings.slice(0, 20),
    features: features.slice(0, 30),
    bodyText,
    structuredHints,
    colors,
    links: links.slice(0, 20),
    domain,
    scrapeMode,
    scrapeWarnings,
  };
}

function buildFetchCandidates(base: URL): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const host = base.hostname;
  const path = `${base.pathname}${base.search}`;

  const add = (candidate: string) => {
    if (seen.has(candidate)) return;
    seen.add(candidate);
    out.push(candidate);
  };

  add(base.toString());
  add(`https://${host}${path}`);
  add(`http://${host}${path}`);

  if (!host.startsWith('www.')) {
    add(`https://www.${host}${path}`);
    add(`http://www.${host}${path}`);
  } else {
    const naked = host.replace(/^www\./, '');
    add(`https://${naked}${path}`);
    add(`http://${naked}${path}`);
  }

  return out;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function looksLikeFeature(text: string): boolean {
  if (text.length < 18 || text.length > 220) return false;
  if (!/[a-zA-Z]/.test(text)) return false;

  const lower = text.toLowerCase();
  const bannedSnippets = [
    'cookie',
    'privacy policy',
    'terms of service',
    'sign in',
    'log in',
    'download on the',
    'all rights reserved',
    'subscribe',
  ];
  if (bannedSnippets.some((b) => lower.includes(b))) return false;

  // Prefer lines that look like value propositions.
  const valueWords = [
    'automate',
    'track',
    'manage',
    'analyze',
    'secure',
    'faster',
    'save',
    'reduce',
    'improve',
    'real-time',
    'insights',
    'workflow',
    'team',
    'customers',
    'orders',
    'payments',
    'support',
    'supply',
    'health',
    'learning',
  ];
  return valueWords.some((w) => lower.includes(w)) || /\b(with|for|without|across)\b/.test(lower);
}

function detectBlockedSignals(args: {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  bodyText: string;
}): {blockedLikely: boolean; reasons: string[]} {
  const corpus = [
    args.title,
    args.description,
    args.ogTitle,
    args.ogDescription,
    args.bodyText.slice(0, 1800),
  ].join(' ').toLowerCase();

  const markers: Array<{pattern: RegExp; reason: string}> = [
    {pattern: /\bunsupported client\b/, reason: 'unsupported-client'},
    {pattern: /\bunsupported browser\b/, reason: 'unsupported-browser'},
    {pattern: /\benable javascript\b/, reason: 'enable-javascript'},
    {pattern: /\baccess denied\b/, reason: 'access-denied'},
    {pattern: /\bforbidden\b/, reason: 'forbidden'},
    {pattern: /\bsecurity check\b/, reason: 'security-check'},
    {pattern: /\bcaptcha\b/, reason: 'captcha'},
    {pattern: /\bcloudflare\b/, reason: 'cloudflare'},
    {pattern: /\bjust a moment\b/, reason: 'challenge-page'},
    {pattern: /\bautomated requests\b/, reason: 'bot-detection'},
  ];

  const reasons = markers
    .filter((entry) => entry.pattern.test(corpus))
    .map((entry) => entry.reason);
  return {blockedLikely: reasons.length > 0, reasons};
}

function sanitizeBlockedMetadata(args: {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  domain: string;
}): {title: string; description: string; ogTitle: string; ogDescription: string} {
  const blockedTerms = [
    'unsupported',
    'forbidden',
    'captcha',
    'cloudflare',
    'javascript',
    'update browser',
    'please update',
    'old browser',
    'access denied',
  ];
  const clean = (value: string) => {
    const text = normalizeWhitespace(value);
    if (!text) return '';
    const lower = text.toLowerCase();
    if (blockedTerms.some((term) => lower.includes(term))) return '';
    return text;
  };

  const domainCore = toTitleCase(args.domain.split('.')[0]?.replace(/[^a-z0-9]/gi, ' ').trim() || 'Brand');
  const cleanOgTitle = clean(args.ogTitle);
  const cleanTitle = clean(args.title);
  const title = cleanOgTitle || cleanTitle || domainCore;
  const description = clean(args.description);
  const ogDescription = clean(args.ogDescription);

  return {
    title,
    description,
    ogTitle: cleanOgTitle,
    ogDescription,
  };
}

function extractMetadataFallback(args: {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  structuredHints: string[];
  domain: string;
}): {headings: string[]; features: string[]; bodyText: string} {
  const blockedTerms = [
    'unsupported',
    'forbidden',
    'captcha',
    'cloudflare',
    'javascript',
    'update browser',
    'please update',
    'old browser',
    'seems old',
    'access denied',
  ];
  const rawLines = dedupeByNormalized([
    args.ogTitle,
    args.title,
    ...splitSentences(args.description),
    ...splitSentences(args.ogDescription),
    ...args.structuredHints,
  ])
    .map(normalizeWhitespace)
    .filter((line) => line.length >= 8 && line.length <= 180)
    .filter((line) => !blockedTerms.some((term) => line.toLowerCase().includes(term)));

  const headings = rawLines.slice(0, 8);

  const features: string[] = [];
  for (const line of rawLines) {
    if (looksLikeFeature(line) || countWords(line) >= 3) {
      features.push(line);
    }
    if (features.length >= 12) break;
  }

  const domainCore = args.domain.split('.')[0]?.replace(/[^a-z0-9]/gi, ' ').trim() || 'product';
  while (features.length < 3) {
    const fallback = [
      `${toTitleCase(domainCore)} product updates`,
      `${toTitleCase(domainCore)} usage insights`,
      `${toTitleCase(domainCore)} feature highlights`,
    ][features.length];
    features.push(fallback);
  }

  const bodyParts = dedupeByNormalized([
    args.title,
    args.ogTitle,
    args.description,
    args.ogDescription,
    ...args.structuredHints,
    ...features,
  ]);
  const bodyText = normalizeWhitespace(bodyParts.join(' ')).slice(0, 2200);

  return {
    headings,
    features: dedupeByNormalized(features).slice(0, 20),
    bodyText,
  };
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

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
}

function extractStructuredHints($: cheerio.CheerioAPI): string[] {
  const out: string[] = [];
  const keys = new Set(['@type', 'applicationcategory', 'category', 'keywords', 'genre', 'industry', 'servicetype', 'about']);

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    const parsed = safeParseJson(raw);
    if (!parsed) return;
    collectStructuredTerms(parsed, keys, out);
  });

  return [...new Set(out.map(normalizeWhitespace).filter((x) => x.length >= 3 && x.length <= 80))].slice(0, 30);
}

function safeParseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

function collectStructuredTerms(node: unknown, keys: Set<string>, out: string[]) {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) collectStructuredTerms(item, keys, out);
    return;
  }
  if (typeof node !== 'object') return;

  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    const normalizedKey = key.toLowerCase();
    if (keys.has(normalizedKey)) {
      pushStructuredValue(value, out);
    }
    if (typeof value === 'object' && value !== null) {
      collectStructuredTerms(value, keys, out);
    }
  }
}

function pushStructuredValue(value: unknown, out: string[]) {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') out.push(item);
      else if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).name === 'string') {
        out.push(String((item as Record<string, unknown>).name));
      }
    }
    return;
  }
  if (value && typeof value === 'object') {
    const name = (value as Record<string, unknown>).name;
    if (typeof name === 'string') out.push(name);
  }
}

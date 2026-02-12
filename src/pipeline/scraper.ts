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
  colors: string[];
  links: string[];
  domain: string;
}

export async function scrapeUrl(url: string): Promise<ScrapedData> {
  // Normalize URL
  if (!url.startsWith('http')) url = `https://${url}`;
  const domain = new URL(url).hostname.replace('www.', '');

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });

  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const html = await res.text();
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
  const title = normalizeWhitespace($('title').text());

  // Meta
  const description = normalizeWhitespace($('meta[name="description"]').attr('content') || '');
  const ogTitle = normalizeWhitespace($('meta[property="og:title"]').attr('content') || '');
  const ogDescription = normalizeWhitespace($('meta[property="og:description"]').attr('content') || '');
  const ogImage = $('meta[property="og:image"]').attr('content') || '';

  // Remove noisy elements for cleaner semantic text extraction.
  $('script, style, noscript, svg, nav, footer, header, iframe').remove();

  // Headings (h1, h2, h3)
  const headings: string[] = [];
  $('h1, h2, h3').each((_, el) => {
    const text = normalizeWhitespace($(el).text());
    if (text && text.length > 3 && text.length < 200) {
      headings.push(text);
    }
  });

  // Feature-like content from headings, list items, and lead paragraphs.
  const candidates: string[] = [];
  $('h2, h3, li, p').each((_, el) => {
    const text = normalizeWhitespace($(el).text());
    if (!text) return;
    candidates.push(text);
  });

  const features: string[] = [];
  for (const text of candidates) {
    if (looksLikeFeature(text) && !features.includes(text)) {
      features.push(text);
    }
  }

  // Body text (first 3000 chars of visible text)
  const bodyText = normalizeWhitespace($('body').text()).slice(0, 3200);

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
    url,
    title,
    description,
    ogTitle,
    ogDescription,
    ogImage,
    headings: headings.slice(0, 20),
    features: features.slice(0, 30),
    bodyText,
    colors,
    links: links.slice(0, 20),
    domain,
  };
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

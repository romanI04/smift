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

  // Remove scripts, styles, nav, footer for cleaner text
  $('script, style, nav, footer, header').remove();

  // Title
  const title = $('title').text().trim();

  // Meta
  const description = $('meta[name="description"]').attr('content') || '';
  const ogTitle = $('meta[property="og:title"]').attr('content') || '';
  const ogDescription = $('meta[property="og:description"]').attr('content') || '';
  const ogImage = $('meta[property="og:image"]').attr('content') || '';

  // Headings (h1, h2, h3)
  const headings: string[] = [];
  $('h1, h2, h3').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 3 && text.length < 200) {
      headings.push(text);
    }
  });

  // Feature-like content (li items, cards with short text)
  const features: string[] = [];
  $('li, [class*="feature"], [class*="benefit"], [class*="card"]').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 10 && text.length < 300 && !features.includes(text)) {
      features.push(text);
    }
  });

  // Body text (first 3000 chars of visible text)
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3000);

  // Colors from inline styles and CSS custom properties
  const colors: string[] = [];
  const colorRegex = /#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|hsl\([^)]+\)/g;
  const styleText = $('style').text() + ' ' + ($('[style]').map((_, el) => $(el).attr('style')).get().join(' '));
  const foundColors = styleText.match(colorRegex) || [];
  // Deduplicate and take top 10
  const uniqueColors = [...new Set(foundColors)].slice(0, 10);
  colors.push(...uniqueColors);

  // Important links
  const links: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (text && href && !href.startsWith('#') && text.length < 100) {
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

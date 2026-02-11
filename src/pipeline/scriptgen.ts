import OpenAI from 'openai';
import type {VideoProps} from '../types';
import type {ScrapedData} from './scraper';

const SYSTEM_PROMPT = `You are a video script writer for SaaS product intro videos.
Given scraped website data, you generate structured video content.

Output ONLY valid JSON matching this exact schema:
{
  "brandName": "string - the product/company name",
  "brandUrl": "string - domain like example.com",
  "brandColor": "string - hex color, primary brand color (default #000000)",
  "accentColor": "string - hex color, accent/highlight color (default #2563EB)",
  "tagline": "string - short tagline or value prop, max 8 words",
  "hookLine1": "string - 2-3 words, sets up the hook (e.g. 'your inbox')",
  "hookLine2": "string - 2-3 words, the problem (e.g. 'is drowning')",
  "hookKeyword": "string - 2-3 words, the twist/solution hint (e.g. 'in noise')",
  "narration": "string - full voiceover script, 30-40 words, conversational tone",
  "features": [
    {
      "icon": "mail|ai|social|code|calendar|analytics|chat|generic",
      "appName": "string - app name for the demo UI",
      "caption": "string - 3-5 word benefit caption",
      "demoLines": ["string - realistic text content that would appear in the app"]
    }
  ],
  "integrations": ["string - app names the product works with, max 12"],
  "ctaUrl": "string - domain"
}

Rules:
- hookLine1 + hookLine2 + hookKeyword form a provocative 3-line hook
- features array must have exactly 3 items
- Each feature should show a DIFFERENT app/context the product works in
- demoLines should be realistic content a user would see
- For email features: first demoLine is subject, rest is body with proper paragraph breaks (use empty strings for breaks)
- For AI/chat features: one continuous paragraph
- narration should flow naturally when read aloud, covering hook → brand → features → CTA
- Pick icon types that match the feature context
- integrations should be real app names the product connects with`;

export async function generateScript(scraped: ScrapedData): Promise<VideoProps & {narration: string}> {
  const apiKey = process.env.openai_api_key;
  if (!apiKey) throw new Error('Missing openai_api_key in environment');

  const client = new OpenAI({apiKey});

  const userPrompt = `Generate a video script for this product:

URL: ${scraped.url}
Domain: ${scraped.domain}
Title: ${scraped.title}
Description: ${scraped.description}
OG Title: ${scraped.ogTitle}
OG Description: ${scraped.ogDescription}

Headings found on page:
${scraped.headings.join('\n')}

Features/benefits found:
${scraped.features.slice(0, 15).join('\n')}

Body text excerpt:
${scraped.bodyText.slice(0, 1500)}

Colors found: ${scraped.colors.join(', ')}`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {role: 'system', content: SYSTEM_PROMPT},
      {role: 'user', content: userPrompt},
    ],
    temperature: 0.7,
    response_format: {type: 'json_object'},
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI');

  const parsed = JSON.parse(content);

  // Validate required fields
  const required = ['brandName', 'brandUrl', 'tagline', 'hookLine1', 'hookLine2', 'hookKeyword', 'features', 'integrations', 'ctaUrl'];
  for (const field of required) {
    if (!parsed[field]) throw new Error(`Missing required field: ${field}`);
  }
  if (parsed.features.length !== 3) {
    throw new Error(`Expected 3 features, got ${parsed.features.length}`);
  }

  return {
    brandName: parsed.brandName,
    brandUrl: parsed.brandUrl,
    brandColor: parsed.brandColor || '#000000',
    accentColor: parsed.accentColor || '#2563EB',
    tagline: parsed.tagline,
    hookLine1: parsed.hookLine1,
    hookLine2: parsed.hookLine2,
    hookKeyword: parsed.hookKeyword,
    features: parsed.features,
    integrations: parsed.integrations.slice(0, 12),
    ctaUrl: parsed.ctaUrl,
    narration: parsed.narration || '',
  };
}

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
  "narrationSegments": [
    "string - 1: spoken during brand reveal (3-5 words, e.g. 'Tired of messy projects?')",
    "string - 2: spoken during hook text (5-8 words)",
    "string - 3: spoken during wordmark (3-5 words, e.g. 'Meet Linear.')",
    "string - 4: spoken during feature 1 demo (8-12 words)",
    "string - 5: spoken during feature 2 demo (8-12 words)",
    "string - 6: spoken during feature 3 demo (8-12 words)",
    "string - 7: spoken during integrations (6-10 words)",
    "string - 8: spoken during closing/CTA (5-8 words, must include the URL)"
  ],
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
- narrationSegments must have exactly 8 items, one per scene
- The segments must flow naturally as one continuous voiceover when read in order
- Each segment maps to a specific visual scene — the words should match what's on screen
- Segment 1 (brand reveal): opening question or statement
- Segment 2 (hook text): expand the problem, matches hookLine1/hookLine2/hookKeyword
- Segment 3 (wordmark): introduce the brand name ("Meet X." or "Introducing X.")
- Segment 4-6 (features): describe what each feature does, matching the feature order
- Segment 7 (integrations): mention how it connects/works with other tools
- Segment 8 (closing): call to action with the URL
- Keep total narration to 50-65 words
- Pick icon types that match the feature context
- integrations should be real app names the product connects with`;

export interface ScriptResult extends VideoProps {
  narrationSegments: string[];
}

export async function generateScript(scraped: ScrapedData): Promise<ScriptResult> {
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
  const required = ['brandName', 'brandUrl', 'tagline', 'hookLine1', 'hookLine2', 'hookKeyword', 'features', 'integrations', 'ctaUrl', 'narrationSegments'];
  for (const field of required) {
    if (!parsed[field]) throw new Error(`Missing required field: ${field}`);
  }
  if (parsed.features.length !== 3) {
    throw new Error(`Expected 3 features, got ${parsed.features.length}`);
  }
  if (!Array.isArray(parsed.narrationSegments) || parsed.narrationSegments.length !== 8) {
    throw new Error(`Expected 8 narration segments, got ${parsed.narrationSegments?.length}`);
  }

  // Compute scene weights from word counts
  const sceneWeights = parsed.narrationSegments.map((seg: string) => {
    const words = seg.trim().split(/\s+/).length;
    return Math.max(words, 2); // minimum 2 words weight
  });

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
    narrationSegments: parsed.narrationSegments,
    sceneWeights,
  };
}

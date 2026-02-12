import OpenAI from 'openai';
import type {VideoProps} from '../types';
import type {ScrapedData} from './scraper';

const SYSTEM_PROMPT = `You are a video script writer for product intro videos across industries.
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
    "string - 1: spoken during brand reveal (6-10 words, opening question or bold statement about the pain point)",
    "string - 2: spoken during hook text (10-15 words, expand the problem, build tension)",
    "string - 3: spoken during wordmark (5-8 words, introduce the brand — 'Meet X.' or 'Introducing X. The way it should be.')",
    "string - 4: spoken during feature 1 demo (15-20 words, describe what the feature does and WHY it matters)",
    "string - 5: spoken during feature 2 demo (15-20 words, describe the second feature with a concrete benefit)",
    "string - 6: spoken during feature 3 demo (15-20 words, describe the third feature, paint the picture)",
    "string - 7: spoken during integrations (12-18 words, mention it works everywhere, name 2-3 specific apps)",
    "string - 8: spoken during closing/CTA (8-12 words, call to action with the URL, end on a high note)"
  ],
  "features": [
    {
      "icon": "mail|ai|social|code|calendar|analytics|chat|commerce|finance|health|support|docs|media|generic",
      "appName": "string - context name shown in the demo UI (e.g. 'Checkout Queue', 'Patient Intake', 'Case Review')",
      "caption": "string - 3-5 word benefit caption",
      "demoLines": ["string - realistic text content that would appear in the app"]
    }
  ],
  "integrations": ["string - real channels/tools/platforms the product works with, max 12"],
  "ctaUrl": "string - domain"
}

Rules:
- hookLine1 + hookLine2 + hookKeyword form a provocative 3-line hook
- features array must have exactly 3 items
- Each feature should show a DIFFERENT context the product works in
- Do not assume a dev-tool/SaaS context; adapt to the website's actual domain
- demoLines should be realistic content a user would see
- For email features: first demoLine is subject, rest is body with proper paragraph breaks (use empty strings for breaks)
- For non-email contexts: include concrete on-screen data points (names, numbers, statuses, actions)
- narrationSegments must have exactly 8 items, one per scene
- The segments must flow naturally as one continuous voiceover when read in order
- Each segment maps to a specific visual scene — the words should match what's on screen
- Segment 1 (brand reveal): opening question or statement
- Segment 2 (hook text): expand the problem, matches hookLine1/hookLine2/hookKeyword
- Segment 3 (wordmark): introduce the brand name ("Meet X." or "Introducing X.")
- Segment 4-6 (features): describe what each feature does, matching the feature order
- Segment 7 (integrations): mention how it connects/works with other tools
- Segment 8 (closing): call to action with the URL
- Keep total narration between 100-140 words — this drives a 35-45 second voiceover
- Each segment should be a complete thought, spoken at a natural conversational pace
- Feature segments (4-6) should be the longest, describing the benefit vividly
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

  let parsed: any = null;
  let lastError = 'Unknown script generation error';

  for (let attempt = 0; attempt < 3; attempt++) {
    const correctionHint = attempt === 0
      ? ''
      : `\n\nIMPORTANT RETRY REQUIREMENTS:
- Your previous answer violated constraints.
- Keep narrationSegments at exactly 8 items.
- Keep total narration between 100 and 140 words (strict).
- Preserve realistic feature contexts and concrete on-screen details.
- Output valid JSON only.`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {role: 'system', content: SYSTEM_PROMPT},
        {role: 'user', content: userPrompt + correctionHint},
      ],
      temperature: 0.7,
      response_format: {type: 'json_object'},
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      lastError = 'Empty response from OpenAI';
      continue;
    }

    try {
      const candidate = JSON.parse(content);
      validateParsedScript(candidate);
      let words = candidate.narrationSegments.join(' ').trim().split(/\s+/).filter(Boolean).length;
      if (words < 100 || words > 140) {
        if (attempt < 2) {
          lastError = `Narration word count ${words} outside 100-140`;
          continue;
        }

        candidate.narrationSegments = enforceNarrationWordRange(candidate.narrationSegments);
        words = candidate.narrationSegments.join(' ').trim().split(/\s+/).filter(Boolean).length;
        if (words < 100 || words > 140) {
          lastError = `Narration word count ${words} outside 100-140 after local normalization`;
          continue;
        }
      }
      parsed = candidate;
      break;
    } catch (e: any) {
      lastError = e.message;
    }
  }

  if (!parsed) {
    throw new Error(`Failed to generate valid script after retries: ${lastError}`);
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

function validateParsedScript(parsed: any): void {
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
}

function enforceNarrationWordRange(segments: string[]): string[] {
  const next = [...segments];
  const countWords = () => next.join(' ').trim().split(/\s+/).filter(Boolean).length;

  const boosters = [
    'This keeps teams moving from idea to outcome faster.',
    'It removes manual handoffs and duplicated work.',
    'You get clear visibility into priorities, owners, and status.',
    'Execution keeps moving even when plans change.',
  ];

  let words = countWords();
  let boosterIndex = 0;
  while (words < 100) {
    const targetSegment = 3 + (boosterIndex % 4); // Enrich feature + integration scenes.
    next[targetSegment] = `${next[targetSegment]} ${boosters[boosterIndex % boosters.length]}`.trim();
    boosterIndex += 1;
    words = countWords();
    if (boosterIndex > 20) break;
  }

  if (words > 140) {
    const maxWordsPerSegment = [12, 16, 10, 20, 20, 20, 18, 14];
    for (let i = 0; i < next.length; i++) {
      const tokens = next[i].split(/\s+/).filter(Boolean);
      if (tokens.length > maxWordsPerSegment[i]) {
        next[i] = `${tokens.slice(0, maxWordsPerSegment[i]).join(' ').replace(/[,.!?;:]+$/, '')}.`;
      }
    }
  }

  return next;
}

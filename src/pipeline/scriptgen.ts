import OpenAI from 'openai';
import type {ScrapedData} from './scraper';
import type {ScriptResult} from './script-types';
import type {TemplateProfile} from './templates';
import type {DomainPack} from './domain-packs';

const BASE_SYSTEM_PROMPT = `You are a senior launch-video script writer.
Given scraped website data, generate structured script JSON for a 35-45 second intro video.

Output ONLY valid JSON matching this exact schema:
{
  "brandName": "string",
  "brandUrl": "string domain like example.com",
  "brandColor": "string hex color",
  "accentColor": "string hex color",
  "tagline": "string max 8 words",
  "hookLine1": "string 2-4 words",
  "hookLine2": "string 2-4 words",
  "hookKeyword": "string 2-4 words",
  "narrationSegments": [
    "segment 1 brand reveal",
    "segment 2 hook expansion",
    "segment 3 brand introduction",
    "segment 4 feature one",
    "segment 5 feature two",
    "segment 6 feature three",
    "segment 7 integrations",
    "segment 8 closing CTA"
  ],
  "features": [
    {
      "icon": "mail|ai|social|code|calendar|analytics|chat|commerce|finance|health|support|docs|media|generic",
      "appName": "string",
      "caption": "string",
      "demoLines": ["string"]
    }
  ],
  "integrations": ["string"],
  "ctaUrl": "string domain"
}

Rules:
- features must have exactly 3 items, each with a different context.
- narrationSegments must have exactly 8 items and read naturally in order.
- total narration must be 100-140 words.
- segment 3 must introduce the brand by name.
- segments 4-6 must reference the corresponding feature contexts.
- use concrete on-screen details: names, statuses, numbers, dates, priorities, outcomes.
- avoid placeholders, empty claims, and generic buzzwords.
- integrations must contain real tools.
- output JSON only.`;

export interface GenerateScriptOptions {
  templateProfile?: TemplateProfile;
  domainPack?: DomainPack;
  qualityFeedback?: string[];
  maxRetries?: number;
}

export async function generateScript(
  scraped: ScrapedData,
  options: GenerateScriptOptions = {},
): Promise<ScriptResult> {
  const apiKey = process.env.openai_api_key;
  if (!apiKey) throw new Error('Missing openai_api_key in environment');

  const client = new OpenAI({apiKey});
  const maxRetries = options.maxRetries ?? 3;

  let parsed: any = null;
  let lastError = 'Unknown script generation error';

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const systemPrompt = buildSystemPrompt(options.templateProfile, options.domainPack);
    const userPrompt = buildUserPrompt(scraped, options, attempt);

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {role: 'system', content: systemPrompt},
        {role: 'user', content: userPrompt},
      ],
      temperature: 0.65,
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

      candidate.narrationSegments = enforceNarrationWordRange(candidate.narrationSegments, options.domainPack);
      const words = countWords(candidate.narrationSegments.join(' '));
      if (words < 100 || words > 140) {
        lastError = `Narration word count ${words} outside 100-140 after normalization`;
        continue;
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

  const sceneWeights = parsed.narrationSegments.map((seg: string) => {
    const words = countWords(seg);
    return Math.max(words, 2);
  });

  return {
    brandName: parsed.brandName,
    brandUrl: parsed.brandUrl,
    brandColor: parsed.brandColor || '#111111',
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

function buildSystemPrompt(templateProfile?: TemplateProfile, domainPack?: DomainPack): string {
  let prompt = BASE_SYSTEM_PROMPT;
  if (templateProfile) {
    prompt += `\n\nTemplate profile: ${templateProfile.label}
Template objective: ${templateProfile.description}
Additional style instructions: ${templateProfile.systemInstructions}`;
  }
  if (domainPack) {
    prompt += `\n\nDomain pack: ${domainPack.label}
Domain objective: ${domainPack.description}
Pack style hint: ${domainPack.scriptStyleHint}
Allowed icons for features: ${domainPack.allowedIcons.join(', ')}
Forbidden terms for this domain: ${domainPack.forbiddenTerms.join(', ') || 'none'}
Concrete signal fields to prefer: ${domainPack.concreteFields.join(', ')}`;
  }
  return prompt;
}

function buildUserPrompt(
  scraped: ScrapedData,
  options: GenerateScriptOptions,
  attempt: number,
): string {
  const feedbackBlock = (options.qualityFeedback && options.qualityFeedback.length > 0)
    ? `\nPrevious quality issues to fix:\n- ${options.qualityFeedback.join('\n- ')}`
    : '';

  const retryBlock = attempt === 0
    ? ''
    : `\nRetry attempt ${attempt + 1}: tighten structure and realism while keeping JSON valid.`;

  const packBlock = options.domainPack
    ? `\nDomain pack selected: ${options.domainPack.id}
Use this domain vocabulary and avoid terms outside it.
Allowed icons: ${options.domainPack.allowedIcons.join(', ')}
Forbidden terms: ${options.domainPack.forbiddenTerms.join(', ') || 'none'}
Concrete fields to include in demo lines: ${options.domainPack.concreteFields.join(', ') || 'Status, Result'}`
    : '';

  return `Generate a script for this product:\n
URL: ${scraped.url}
Domain: ${scraped.domain}
Title: ${scraped.title}
Description: ${scraped.description}
OG Title: ${scraped.ogTitle}
OG Description: ${scraped.ogDescription}

Headings:
${scraped.headings.join('\n')}

Features/benefits:
${scraped.features.slice(0, 18).join('\n')}

Body excerpt:
${scraped.bodyText.slice(0, 2200)}

Colors found: ${scraped.colors.join(', ')}
${packBlock}
${feedbackBlock}
${retryBlock}`;
}

function validateParsedScript(parsed: any): void {
  const required = [
    'brandName',
    'brandUrl',
    'tagline',
    'hookLine1',
    'hookLine2',
    'hookKeyword',
    'features',
    'integrations',
    'ctaUrl',
    'narrationSegments',
  ];

  for (const field of required) {
    if (!parsed[field]) throw new Error(`Missing required field: ${field}`);
  }

  if (!Array.isArray(parsed.features) || parsed.features.length !== 3) {
    throw new Error(`Expected 3 features, got ${parsed.features?.length}`);
  }

  if (!Array.isArray(parsed.narrationSegments) || parsed.narrationSegments.length !== 8) {
    throw new Error(`Expected 8 narration segments, got ${parsed.narrationSegments?.length}`);
  }
}

function enforceNarrationWordRange(segments: string[], domainPack?: DomainPack): string[] {
  const next = [...segments];
  const boosters = buildBoosters(domainPack);

  const countAll = () => countWords(next.join(' '));

  let i = 0;
  while (countAll() < 100 && i < 16) {
    const target = 3 + (i % 4);
    next[target] = `${next[target]} ${boosters[i % boosters.length]}`.trim();
    i += 1;
  }

  if (countAll() > 140) {
    const maxWordsPerSegment = [12, 16, 10, 22, 22, 22, 18, 14];
    for (let idx = 0; idx < next.length; idx++) {
      const words = next[idx].split(/\s+/).filter(Boolean);
      if (words.length > maxWordsPerSegment[idx]) {
        next[idx] = `${words.slice(0, maxWordsPerSegment[idx]).join(' ').replace(/[,.!?;:]+$/, '')}.`;
      }
    }
  }

  return next;
}

function buildBoosters(domainPack?: DomainPack): string[] {
  if (!domainPack) {
    return [
      'This reduces delay between planning and execution.',
      'Teams keep context while priorities keep moving.',
      'Work stays visible with ownership and status in one place.',
      'You can move from signal to action without tool switching.',
    ];
  }

  const fieldA = domainPack.concreteFields[0] ?? 'signals';
  const fieldB = domainPack.concreteFields[1] ?? 'updates';
  return [
    `This keeps ${fieldA.toLowerCase()} signals visible as conditions change.`,
    `Teams move faster when ${fieldB.toLowerCase()} data stays structured.`,
    'Decisions become easier when context is clear and current.',
    'You can act immediately without losing momentum between tools.',
  ];
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

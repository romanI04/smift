import OpenAI from 'openai';
import type {ScrapedData} from './scraper';
import type {ScriptResult} from './script-types';
import type {TemplateProfile} from './templates';
import type {DomainPack} from './domain-packs';
import {
  buildFeatureEvidencePlan,
  canonicalizeFeatureName,
  canonicalizeIntegrations,
  extractGroundingHints,
  hasGroundingSignal,
  pickGroundedNumber,
  pickGroundedPhrase,
  type FeatureEvidencePlanItem,
  type GroundingHints,
} from './grounding';

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
  groundingHints?: GroundingHints;
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
  const groundingHints = options.groundingHints ?? extractGroundingHints(scraped);
  const featureEvidencePlan = buildFeatureEvidencePlan(groundingHints, 3, options.domainPack?.id ?? 'general');

  let parsed: any = null;
  let lastError = 'Unknown script generation error';

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const systemPrompt = buildSystemPrompt(options.templateProfile, options.domainPack);
    const userPrompt = buildUserPrompt(scraped, options, attempt, featureEvidencePlan);

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
      let candidate = JSON.parse(content);
      validateParsedScript(candidate);

      candidate.narrationSegments = enforceNarrationWordRange(candidate.narrationSegments, options.domainPack);
      const groundingFix = enforceGrounding(candidate, groundingHints, featureEvidencePlan, options.domainPack);
      candidate = groundingFix;
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
    integrations: canonicalizeIntegrations(
      parsed.integrations,
      groundingHints,
      options.domainPack?.fallbackIntegrations ?? [],
      12,
    ),
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
  featureEvidencePlan: FeatureEvidencePlanItem[],
): string {
  const groundingHints = options.groundingHints ?? extractGroundingHints(scraped);
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

  const groundingBlock = `\nGrounding lexicon (use exact or very close terms):
Terms: ${groundingHints.terms.slice(0, 18).join(', ') || 'none'}
Phrases: ${groundingHints.phrases.slice(0, 10).join(' | ') || 'none'}
Feature name candidates: ${groundingHints.featureNameCandidates.slice(0, 10).join(' | ') || 'none'}
Numbers: ${groundingHints.numbers.slice(0, 8).join(', ') || 'none'}
Integrations seen in source: ${groundingHints.integrationCandidates.slice(0, 8).join(', ') || 'none'}
Hard requirement: features and narration must be grounded in this source lexicon; do not invent unrelated product nouns.`;

  const evidencePlanBlock = featureEvidencePlan.length > 0
    ? `\nFeature evidence plan (must follow by slot):
${featureEvidencePlan.map((item) => `Slot ${item.slot}
- Canonical feature name: ${item.featureName}
- Required evidence phrase(s): ${item.requiredPhrases.join(' | ')}
- Preferred numeric signal: ${item.preferredNumber ?? 'n/a'}`).join('\n')}
Hard requirements:
- Keep exactly 3 features in the same slot order.
- Each feature demo must include at least one required evidence phrase from that slot.
- Segments 4, 5, 6 must clearly reference feature slots 1, 2, 3 respectively.`
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
Structured hints: ${(scraped.structuredHints ?? []).join(', ')}
${packBlock}
${groundingBlock}
${evidencePlanBlock}
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

function enforceGrounding(
  candidate: any,
  groundingHints: GroundingHints,
  featureEvidencePlan: FeatureEvidencePlanItem[],
  domainPack?: DomainPack,
): any {
  const next = {
    ...candidate,
    features: Array.isArray(candidate.features) ? candidate.features.map((feature: any) => ({...feature, demoLines: [...(feature.demoLines ?? [])]})) : [],
    integrations: Array.isArray(candidate.integrations) ? [...candidate.integrations] : [],
    narrationSegments: Array.isArray(candidate.narrationSegments) ? [...candidate.narrationSegments] : [],
  };

  const usedNames = new Set<string>();

  for (let i = 0; i < next.features.length; i++) {
    const feature = next.features[i];
    const evidence = featureEvidencePlan[i];
    const phrase = pickGroundedPhrase(groundingHints, i);
    const num = pickGroundedNumber(groundingHints, i);

    feature.appName = canonicalizeFeatureName(feature?.appName ?? phrase ?? `Feature ${i + 1}`, groundingHints, i);
    if (evidence && tokenOverlap(feature.appName, evidence.featureName) < 0.34) {
      feature.appName = evidence.featureName;
    }
    const dedupeKey = feature.appName.toLowerCase();
    if (usedNames.has(dedupeKey)) {
      const fallback = canonicalizeFeatureName(phrase ?? `Feature ${i + 1}`, groundingHints, i + 1);
      feature.appName = `${fallback} ${i + 1}`.trim();
    }
    usedNames.add(feature.appName.toLowerCase());

    if (!Array.isArray(feature.demoLines)) {
      feature.demoLines = [];
    }
    if (feature.demoLines.length < 2) {
      feature.demoLines.push(feature.appName);
    }

    const joined = (feature?.demoLines ?? []).join(' ');
    if (!hasGroundingSignal(joined, groundingHints)) {
      const groundedLine = phrase ?? feature?.appName ?? `Signal ${i + 1}`;
      if (num) {
        feature.demoLines.push(`${groundedLine}: ${num}`);
      } else {
        feature.demoLines.push(groundedLine);
      }
    }

    if (evidence && !containsAnyPhrase(feature.demoLines.join(' '), evidence.requiredPhrases)) {
      feature.demoLines.push(evidence.requiredPhrases[0]);
    }
    if (evidence?.preferredNumber && !/\d/.test(feature.demoLines.join(' '))) {
      feature.demoLines.push(`${feature.appName}: ${evidence.preferredNumber}`);
    }
  }

  next.integrations = canonicalizeIntegrations(next.integrations, groundingHints, [], 12);

  for (let i = 3; i <= 5; i++) {
    if (!next.narrationSegments[i]) continue;
    const featureIdx = i - 3;
    const feature = next.features[featureIdx];
    const evidence = featureEvidencePlan[featureIdx];
    if (!hasGroundingSignal(next.narrationSegments[i], groundingHints) || (evidence && !containsAnyPhrase(next.narrationSegments[i], evidence.requiredPhrases))) {
      const inject = evidence?.requiredPhrases[0] ?? pickGroundedPhrase(groundingHints, i);
      if (inject) {
        next.narrationSegments[i] = `${next.narrationSegments[i]} ${inject}.`.trim();
      }
    }
    if (feature && tokenOverlap(next.narrationSegments[i], feature.appName) < 0.2) {
      next.narrationSegments[i] = `${next.narrationSegments[i]} Feature: ${feature.appName}.`.trim();
    }
  }

  enforceHookQuality(next, groundingHints, featureEvidencePlan, domainPack);

  return next;
}

function containsAnyPhrase(text: string, phrases: string[]): boolean {
  const corpus = text.toLowerCase();
  for (const phrase of phrases) {
    if (!phrase.trim()) continue;
    if (corpus.includes(phrase.toLowerCase())) return true;
  }
  return false;
}

function tokenOverlap(a: string, b: string): number {
  const aTokens = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const bTokens = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let common = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) common += 1;
  }
  return common / Math.max(aTokens.size, bTokens.size);
}

function enforceHookQuality(
  candidate: any,
  groundingHints: GroundingHints,
  featureEvidencePlan: FeatureEvidencePlanItem[],
  domainPack?: DomainPack,
) {
  const sourceA = featureEvidencePlan[0]?.featureName ?? pickGroundedPhrase(groundingHints, 0) ?? 'Product Execution';
  const sourceB = featureEvidencePlan[1]?.featureName ?? pickGroundedPhrase(groundingHints, 1) ?? sourceA;
  const sourceC = featureEvidencePlan[2]?.featureName ?? pickGroundedPhrase(groundingHints, 2) ?? sourceB;

  const fallbackKeywordByPack: Record<string, string> = {
    general: 'move with clarity',
    'b2b-saas': 'operate with clarity',
    devtools: 'ship with confidence',
    'ecommerce-retail': 'convert more buyers',
    fintech: 'control risk faster',
    gaming: 'climb patch faster',
    'media-creator': 'grow audience faster',
    education: 'improve learning outcomes',
    'real-estate': 'close deals faster',
    'travel-hospitality': 'delight guests consistently',
    'logistics-ops': 'deliver on time',
    'social-community': 'grow healthy communities',
  };

  if (!isStrongHookLine(candidate.hookLine1) || !hasGroundingSignal(candidate.hookLine1, groundingHints)) {
    candidate.hookLine1 = toHookWords(sourceA, 3);
  }
  if (!isStrongHookLine(candidate.hookLine2) || !hasGroundingSignal(candidate.hookLine2, groundingHints)) {
    candidate.hookLine2 = toHookWords(sourceB, 3);
  }

  const keywordFallback = fallbackKeywordByPack[domainPack?.id ?? 'general'] ?? 'move with clarity';
  if (!isStrongHookLine(candidate.hookKeyword)) {
    candidate.hookKeyword = keywordFallback;
  }
  if (!hasGroundingSignal(candidate.hookKeyword, groundingHints)) {
    const blended = toHookWords(`${sourceC} ${keywordFallback}`, 4);
    candidate.hookKeyword = blended || keywordFallback;
  }
}

function isStrongHookLine(value: string): boolean {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  const lower = value.toLowerCase();
  if (/right now|game changer|next level|all in one|revolutionary/.test(lower)) return false;
  return true;
}

function toHookWords(value: string, maxWords: number): string {
  const tokens = value
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, maxWords);
  if (tokens.length === 0) return '';
  if (tokens.length === 1) return `${tokens[0]} signal`;
  return tokens.join(' ');
}

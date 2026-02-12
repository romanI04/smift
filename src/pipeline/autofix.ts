import type {ScriptResult} from './script-types';
import type {ScrapedData} from './scraper';
import type {DomainPack} from './domain-packs';
import {
  canonicalizeFeatureName,
  canonicalizeIntegrations,
  extractGroundingHints,
  hasGroundingSignal,
  pickGroundedNumber,
  pickGroundedPhrase,
  type GroundingHints,
} from './grounding';

export interface AutoFixResult {
  script: ScriptResult;
  actions: string[];
}

export function autoFixScriptQuality(
  script: ScriptResult,
  scraped: ScrapedData,
  domainPack: DomainPack,
  groundingHintsArg?: GroundingHints,
): AutoFixResult {
  const groundingHints = groundingHintsArg ?? extractGroundingHints(scraped);
  const next: ScriptResult = {
    ...script,
    features: script.features.map((feature) => ({...feature, demoLines: [...feature.demoLines]})),
    integrations: [...script.integrations],
    narrationSegments: [...script.narrationSegments],
    sceneWeights: Array.isArray(script.sceneWeights) ? [...script.sceneWeights] : undefined,
    domainPackId: domainPack.id,
  };

  const actions: string[] = [];

  const domain = normalizeDomain(scraped.domain);
  if (!normalizeDomain(next.ctaUrl).includes(domain)) {
    next.ctaUrl = domain;
    actions.push('Aligned ctaUrl with scraped domain.');
  }

  const hookLines: Array<keyof Pick<ScriptResult, 'hookLine1' | 'hookLine2' | 'hookKeyword'>> = [
    'hookLine1',
    'hookLine2',
    'hookKeyword',
  ];
  for (let i = 0; i < hookLines.length; i++) {
    const key = hookLines[i];
    const fixed = normalizeHookLine(next[key], i, groundingHints, domainPack);
    if (fixed !== next[key]) {
      next[key] = fixed;
      actions.push(`Normalized ${key} to 2-4 words.`);
    }
  }

  if (!next.narrationSegments[2]?.toLowerCase().includes(firstWord(next.brandName).toLowerCase())) {
    next.narrationSegments[2] = `Meet ${next.brandName}. ${stripTrailingPeriod(next.narrationSegments[2] || 'Built for execution')}.`;
    actions.push('Forced brand mention in segment 3 narration.');
  }

  const forbiddenRegexes = domainPack.forbiddenTerms.map((term) => new RegExp(`\\b${escapeRegex(term)}\\b`, 'ig'));

  next.features = next.features.map((feature, idx) => {
    const updated = {...feature, demoLines: [...feature.demoLines]};
    const canonicalName = canonicalizeFeatureName(updated.appName || `Feature ${idx + 1}`, groundingHints, idx);
    if (canonicalName !== updated.appName) {
      updated.appName = canonicalName;
      actions.push(`Normalized feature name for feature ${idx + 1}.`);
    }

    if (!updated.caption || countWords(updated.caption) > 6) {
      updated.caption = toMaxWords(updated.caption || 'Clear execution signal', 6);
      actions.push(`Shortened caption for feature ${idx + 1}.`);
    }

    if (updated.demoLines.length === 0) {
      updated.demoLines.push(`${domainPack.concreteFields[0] ?? 'Status'}: ${sampleValue(domainPack.concreteFields[0] ?? 'Status', idx)}`);
      actions.push(`Added missing demo line for feature ${idx + 1}.`);
    }

    const demoText = updated.demoLines.join(' ');
    if (countWords(demoText) < 8) {
      const field = domainPack.concreteFields[idx % domainPack.concreteFields.length] ?? 'Status';
      updated.demoLines.push(`${field}: ${sampleValue(field, idx)}`);
      actions.push(`Expanded thin demo text for feature ${idx + 1}.`);
    }

    if (!hasConcreteSignal(updated.demoLines.join(' '), domainPack.concreteFields)) {
      const f1 = domainPack.concreteFields[0] ?? 'Status';
      const f2 = domainPack.concreteFields[1] ?? 'Update';
      updated.demoLines.push(`${f1}: ${sampleValue(f1, idx)}`);
      updated.demoLines.push(`${f2}: ${sampleValue(f2, idx + 1)}`);
      actions.push(`Injected pack-specific concrete fields for feature ${idx + 1}.`);
    }

    if (!hasGroundingSignal(updated.demoLines.join(' '), groundingHints)) {
      const groundedPhrase = pickGroundedPhrase(groundingHints, idx);
      const groundedNumber = pickGroundedNumber(groundingHints, idx);
      if (groundedPhrase) {
        updated.demoLines.push(groundedNumber ? `${groundedPhrase}: ${groundedNumber}` : groundedPhrase);
        actions.push(`Injected grounded source phrase for feature ${idx + 1}.`);
      }
    }

    updated.demoLines = updated.demoLines.map((line) => {
      let sanitized = line;
      for (const regex of forbiddenRegexes) {
        sanitized = sanitized.replace(regex, 'context signal');
      }
      return sanitized;
    });

    return updated;
  });

  next.features = next.features.map((feature) => {
    if (domainPack.allowedIcons.includes(feature.icon as any)) return feature;
    const replacement = domainPack.allowedIcons[0] ?? 'generic';
    actions.push(`Replaced disallowed icon ${feature.icon} with ${replacement}.`);
    return {...feature, icon: replacement};
  });

  if (next.integrations.length < 2) {
    const needed = 2 - next.integrations.length;
    next.integrations.push(...domainPack.fallbackIntegrations.slice(0, needed));
    actions.push('Filled missing integrations using domain pack defaults.');
  }

  const canonicalIntegrations = canonicalizeIntegrations(next.integrations, groundingHints, domainPack.fallbackIntegrations, 12);
  if (canonicalIntegrations.join('|') !== next.integrations.join('|')) {
    next.integrations = canonicalIntegrations;
    actions.push('Canonicalized integrations using source and known tools.');
  }

  if (next.integrations.length > 12) {
    next.integrations = next.integrations.slice(0, 12);
    actions.push('Trimmed integrations to 12 items.');
  }

  next.narrationSegments = normalizeNarrationWordCount(next.narrationSegments, domainPack.concreteFields);
  for (let i = 3; i <= 6; i++) {
    if (!next.narrationSegments[i]) continue;
    if (!hasGroundingSignal(next.narrationSegments[i], groundingHints)) {
      const groundedPhrase = pickGroundedPhrase(groundingHints, i);
      if (groundedPhrase) {
        next.narrationSegments[i] = `${next.narrationSegments[i]} ${groundedPhrase}.`.trim();
        actions.push(`Grounded narration segment ${i + 1}.`);
      }
    }
  }
  next.narrationSegments = normalizeNarrationWordCount(next.narrationSegments, domainPack.concreteFields);
  next.narrationSegments = next.narrationSegments.map((segment) => {
    let sanitized = segment;
    for (const regex of forbiddenRegexes) {
      sanitized = sanitized.replace(regex, 'domain context');
    }
    return sanitized;
  });

  next.sceneWeights = next.narrationSegments.map((segment) => Math.max(2, countWords(segment)));

  return {script: next, actions};
}

function normalizeHookLine(
  line: string,
  index: number,
  groundingHints: GroundingHints,
  domainPack: DomainPack,
): string {
  const words = line
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  const current = words.join(' ');
  if (
    words.length >= 2
    && words.length <= 4
    && (hasGroundingSignal(current, groundingHints) || !/right now|game changer|next level|all in one|revolutionary/i.test(current))
  ) {
    return current;
  }

  const source = pickGroundedPhrase(groundingHints, index) ?? domainPack.concreteFields[index] ?? domainPack.label;
  const cleanSource = source
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(' ');
  if (cleanSource.split(/\s+/).filter(Boolean).length >= 2) return cleanSource;
  if (cleanSource) return `${cleanSource} signal`;

  return index === 2 ? 'move with clarity' : 'clear product signal';
}

function normalizeNarrationWordCount(segments: string[], concreteFields: string[]): string[] {
  const next = [...segments];
  const boosters = [
    `This keeps ${concreteFields[0] ?? 'signal'} visible while priorities change.`,
    `Teams move faster because ${concreteFields[1] ?? 'updates'} stay structured.`,
  ];

  let i = 0;
  while (countWords(next.join(' ')) < 100 && i < 12) {
    const target = 3 + (i % 4);
    next[target] = `${next[target]} ${boosters[i % boosters.length]}`.trim();
    i += 1;
  }

  if (countWords(next.join(' ')) > 140) {
    const caps = [12, 16, 12, 20, 20, 20, 18, 14];
    for (let idx = 0; idx < next.length; idx++) {
      next[idx] = toMaxWords(next[idx], caps[idx]);
    }
  }

  return next;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeDomain(urlOrDomain: string): string {
  const candidate = urlOrDomain.startsWith('http') ? urlOrDomain : `https://${urlOrDomain}`;
  try {
    return new URL(candidate).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return urlOrDomain.replace(/^www\./, '').toLowerCase();
  }
}

function toMaxWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(' ').replace(/[,.!?;:]+$/, '')}.`;
}

function firstWord(text: string): string {
  return text.split(/\s+/).filter(Boolean)[0] || text;
}

function stripTrailingPeriod(text: string): string {
  return text.replace(/\.+$/, '');
}

function hasConcreteSignal(value: string, fields: string[]): boolean {
  const domainRegex = fields.length > 0
    ? new RegExp(fields.map((f) => escapeRegex(f.toLowerCase())).join('|'), 'i')
    : null;
  const generic = /\d|status|due|owner|assigned|priority|revenue|conversion|ticket|order|eta/i.test(value);
  return generic || Boolean(domainRegex && domainRegex.test(value.toLowerCase()));
}

function sampleValue(field: string, seed: number): string {
  const key = field.toLowerCase();
  const n = (seed % 5) + 1;
  if (key.includes('patch')) return `14.${n}`;
  if (key.includes('win')) return `${52 + n}.${n}%`;
  if (key.includes('rank')) return `Top ${n * 100}`;
  if (key.includes('conversion')) return `${2 + n * 0.4}%`;
  if (key.includes('build')) return `Variant ${String.fromCharCode(64 + n)}`;
  if (key.includes('engagement')) return `${5 + n * 0.9}%`;
  if (key.includes('status')) return ['Ready', 'In Progress', 'Blocked'][seed % 3];
  return `${field} ${n}`;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

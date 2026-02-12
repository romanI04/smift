import type {ScriptResult} from './script-types';
import type {ScrapedData} from './scraper';
import type {DomainPack} from './domain-packs';
import {
  canonicalizeFeatureName,
  canonicalizeIntegrations,
  hasGroundingSignal,
  pickGroundedNumber,
  pickGroundedPhrase,
  type GroundingHints,
} from './grounding';

export interface RelevanceGuardResult {
  script: ScriptResult;
  actions: string[];
  warnings: string[];
}

export function applyRenderRelevanceGuard(args: {
  script: ScriptResult;
  scraped: ScrapedData;
  domainPack: DomainPack;
  groundingHints: GroundingHints;
}): RelevanceGuardResult {
  const {script, scraped, domainPack, groundingHints} = args;
  const next: ScriptResult = {
    ...script,
    features: script.features.map((feature) => ({...feature, demoLines: [...feature.demoLines]})),
    integrations: [...script.integrations],
    narrationSegments: [...script.narrationSegments],
    sceneWeights: script.sceneWeights ? [...script.sceneWeights] : undefined,
    domainPackId: domainPack.id,
  };

  const actions: string[] = [];
  const warnings: string[] = [];
  const forbiddenRegexes = domainPack.forbiddenTerms
    .map((term) => term.trim())
    .filter(Boolean)
    .map((term) => new RegExp(`\\b${escapeRegex(term)}\\b`, 'ig'));

  const usedAppNames = new Set<string>();

  next.features = next.features.map((feature, idx) => {
    const updated = {...feature, demoLines: [...feature.demoLines]};
    const canonicalName = canonicalizeFeatureName(updated.appName || `Feature ${idx + 1}`, groundingHints, idx);
    if (canonicalName !== updated.appName) {
      updated.appName = canonicalName;
      actions.push(`Guard normalized feature name ${idx + 1}.`);
    }

    if (!domainPack.allowedIcons.includes(updated.icon as any)) {
      const replacement = domainPack.allowedIcons[idx % domainPack.allowedIcons.length] ?? 'generic';
      updated.icon = replacement;
      actions.push(`Guard replaced disallowed icon in feature ${idx + 1} with "${replacement}".`);
    }

    if (!updated.caption || countWords(updated.caption) > 6) {
      updated.caption = toMaxWords(updated.caption || updated.appName, 6);
      actions.push(`Guard normalized caption length in feature ${idx + 1}.`);
    }

    updated.appName = sanitizeForbidden(updated.appName, forbiddenRegexes);
    updated.caption = sanitizeForbidden(updated.caption, forbiddenRegexes);
    updated.demoLines = updated.demoLines.map((line) => sanitizeForbidden(line, forbiddenRegexes));

    if (updated.demoLines.length < 2) {
      const phrase = pickGroundedPhrase(groundingHints, idx) ?? updated.appName;
      updated.demoLines.push(phrase);
      actions.push(`Guard expanded sparse demo lines in feature ${idx + 1}.`);
    }

    if (!hasGroundingSignal(updated.demoLines.join(' '), groundingHints)) {
      const phrase = pickGroundedPhrase(groundingHints, idx);
      const num = pickGroundedNumber(groundingHints, idx);
      if (phrase) {
        updated.demoLines.push(num ? `${phrase}: ${num}` : phrase);
        actions.push(`Guard injected grounded demo line for feature ${idx + 1}.`);
      } else {
        warnings.push(`Guard could not inject grounded demo line for feature ${idx + 1}.`);
      }
    }

    const dedupeKey = updated.appName.toLowerCase();
    if (usedAppNames.has(dedupeKey)) {
      const suffix = pickGroundedPhrase(groundingHints, idx + 1)?.split(/\s+/)[0] ?? String(idx + 1);
      updated.appName = `${updated.appName} ${suffix}`.trim();
      actions.push(`Guard de-duplicated feature name ${idx + 1}.`);
    }
    usedAppNames.add(updated.appName.toLowerCase());

    return updated;
  });

  const canonicalIntegrations = canonicalizeIntegrations(
    next.integrations,
    groundingHints,
    domainPack.fallbackIntegrations,
    12,
  );
  if (canonicalIntegrations.join('|') !== next.integrations.join('|')) {
    next.integrations = canonicalIntegrations;
    actions.push('Guard canonicalized integration list.');
  }

  if (next.integrations.length < 2) {
    for (const candidate of domainPack.fallbackIntegrations) {
      if (!next.integrations.includes(candidate)) {
        next.integrations.push(candidate);
        actions.push(`Guard added fallback integration "${candidate}".`);
      }
      if (next.integrations.length >= 2) break;
    }
  }

  if (next.integrations.length > 12) {
    next.integrations = next.integrations.slice(0, 12);
    actions.push('Guard trimmed integrations to 12 items.');
  }

  const ctaDomain = normalizeDomain(next.ctaUrl);
  const sourceDomain = normalizeDomain(scraped.domain);
  if (!ctaDomain.includes(sourceDomain) && !sourceDomain.includes(ctaDomain)) {
    next.ctaUrl = sourceDomain;
    actions.push('Guard aligned CTA domain to source domain.');
  }

  return {script: next, actions, warnings};
}

function sanitizeForbidden(value: string, forbiddenRegexes: RegExp[]): string {
  let next = value;
  for (const regex of forbiddenRegexes) {
    next = next.replace(regex, 'context signal');
  }
  return next;
}

function toMaxWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(' ');
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeDomain(urlOrDomain: string): string {
  const candidate = urlOrDomain.startsWith('http') ? urlOrDomain : `https://${urlOrDomain}`;
  try {
    return new URL(candidate).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return urlOrDomain.replace(/^www\./, '').toLowerCase();
  }
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

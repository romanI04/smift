import type {ScriptResult} from './script-types';
import type {ScrapedData} from './scraper';

export interface AutoFixResult {
  script: ScriptResult;
  actions: string[];
}

const DEFAULT_INTEGRATIONS = ['Slack', 'Notion', 'Google Drive', 'Zapier'];

export function autoFixScriptQuality(script: ScriptResult, scraped: ScrapedData): AutoFixResult {
  const next: ScriptResult = {
    ...script,
    features: script.features.map((feature) => ({...feature, demoLines: [...feature.demoLines]})),
    integrations: [...script.integrations],
    narrationSegments: [...script.narrationSegments],
    sceneWeights: Array.isArray(script.sceneWeights) ? [...script.sceneWeights] : undefined,
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
  for (const key of hookLines) {
    const fixed = normalizeHookLine(next[key]);
    if (fixed !== next[key]) {
      next[key] = fixed;
      actions.push(`Normalized ${key} to 2-4 words.`);
    }
  }

  if (!next.narrationSegments[2]?.toLowerCase().includes(firstWord(next.brandName).toLowerCase())) {
    next.narrationSegments[2] = `Meet ${next.brandName}. ${stripTrailingPeriod(next.narrationSegments[2] || 'Built for execution')}.`;
    actions.push('Forced brand mention in segment 3 narration.');
  }

  next.features = next.features.map((feature, idx) => {
    const updated = {...feature, demoLines: [...feature.demoLines]};
    if (!updated.caption || countWords(updated.caption) > 6) {
      updated.caption = toMaxWords(updated.caption || 'Faster execution', 6);
      actions.push(`Shortened caption for feature ${idx + 1}.`);
    }

    if (updated.demoLines.length === 0) {
      updated.demoLines.push('Task status overview');
      actions.push(`Added missing demo line for feature ${idx + 1}.`);
    }

    const demoText = updated.demoLines.join(' ');
    if (countWords(demoText) < 6) {
      updated.demoLines.push(`Owner: ${pickOwner(idx)}`);
      actions.push(`Expanded thin demo text for feature ${idx + 1}.`);
    }

    if (!hasConcreteSignal(updated.demoLines.join(' '))) {
      updated.demoLines.push(`Status: ${pickStatus(idx)}`);
      updated.demoLines.push(`Priority: ${pickPriority(idx)}`);
      actions.push(`Injected concrete status fields for feature ${idx + 1}.`);
    }

    return updated;
  });

  if (next.integrations.length < 2) {
    const needed = 2 - next.integrations.length;
    next.integrations.push(...DEFAULT_INTEGRATIONS.slice(0, needed));
    actions.push('Filled missing integrations.');
  }

  if (next.integrations.length > 12) {
    next.integrations = next.integrations.slice(0, 12);
    actions.push('Trimmed integrations to 12 items.');
  }

  next.narrationSegments = normalizeNarrationWordCount(next.narrationSegments);
  next.sceneWeights = next.narrationSegments.map((segment) => Math.max(2, countWords(segment)));

  return {script: next, actions};
}

function normalizeHookLine(line: string): string {
  const words = line
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  if (words.length >= 2 && words.length <= 4) return words.join(' ');
  if (words.length > 4) return words.slice(0, 4).join(' ');

  const fillers = ['right', 'now'];
  const expanded = [...words, ...fillers].slice(0, 2);
  return expanded.join(' ');
}

function normalizeNarrationWordCount(segments: string[]): string[] {
  const next = [...segments];
  const boosters = [
    'This keeps execution moving with less coordination overhead.',
    'Teams can act faster because ownership and status stay explicit.',
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

function hasConcreteSignal(value: string): boolean {
  return /\d/.test(value) || /(status|due|owner|assigned|priority|revenue|conversion|ticket|order|eta)/i.test(value);
}

function pickOwner(index: number): string {
  return ['Maya', 'Jordan', 'Alex'][index % 3];
}

function pickStatus(index: number): string {
  return ['In Progress', 'Blocked', 'Ready for Review'][index % 3];
}

function pickPriority(index: number): string {
  return ['High', 'Medium', 'Critical'][index % 3];
}

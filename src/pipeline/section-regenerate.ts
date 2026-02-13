import type {Feature} from '../types';
import type {DomainPack} from './domain-packs';
import type {ScrapedData} from './scraper';
import type {ScriptResult} from './script-types';
import {
  buildFeatureEvidencePlan,
  pickGroundedPhrase,
  pickGroundedNumber,
  type GroundingHints,
} from './grounding';

export type RegenerateSection = 'hook' | 'feature1' | 'feature2' | 'feature3' | 'cta';

export interface RegenerateSectionResult {
  script: ScriptResult;
  actions: string[];
}

export function regenerateScriptSection(args: {
  script: ScriptResult;
  section: RegenerateSection;
  scraped: ScrapedData;
  domainPack: DomainPack;
  groundingHints: GroundingHints;
}): RegenerateSectionResult {
  const {script, section, scraped, domainPack, groundingHints} = args;
  const next: ScriptResult = {
    ...script,
    features: script.features.map((feature) => ({...feature, demoLines: [...feature.demoLines]})),
    integrations: [...script.integrations],
    narrationSegments: [...script.narrationSegments],
    domainPackId: domainPack.id,
    sceneWeights: Array.isArray(script.sceneWeights) ? [...script.sceneWeights] : undefined,
  };
  const actions: string[] = [];

  const evidencePlan = buildFeatureEvidencePlan(groundingHints, 3, domainPack.id);

  if (section === 'hook') {
    const source1 = evidencePlan[0]?.featureName ?? pickGroundedPhrase(groundingHints, 0) ?? domainPack.label;
    const source2 = evidencePlan[1]?.featureName ?? pickGroundedPhrase(groundingHints, 1) ?? source1;
    const source3 = evidencePlan[2]?.featureName ?? pickGroundedPhrase(groundingHints, 2) ?? source2;

    next.hookLine1 = toHookWords(source1, 3) || 'product signal';
    next.hookLine2 = toHookWords(source2, 3) || 'clear updates';
    next.hookKeyword = toHookWords(source3, 4) || 'move with clarity';

    next.narrationSegments[0] = `Start with ${next.hookLine1}.`;
    next.narrationSegments[1] = `${next.hookLine2} keeps teams aligned while priorities change.`;
    next.narrationSegments[2] = `Meet ${next.brandName}, where ${next.hookKeyword}.`;
    actions.push('Regenerated hook lines and opening narration segments.');
  }

  if (section === 'feature1' || section === 'feature2' || section === 'feature3') {
    const idx = section === 'feature1' ? 0 : section === 'feature2' ? 1 : 2;
    const evidence = evidencePlan[idx];
    const previous = next.features[idx];
    const rebuilt = regenerateFeature({
      index: idx,
      previous,
      domainPack,
      groundingHints,
      evidence,
    });
    next.features[idx] = rebuilt;
    next.narrationSegments[3 + idx] = `${rebuilt.appName} keeps ${domainPack.concreteFields[0]?.toLowerCase() ?? 'key signals'} visible with ${rebuilt.demoLines[0].toLowerCase()}.`;
    actions.push(`Regenerated ${section} block and narration segment ${4 + idx}.`);
  }

  if (section === 'cta') {
    next.ctaUrl = scraped.domain;
    next.narrationSegments[7] = `See ${next.brandName} in action at ${next.ctaUrl}.`;
    actions.push('Regenerated CTA URL and closing narration segment.');
  }

  next.sceneWeights = next.narrationSegments.map((segment) => Math.max(2, countWords(segment)));
  return {script: next, actions};
}

function regenerateFeature(args: {
  index: number;
  previous: Feature | undefined;
  domainPack: DomainPack;
  groundingHints: GroundingHints;
  evidence: {featureName: string; requiredPhrases: string[]; preferredNumber?: string} | undefined;
}): Feature {
  const {index, previous, domainPack, groundingHints, evidence} = args;
  const icon = previous?.icon && domainPack.allowedIcons.includes(previous.icon as any)
    ? previous.icon
    : domainPack.allowedIcons[index % domainPack.allowedIcons.length] ?? 'generic';
  const appName = evidence?.featureName
    ?? pickGroundedPhrase(groundingHints, index)
    ?? `Feature ${index + 1}`;
  const caption = toCaption(appName);
  const phrase = evidence?.requiredPhrases[0] ?? pickGroundedPhrase(groundingHints, index) ?? appName;
  const num = evidence?.preferredNumber ?? pickGroundedNumber(groundingHints, index);
  const fieldA = domainPack.concreteFields[0] ?? 'Status';
  const fieldB = domainPack.concreteFields[1] ?? 'Update';
  const fieldC = domainPack.concreteFields[2] ?? 'Result';

  return {
    icon,
    appName,
    caption,
    demoLines: [
      phrase,
      `${fieldA}: ${num ?? sampleValue(fieldA, index)}`,
      `${fieldB}: ${sampleValue(fieldB, index + 1)}`,
      `${fieldC}: ${sampleValue(fieldC, index + 2)}`,
    ],
  };
}

function toCaption(value: string): string {
  const words = value
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  if (words.length < 2) return 'Execution signal';
  return words.join(' ');
}

function toHookWords(value: string, maxWords: number): string {
  const words = value
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords);
  if (words.length === 0) return '';
  if (words.length === 1) return `${words[0]} signal`;
  return words.join(' ');
}

function countWords(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function sampleValue(field: string, seed: number): string {
  const key = field.toLowerCase();
  const n = (seed % 5) + 1;
  if (key.includes('status')) return ['Ready', 'In Progress', 'Blocked'][seed % 3];
  if (key.includes('priority')) return ['P0', 'P1', 'P2'][seed % 3];
  if (key.includes('sla')) return `${2 + n}h`;
  if (key.includes('conversion')) return `${2 + n * 0.4}%`;
  if (key.includes('order')) return `#ORD-${4200 + n}`;
  if (key.includes('risk')) return `${60 + n * 5}/100`;
  if (key.includes('eta')) return `${10 + n} min`;
  if (key.includes('rank')) return `Top ${n * 100}`;
  return `${field} ${n}`;
}

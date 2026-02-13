import type {Feature, VideoProps} from '../types';
import type {ScriptResult} from './script-types';

function toStringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toStringValue(item))
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeFeature(value: unknown): Feature {
  const raw = (value && typeof value === 'object') ? (value as Record<string, unknown>) : {};
  const demoLines = toStringArray(raw.demoLines);
  return {
    icon: toStringValue(raw.icon, 'generic') || 'generic',
    appName: toStringValue(raw.appName, 'Feature') || 'Feature',
    caption: toStringValue(raw.caption, 'Product update') || 'Product update',
    demoLines: demoLines.length > 0 ? demoLines : ['Live update'],
  };
}

function inferNarrationSegments(raw: Record<string, unknown>): string[] {
  const fromSegments = toStringArray(raw.narrationSegments);
  if (fromSegments.length > 0) return fromSegments;

  const narration = toStringValue(raw.narration);
  if (!narration) return [];

  const segments = narration
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return segments.length > 0 ? segments : [narration];
}

function normalizeSceneWeights(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.max(1, Math.round(item)));
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeSegmentDurations(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.round(item));
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeScriptPayload(input: unknown): ScriptResult {
  if (!input || typeof input !== 'object') {
    throw new Error('script payload must be a JSON object');
  }
  const raw = input as Record<string, unknown>;
  const features = Array.isArray(raw.features) ? raw.features.map(normalizeFeature).slice(0, 3) : [];
  if (features.length < 3) {
    while (features.length < 3) {
      features.push({
        icon: 'generic',
        appName: `Feature ${features.length + 1}`,
        caption: 'Product workflow',
        demoLines: ['Live update'],
      });
    }
  }

  const script: ScriptResult = {
    brandName: toStringValue(raw.brandName, 'Brand') || 'Brand',
    brandUrl: toStringValue(raw.brandUrl, ''),
    brandColor: toStringValue(raw.brandColor, '#111111') || '#111111',
    accentColor: toStringValue(raw.accentColor, '#2563EB') || '#2563EB',
    tagline: toStringValue(raw.tagline, ''),
    hookLine1: toStringValue(raw.hookLine1, 'Built for teams'),
    hookLine2: toStringValue(raw.hookLine2, 'shipping products'),
    hookKeyword: toStringValue(raw.hookKeyword, 'faster'),
    features,
    integrations: toStringArray(raw.integrations).slice(0, 12),
    ctaUrl: toStringValue(raw.ctaUrl, ''),
    narrationSegments: inferNarrationSegments(raw),
  };

  const domainPackId = toStringValue(raw.domainPackId, '');
  if (domainPackId) script.domainPackId = domainPackId;

  const sceneWeights = normalizeSceneWeights(raw.sceneWeights);
  if (sceneWeights) script.sceneWeights = sceneWeights;

  const segmentDurationsMs = normalizeSegmentDurations(raw.segmentDurationsMs);
  if (segmentDurationsMs) script.segmentDurationsMs = segmentDurationsMs;

  const audioSrc = toStringValue(raw.audioSrc, '');
  if (audioSrc) script.audioSrc = audioSrc;
  const audioDurationMs = Number(raw.audioDurationMs);
  if (Number.isFinite(audioDurationMs) && audioDurationMs > 0) {
    script.audioDurationMs = Math.round(audioDurationMs);
  }

  return script;
}

export function toPersistedScript(script: ScriptResult): VideoProps & {narration: string; narrationSegments: string[]} {
  return {
    ...script,
    narrationSegments: [...script.narrationSegments],
    narration: script.narrationSegments.join(' '),
  };
}

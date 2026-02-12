export interface Feature {
  icon: string;
  appName: string;
  caption: string;
  demoLines: string[];
}

export interface VideoProps {
  brandName: string;
  brandUrl: string;
  brandColor: string;
  accentColor: string;
  tagline: string;
  hookLine1: string;
  hookLine2: string;
  hookKeyword: string;
  features: Feature[];
  integrations: string[];
  ctaUrl: string;
  audioSrc?: string;       // filename in public/ dir (e.g. 'voice.mp3')
  audioDurationMs?: number; // voice duration in ms, used to scale timeline
  // Per-scene timing weights derived from narration word counts.
  // Order: [brandReveal, hookText, wordmark, feature1, feature2, feature3, integrations, closing]
  // If absent, falls back to equal proportions.
  sceneWeights?: number[];
}

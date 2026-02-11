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
}

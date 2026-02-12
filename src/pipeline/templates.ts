import type {ScrapedData} from './scraper';

export type TemplateId = 'yc-saas' | 'product-demo' | 'founder-story';

export interface TemplateProfile {
  id: TemplateId;
  label: string;
  description: string;
  systemInstructions: string;
  sceneWeightHint: number[];
}

export interface TemplateSelection {
  profile: TemplateProfile;
  reason: string;
}

const TEMPLATE_PROFILES: Record<TemplateId, TemplateProfile> = {
  'yc-saas': {
    id: 'yc-saas',
    label: 'YC SaaS Intro',
    description: 'High-clarity B2B/productivity launch style with concrete workflow value.',
    systemInstructions:
      'Style target: YC launch intro for SaaS. Keep language crisp, specific, and execution-focused. ' +
      'Prefer integrations and workflow language over emotional storytelling.',
    sceneWeightHint: [5, 6, 3, 7, 7, 7, 8, 6],
  },
  'product-demo': {
    id: 'product-demo',
    label: 'Product Demo',
    description: 'Commerce and product-centric demo showing customer journey and conversion moments.',
    systemInstructions:
      'Style target: product demo. Focus on shopper/customer journey, conversion, checkout confidence, and retention. ' +
      'Use commerce-oriented examples and measurable outcomes.',
    sceneWeightHint: [4, 5, 3, 8, 8, 7, 7, 7],
  },
  'founder-story': {
    id: 'founder-story',
    label: 'Founder Story',
    description: 'Narrative framing around mission and differentiation while staying product-concrete.',
    systemInstructions:
      'Style target: founder story intro. Keep product specifics concrete, but allow slightly warmer narrative framing. ' +
      'Avoid hype words; stay factual and outcome-driven.',
    sceneWeightHint: [6, 6, 4, 7, 7, 6, 6, 8],
  },
};

export function getTemplateProfile(id: TemplateId): TemplateProfile {
  return TEMPLATE_PROFILES[id];
}

export function selectTemplate(scraped: ScrapedData, requested?: 'auto' | TemplateId): TemplateSelection {
  if (requested && requested !== 'auto') {
    return {
      profile: TEMPLATE_PROFILES[requested],
      reason: `Selected by --template=${requested}`,
    };
  }

  const haystack = [
    scraped.domain,
    scraped.title,
    scraped.description,
    scraped.ogTitle,
    scraped.ogDescription,
    ...scraped.headings,
    ...scraped.features,
  ]
    .join(' ')
    .toLowerCase();

  const productDemoScore = countMatches(haystack, [
    'shop', 'store', 'checkout', 'cart', 'order', 'orders', 'inventory', 'sku', 'catalog', 'commerce', 'retail', 'payments', 'shipping',
  ]);

  const founderScore = countMatches(haystack, [
    'founder', 'our story', 'journey', 'mission', 'vision', 'creator', 'team', 'craft', 'indie', 'bootstrapped',
  ]);

  const saasScore = countMatches(haystack, [
    'api', 'workflow', 'integrations', 'platform', 'automation', 'developer', 'team', 'project', 'ops', 'dashboard', 'productivity',
  ]);

  if (productDemoScore >= 3 && productDemoScore >= founderScore) {
    return {
      profile: TEMPLATE_PROFILES['product-demo'],
      reason: `Auto-selected product-demo from commerce signals (score ${productDemoScore})`,
    };
  }

  if (founderScore >= 3 && founderScore > saasScore) {
    return {
      profile: TEMPLATE_PROFILES['founder-story'],
      reason: `Auto-selected founder-story from narrative signals (score ${founderScore})`,
    };
  }

  return {
    profile: TEMPLATE_PROFILES['yc-saas'],
    reason: `Auto-selected yc-saas as default B2B template (saas score ${saasScore})`,
  };
}

function countMatches(text: string, terms: string[]): number {
  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) score += 1;
  }
  return score;
}

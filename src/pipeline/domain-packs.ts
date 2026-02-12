import type {ScrapedData} from './scraper';

export type TemplateStyleId = 'yc-saas' | 'product-demo' | 'founder-story';
export type DomainPackId =
  | 'general'
  | 'b2b-saas'
  | 'devtools'
  | 'ecommerce-retail'
  | 'fintech'
  | 'gaming'
  | 'media-creator'
  | 'education'
  | 'real-estate'
  | 'travel-hospitality'
  | 'logistics-ops'
  | 'social-community';

export type FeatureIconId =
  | 'mail'
  | 'ai'
  | 'social'
  | 'code'
  | 'calendar'
  | 'analytics'
  | 'chat'
  | 'commerce'
  | 'finance'
  | 'health'
  | 'support'
  | 'docs'
  | 'media'
  | 'generic';

export interface DomainPack {
  id: DomainPackId;
  label: string;
  description: string;
  preferredTemplate: TemplateStyleId;
  keywords: string[];
  negativeKeywords?: string[];
  allowedIcons: FeatureIconId[];
  forbiddenTerms: string[];
  concreteFields: string[];
  fallbackIntegrations: string[];
  scriptStyleHint: string;
}

export interface DomainPackSelection {
  pack: DomainPack;
  reason: string;
  scores: Record<DomainPackId, number>;
  confidence: number;
  topCandidates: Array<{id: DomainPackId; score: number}>;
}

const DOMAIN_PACKS: Record<DomainPackId, DomainPack> = {
  general: {
    id: 'general',
    label: 'General Product',
    description: 'Strong fallback for unknown or mixed domains.',
    preferredTemplate: 'founder-story',
    keywords: ['product', 'platform', 'service', 'solution', 'experience'],
    allowedIcons: ['generic', 'chat', 'docs', 'media', 'analytics', 'support', 'calendar'],
    forbiddenTerms: [],
    concreteFields: ['Status', 'Update', 'Milestone', 'Next Step', 'Result'],
    fallbackIntegrations: ['Slack', 'Notion', 'Google Drive'],
    scriptStyleHint:
      'Use neutral product language. Avoid domain-specific jargon unless explicitly present in source copy.',
  },
  'b2b-saas': {
    id: 'b2b-saas',
    label: 'B2B SaaS',
    description: 'B2B workflow and operations products.',
    preferredTemplate: 'yc-saas',
    keywords: ['workflow', 'automation', 'team', 'ops', 'crm', 'pipeline', 'dashboard', 'platform', 'enterprise'],
    allowedIcons: ['analytics', 'chat', 'docs', 'calendar', 'support', 'code', 'ai', 'generic'],
    forbiddenTerms: ['jackpot', 'odds board', 'tier comp'],
    concreteFields: ['Owner', 'Status', 'Priority', 'SLA', 'Ticket'],
    fallbackIntegrations: ['Slack', 'Notion', 'HubSpot', 'Zapier'],
    scriptStyleHint:
      'Emphasize workflow clarity, cycle time reduction, and operational outcomes. Keep it concrete and execution-focused.',
  },
  devtools: {
    id: 'devtools',
    label: 'Developer Tools',
    description: 'Products for software teams and developer workflows.',
    preferredTemplate: 'yc-saas',
    keywords: ['api', 'sdk', 'repository', 'deploy', 'build', 'observability', 'ci', 'cloud', 'code', 'runtime'],
    allowedIcons: ['code', 'analytics', 'docs', 'chat', 'ai', 'support', 'generic'],
    forbiddenTerms: ['patient', 'booking engine', 'jackpot'],
    concreteFields: ['Build', 'Latency', 'Error Rate', 'Deploy', 'Incident'],
    fallbackIntegrations: ['GitHub', 'Vercel', 'Sentry', 'Linear'],
    scriptStyleHint:
      'Use technical but accessible language. Mention concrete engineering signals like deploys, errors, and latency.',
  },
  'ecommerce-retail': {
    id: 'ecommerce-retail',
    label: 'Ecommerce & Retail',
    description: 'D2C, retail, and commerce operations.',
    preferredTemplate: 'product-demo',
    keywords: ['cart', 'checkout', 'order', 'inventory', 'sku', 'catalog', 'store', 'shop', 'shipping', 'merchandise'],
    allowedIcons: ['commerce', 'analytics', 'support', 'chat', 'finance', 'calendar', 'media', 'generic'],
    forbiddenTerms: ['patient', 'deploy pipeline', 'ranked comp'],
    concreteFields: ['Order', 'Conversion', 'AOV', 'Stock', 'Fulfillment'],
    fallbackIntegrations: ['Shopify', 'Stripe', 'Klaviyo', 'Zendesk'],
    scriptStyleHint:
      'Focus on conversion, merchandising, inventory velocity, and customer retention outcomes.',
  },
  fintech: {
    id: 'fintech',
    label: 'Fintech',
    description: 'Payments, banking, risk, or finance workflows.',
    preferredTemplate: 'yc-saas',
    keywords: ['payment', 'ledger', 'bank', 'fraud', 'compliance', 'risk', 'invoice', 'billing', 'transaction', 'treasury'],
    allowedIcons: ['finance', 'analytics', 'docs', 'support', 'chat', 'calendar', 'generic'],
    forbiddenTerms: ['patient', 'loot', 'tier list'],
    concreteFields: ['Txn Volume', 'Risk Score', 'Settlement', 'Dispute', 'Cash Flow'],
    fallbackIntegrations: ['Stripe', 'Plaid', 'QuickBooks', 'Salesforce'],
    scriptStyleHint:
      'Use measured language. Prioritize trust, control, and auditable financial workflows.',
  },
  gaming: {
    id: 'gaming',
    label: 'Gaming & Esports',
    description: 'Competitive gaming, game analytics, community strategy tools.',
    preferredTemplate: 'product-demo',
    keywords: ['patch', 'meta', 'tier list', 'ranked', 'champion', 'build', 'esports', 'guide', 'comp', 'win rate'],
    allowedIcons: ['media', 'social', 'chat', 'analytics', 'docs', 'calendar', 'generic'],
    forbiddenTerms: [
      'pipeline ops',
      'patient',
      'invoice approval',
      'crm handoff',
      'ownership and status',
      'planning and execution',
      'status churn',
    ],
    concreteFields: ['Patch', 'Win Rate', 'Rank', 'Meta Shift', 'Comp'],
    fallbackIntegrations: ['Discord', 'Twitch', 'YouTube', 'Riot Games'],
    scriptStyleHint:
      'Use gameplay and competitive language. Mention patches, ranks, comps, and meta movement.',
  },
  'media-creator': {
    id: 'media-creator',
    label: 'Media & Creator',
    description: 'Content production, creator workflows, and publishing tools.',
    preferredTemplate: 'founder-story',
    keywords: ['creator', 'content', 'audience', 'channel', 'video', 'podcast', 'newsletter', 'publish', 'engagement'],
    allowedIcons: ['media', 'analytics', 'social', 'chat', 'calendar', 'docs', 'generic'],
    forbiddenTerms: ['ehr', 'warehousing', 'incident response'],
    concreteFields: ['Views', 'Retention', 'Publish Date', 'CTR', 'Engagement'],
    fallbackIntegrations: ['YouTube', 'TikTok', 'Instagram', 'Substack'],
    scriptStyleHint:
      'Center the creator loop: ideation, production, distribution, and audience growth signals.',
  },
  education: {
    id: 'education',
    label: 'Education & Learning',
    description: 'Edtech, courses, tutoring, and learning operations.',
    preferredTemplate: 'founder-story',
    keywords: ['student', 'curriculum', 'course', 'lesson', 'learning', 'assessment', 'teacher', 'classroom', 'academy'],
    allowedIcons: ['docs', 'calendar', 'analytics', 'chat', 'media', 'support', 'generic'],
    forbiddenTerms: ['jackpot', 'warehouse slot', 'payment fraud'],
    concreteFields: ['Module', 'Completion', 'Quiz Score', 'Cohort', 'Attendance'],
    fallbackIntegrations: ['Google Classroom', 'Canvas', 'Zoom', 'Notion'],
    scriptStyleHint:
      'Use learner outcomes and progress framing. Keep claims concrete and instructional.',
  },
  'real-estate': {
    id: 'real-estate',
    label: 'Real Estate',
    description: 'Brokerage, listings, and property operations.',
    preferredTemplate: 'product-demo',
    keywords: ['listing', 'property', 'broker', 'agent', 'showing', 'escrow', 'mortgage', 'rental', 'tenant'],
    allowedIcons: ['calendar', 'analytics', 'docs', 'chat', 'finance', 'support', 'generic'],
    forbiddenTerms: ['patient chart', 'comp reroll', 'git commit'],
    concreteFields: ['Listing', 'Showing', 'Offer', 'Close Date', 'Occupancy'],
    fallbackIntegrations: ['Zillow', 'Redfin', 'DocuSign', 'Calendly'],
    scriptStyleHint:
      'Highlight speed-to-close, listing quality, and client communication consistency.',
  },
  'travel-hospitality': {
    id: 'travel-hospitality',
    label: 'Travel & Hospitality',
    description: 'Booking, guest operations, and hospitality coordination.',
    preferredTemplate: 'product-demo',
    keywords: ['booking', 'guest', 'reservation', 'itinerary', 'hotel', 'travel', 'check-in', 'property management'],
    allowedIcons: ['calendar', 'support', 'chat', 'analytics', 'commerce', 'media', 'generic'],
    forbiddenTerms: ['patient intake', 'git deploy', 'tier comp'],
    concreteFields: ['Reservation', 'Occupancy', 'ADR', 'Arrival', 'Check-in'],
    fallbackIntegrations: ['Booking.com', 'Airbnb', 'Expedia', 'Stripe'],
    scriptStyleHint:
      'Emphasize guest experience, booking conversion, and operational responsiveness.',
  },
  'logistics-ops': {
    id: 'logistics-ops',
    label: 'Logistics & Operations',
    description: 'Supply chain, delivery, and field operations.',
    preferredTemplate: 'yc-saas',
    keywords: ['shipment', 'warehouse', 'fleet', 'route', 'fulfillment', 'delivery', 'inventory movement', 'dispatch'],
    allowedIcons: ['analytics', 'calendar', 'support', 'chat', 'docs', 'commerce', 'generic'],
    forbiddenTerms: ['patient diagnosis', 'loot odds', 'creator sponsorship'],
    concreteFields: ['ETA', 'Route', 'Shipment', 'On-time', 'Capacity'],
    fallbackIntegrations: ['ShipStation', 'UPS', 'FedEx', 'SAP'],
    scriptStyleHint:
      'Focus on throughput, ETA confidence, and operational reliability under load.',
  },
  'social-community': {
    id: 'social-community',
    label: 'Social & Community',
    description: 'Community platforms, social engagement, and moderation workflows.',
    preferredTemplate: 'founder-story',
    keywords: ['community', 'member', 'social', 'moderation', 'engagement', 'forum', 'creator network', 'discussion'],
    allowedIcons: ['social', 'chat', 'media', 'analytics', 'support', 'calendar', 'generic'],
    forbiddenTerms: ['ehr', 'shipping manifest', 'tax ledger'],
    concreteFields: ['Members', 'Posts', 'Engagement', 'Response Time', 'Flagged'],
    fallbackIntegrations: ['Discord', 'Reddit', 'X', 'Telegram'],
    scriptStyleHint:
      'Prioritize community health, engagement loops, and moderation clarity.',
  },
};

export const DOMAIN_PACK_IDS = Object.keys(DOMAIN_PACKS) as DomainPackId[];

export function getDomainPack(id: DomainPackId): DomainPack {
  return DOMAIN_PACKS[id];
}

export function selectDomainPack(scraped: ScrapedData, requested?: 'auto' | DomainPackId): DomainPackSelection {
  if (requested && requested !== 'auto') {
    return {
      pack: DOMAIN_PACKS[requested],
      reason: `Selected by --pack=${requested}`,
      scores: makeZeroScores(),
      confidence: 1,
      topCandidates: [{id: requested, score: 999}],
    };
  }

  const corpora = {
    domain: scraped.domain.toLowerCase(),
    title: [scraped.title, scraped.ogTitle].join(' ').toLowerCase(),
    description: [scraped.description, scraped.ogDescription].join(' ').toLowerCase(),
    headings: scraped.headings.join(' ').toLowerCase(),
    features: scraped.features.join(' ').toLowerCase(),
    body: scraped.bodyText.toLowerCase(),
    links: scraped.links.join(' ').toLowerCase(),
  };

  const scores = makeZeroScores();
  const candidates: Array<{id: DomainPackId; score: number}> = [];

  for (const id of DOMAIN_PACK_IDS) {
    if (id === 'general') continue;
    const pack = DOMAIN_PACKS[id];
    let score = 0;

    for (const keyword of pack.keywords) {
      const hitScore = weightedKeywordScore(corpora, keyword);
      if (hitScore > 0) score += hitScore;
    }

    for (const neg of pack.negativeKeywords ?? []) {
      if (weightedKeywordScore(corpora, neg) > 0) {
        score -= 2.5;
      }
    }

    score = Number(score.toFixed(2));
    scores[id] = score;
    candidates.push({id, score});
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const runnerUp = candidates[1];
  const bestScore = best?.score ?? 0;
  const gap = best && runnerUp ? best.score - runnerUp.score : bestScore;
  const confidence = inferConfidence(bestScore, gap);

  const MIN_BEST_SCORE = 5;
  const MIN_GAP = 1.5;
  const MIN_CONFIDENCE = 0.4;
  const AMBIGUOUS_HIGH_CONFIDENCE = 0.62;

  if (!best || bestScore < MIN_BEST_SCORE || confidence < MIN_CONFIDENCE || (gap < MIN_GAP && confidence < AMBIGUOUS_HIGH_CONFIDENCE)) {
    return {
      pack: DOMAIN_PACKS.general,
      reason: `Auto-selected general fallback (best=${best?.id ?? 'none'} score=${bestScore.toFixed(2)}, gap=${gap.toFixed(2)}, confidence=${confidence.toFixed(2)}).`,
      scores,
      confidence,
      topCandidates: candidates.slice(0, 3),
    };
  }

  return {
    pack: DOMAIN_PACKS[best.id],
    reason: `Auto-selected ${best.id} (score=${bestScore.toFixed(2)}, gap=${gap.toFixed(2)}, confidence=${confidence.toFixed(2)}).`,
    scores,
    confidence,
    topCandidates: candidates.slice(0, 3),
  };
}

function makeZeroScores(): Record<DomainPackId, number> {
  return {
    general: 0,
    'b2b-saas': 0,
    devtools: 0,
    'ecommerce-retail': 0,
    fintech: 0,
    gaming: 0,
    'media-creator': 0,
    education: 0,
    'real-estate': 0,
    'travel-hospitality': 0,
    'logistics-ops': 0,
    'social-community': 0,
  };
}

function weightedKeywordScore(
  corpora: {
    domain: string;
    title: string;
    description: string;
    headings: string;
    features: string;
    body: string;
    links: string;
  },
  keyword: string,
): number {
  const phrase = toPhraseRegex(keyword);
  const multiplier = keywordWeight(keyword);
  let score = 0;
  if (phrase.test(corpora.domain)) score += 4 * multiplier;
  if (phrase.test(corpora.title)) score += 3 * multiplier;
  if (phrase.test(corpora.description)) score += 2 * multiplier;
  if (phrase.test(corpora.headings)) score += 2 * multiplier;
  if (phrase.test(corpora.features)) score += 2 * multiplier;
  if (phrase.test(corpora.links)) score += 1.5 * multiplier;
  if (phrase.test(corpora.body)) score += 1 * multiplier;
  return score;
}

function inferConfidence(bestScore: number, gap: number): number {
  if (bestScore <= 0) return 0;
  const strength = Math.min(1, bestScore / 18);
  const separation = Math.max(0, Math.min(1, gap / Math.max(bestScore, 1)));
  const confidence = 0.55 * strength + 0.45 * separation;
  return Number(Math.max(0, Math.min(1, confidence)).toFixed(2));
}

function toPhraseRegex(term: string): RegExp {
  const normalized = term.toLowerCase().trim();
  const phrase = normalized.split(/\s+/).map((part) => escapeRegex(part)).join('\\s+');
  return new RegExp(`(^|\\W)${phrase}(?=\\W|$)`, 'i');
}

function keywordWeight(keyword: string): number {
  const normalized = keyword.toLowerCase().trim();
  const weakWeights: Record<string, number> = {
    product: 0.4,
    platform: 0.4,
    service: 0.4,
    solution: 0.4,
    experience: 0.4,
    team: 0.45,
    teams: 0.45,
  };
  return weakWeights[normalized] ?? 1;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ScraperFixture {
  id: string;
  domain: string;
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  bodyText: string;
  structuredHints: string[];
  expectedMode: 'full' | 'metadata-fallback';
  expectedReasons?: string[];
  expectedFeatureTerms?: string[];
}

export const SCRAPER_FIXTURES: ScraperFixture[] = [
  {
    id: 'blocked-unsupported-browser',
    domain: 'canva.com',
    title: 'Unsupported client - Canva',
    description: 'Please update your browser to continue.',
    ogTitle: 'Canva',
    ogDescription: 'Create and publish visual content faster.',
    bodyText: 'Unsupported browser. Please update browser. Enable JavaScript.',
    structuredHints: [],
    expectedMode: 'metadata-fallback',
    expectedReasons: ['unsupported-client', 'unsupported-browser'],
    expectedFeatureTerms: ['canva'],
  },
  {
    id: 'blocked-cloudflare-challenge',
    domain: 'acmeops.io',
    title: 'Just a moment...',
    description: 'Checking your browser before accessing.',
    ogTitle: 'AcmeOps',
    ogDescription: 'Operations platform for dispatch and routing.',
    bodyText: 'Cloudflare security check. Automated requests are blocked. CAPTCHA required.',
    structuredHints: ['Logistics', 'Operations Software'],
    expectedMode: 'metadata-fallback',
    expectedReasons: ['challenge-page', 'cloudflare', 'captcha'],
    expectedFeatureTerms: ['acmeops'],
  },
  {
    id: 'blocked-access-denied',
    domain: 'secureflow.app',
    title: 'Access denied',
    description: 'Forbidden request.',
    ogTitle: 'SecureFlow',
    ogDescription: 'Workflow automation for security teams.',
    bodyText: 'Access denied. Forbidden. Security check failed.',
    structuredHints: ['Security automation'],
    expectedMode: 'metadata-fallback',
    expectedReasons: ['access-denied', 'forbidden'],
    expectedFeatureTerms: ['secureflow'],
  },
  {
    id: 'normal-product-page',
    domain: 'pipelinepilot.com',
    title: 'PipelinePilot - Revenue operations workspace',
    description: 'Track deals, SLAs, and support handoffs in one dashboard.',
    ogTitle: 'PipelinePilot',
    ogDescription: 'A better revops control center.',
    bodyText: 'Automate handoffs, monitor SLA status, and improve team execution.',
    structuredHints: ['B2B', 'CRM'],
    expectedMode: 'full',
  },
  {
    id: 'normal-marketing-page',
    domain: 'craftloop.io',
    title: 'CraftLoop for creators',
    description: 'Plan content and monitor audience retention.',
    ogTitle: 'CraftLoop',
    ogDescription: 'Creator workflow and analytics.',
    bodyText: 'Creators use CraftLoop to track publishing schedules and growth metrics.',
    structuredHints: ['Creator economy'],
    expectedMode: 'full',
  },
];

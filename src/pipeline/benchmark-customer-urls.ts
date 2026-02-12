import type {DomainPackId} from './domain-packs';

export interface CustomerBenchmarkCase {
  url: string;
  expectedPack: DomainPackId;
  segment: 'core-icp' | 'adjacent-icp' | 'stress';
}

// Customer-style corpus for go-to-market learning.
// Core ICP is startup/SMB SaaS and devtools landing pages where launch videos are high-value.
export const CUSTOMER_BENCHMARK_CASES: CustomerBenchmarkCase[] = [
  // Core ICP: Devtools / builder products
  {url: 'linear.app', expectedPack: 'devtools', segment: 'core-icp'},
  {url: 'vercel.com', expectedPack: 'devtools', segment: 'core-icp'},
  {url: 'postman.com', expectedPack: 'devtools', segment: 'core-icp'},
  {url: 'sentry.io', expectedPack: 'devtools', segment: 'core-icp'},
  {url: 'supabase.com', expectedPack: 'devtools', segment: 'core-icp'},
  {url: 'render.com', expectedPack: 'devtools', segment: 'core-icp'},
  {url: 'railway.com', expectedPack: 'devtools', segment: 'core-icp'},
  {url: 'fly.io', expectedPack: 'devtools', segment: 'core-icp'},

  // Core ICP: B2B SaaS
  {url: 'hubspot.com', expectedPack: 'b2b-saas', segment: 'core-icp'},
  {url: 'intercom.com', expectedPack: 'b2b-saas', segment: 'core-icp'},
  {url: 'zendesk.com', expectedPack: 'b2b-saas', segment: 'core-icp'},
  {url: 'monday.com', expectedPack: 'b2b-saas', segment: 'core-icp'},
  {url: 'airtable.com', expectedPack: 'b2b-saas', segment: 'core-icp'},
  {url: 'clickup.com', expectedPack: 'b2b-saas', segment: 'core-icp'},
  {url: 'gong.io', expectedPack: 'b2b-saas', segment: 'core-icp'},
  {url: 'segment.com', expectedPack: 'b2b-saas', segment: 'core-icp'},

  // Core ICP: Commerce and growth tooling buyers
  {url: 'shopify.com', expectedPack: 'ecommerce-retail', segment: 'core-icp'},
  {url: 'bigcommerce.com', expectedPack: 'ecommerce-retail', segment: 'core-icp'},
  {url: 'klaviyo.com', expectedPack: 'ecommerce-retail', segment: 'core-icp'},
  {url: 'printful.com', expectedPack: 'ecommerce-retail', segment: 'core-icp'},
  {url: 'gorgias.com', expectedPack: 'ecommerce-retail', segment: 'core-icp'},

  // Adjacent ICP: Financial SaaS
  {url: 'stripe.com', expectedPack: 'fintech', segment: 'adjacent-icp'},
  {url: 'plaid.com', expectedPack: 'fintech', segment: 'adjacent-icp'},
  {url: 'brex.com', expectedPack: 'fintech', segment: 'adjacent-icp'},
  {url: 'ramp.com', expectedPack: 'fintech', segment: 'adjacent-icp'},
  {url: 'mercury.com', expectedPack: 'fintech', segment: 'adjacent-icp'},

  // Adjacent ICP: Creator/product-led growth tools
  {url: 'descript.com', expectedPack: 'media-creator', segment: 'adjacent-icp'},
  {url: 'substack.com', expectedPack: 'media-creator', segment: 'adjacent-icp'},
  {url: 'beehiiv.com', expectedPack: 'media-creator', segment: 'adjacent-icp'},

  // Stress set: known challenge/edge pages for robustness
  {url: 'canva.com', expectedPack: 'general', segment: 'stress'},
  {url: 'notion.so', expectedPack: 'general', segment: 'stress'},
];

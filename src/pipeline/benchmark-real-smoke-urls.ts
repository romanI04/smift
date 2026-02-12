import type {DomainPackId} from './domain-packs';

export interface RealSmokeBenchmarkCase {
  url: string;
  expectedPack: DomainPackId;
}

export const REAL_SMOKE_BENCHMARK_CASES: RealSmokeBenchmarkCase[] = [
  {url: 'linear.app', expectedPack: 'devtools'},
  {url: 'vercel.com', expectedPack: 'devtools'},
  {url: 'hubspot.com', expectedPack: 'b2b-saas'},
  {url: 'intercom.com', expectedPack: 'b2b-saas'},
  {url: 'shopify.com', expectedPack: 'ecommerce-retail'},
  {url: 'klaviyo.com', expectedPack: 'ecommerce-retail'},
  {url: 'stripe.com', expectedPack: 'fintech'},
  {url: 'plaid.com', expectedPack: 'fintech'},
  {url: 'tftacademy.com', expectedPack: 'gaming'},
  {url: 'op.gg', expectedPack: 'gaming'},
];

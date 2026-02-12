import type {DomainPackId} from './domain-packs';

export interface RealBenchmarkCase {
  url: string;
  expectedPack: DomainPackId;
}

export const REAL_BENCHMARK_CASES: RealBenchmarkCase[] = [
  {url: 'linear.app', expectedPack: 'devtools'},
  {url: 'vercel.com', expectedPack: 'devtools'},
  {url: 'postman.com', expectedPack: 'devtools'},
  {url: 'sentry.io', expectedPack: 'devtools'},

  {url: 'hubspot.com', expectedPack: 'b2b-saas'},
  {url: 'salesforce.com', expectedPack: 'b2b-saas'},
  {url: 'intercom.com', expectedPack: 'b2b-saas'},
  {url: 'monday.com', expectedPack: 'b2b-saas'},

  {url: 'shopify.com', expectedPack: 'ecommerce-retail'},
  {url: 'bigcommerce.com', expectedPack: 'ecommerce-retail'},
  {url: 'klaviyo.com', expectedPack: 'ecommerce-retail'},
  {url: 'printful.com', expectedPack: 'ecommerce-retail'},

  {url: 'stripe.com', expectedPack: 'fintech'},
  {url: 'plaid.com', expectedPack: 'fintech'},
  {url: 'brex.com', expectedPack: 'fintech'},
  {url: 'ramp.com', expectedPack: 'fintech'},

  {url: 'tftacademy.com', expectedPack: 'gaming'},
  {url: 'op.gg', expectedPack: 'gaming'},
  {url: 'tracker.gg', expectedPack: 'gaming'},
  {url: 'mobalytics.gg', expectedPack: 'gaming'},

  {url: 'canva.com', expectedPack: 'media-creator'},
  {url: 'descript.com', expectedPack: 'media-creator'},
  {url: 'substack.com', expectedPack: 'media-creator'},
  {url: 'beehiiv.com', expectedPack: 'media-creator'},

  {url: 'khanacademy.org', expectedPack: 'education'},
  {url: 'coursera.org', expectedPack: 'education'},
  {url: 'udemy.com', expectedPack: 'education'},
  {url: 'duolingo.com', expectedPack: 'education'},

  {url: 'zillow.com', expectedPack: 'real-estate'},
  {url: 'redfin.com', expectedPack: 'real-estate'},
  {url: 'realtor.com', expectedPack: 'real-estate'},
  {url: 'compass.com', expectedPack: 'real-estate'},

  {url: 'airbnb.com', expectedPack: 'travel-hospitality'},
  {url: 'booking.com', expectedPack: 'travel-hospitality'},
  {url: 'expedia.com', expectedPack: 'travel-hospitality'},
  {url: 'marriott.com', expectedPack: 'travel-hospitality'},

  {url: 'shipstation.com', expectedPack: 'logistics-ops'},
  {url: 'flexport.com', expectedPack: 'logistics-ops'},
  {url: 'project44.com', expectedPack: 'logistics-ops'},
  {url: 'fourkites.com', expectedPack: 'logistics-ops'},

  {url: 'discord.com', expectedPack: 'social-community'},
  {url: 'reddit.com', expectedPack: 'social-community'},
  {url: 'circle.so', expectedPack: 'social-community'},
  {url: 'mighty.network', expectedPack: 'social-community'},

  {url: 'notion.so', expectedPack: 'general'},
  {url: 'loom.com', expectedPack: 'general'},
  {url: 'miro.com', expectedPack: 'general'},
  {url: 'atlassian.com/software/jira', expectedPack: 'general'},
];

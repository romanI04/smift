import type {ScrapedData} from './scraper';
import type {DomainPackId} from './domain-packs';

export interface PackFixture {
  id: string;
  expectedPack: DomainPackId;
  minConfidence?: number;
  scraped: ScrapedData;
}

export const PACK_FIXTURES: PackFixture[] = [
  {
    id: 'b2b-saas-ops-dash',
    expectedPack: 'b2b-saas',
    minConfidence: 0.5,
    scraped: makeScraped({
      domain: 'opspilot.io',
      title: 'OpsPilot - Workflow automation for enterprise teams',
      description: 'Track SLA, ticket ownership, and CRM handoffs in one platform.',
      headings: ['Automate team workflows', 'Pipeline and dashboard visibility'],
      features: ['Route tickets by priority', 'Monitor SLA breaches', 'Coordinate enterprise ops'],
      bodyText:
        'OpsPilot helps operations teams manage workflow execution, automate approvals, and reduce cycle time across pipeline stages.',
      links: ['HubSpot integration: /integrations/hubspot', 'Slack alerts: /integrations/slack'],
    }),
  },
  {
    id: 'devtools-api-runtime',
    expectedPack: 'devtools',
    minConfidence: 0.5,
    scraped: makeScraped({
      domain: 'runtimeforge.dev',
      title: 'RuntimeForge API observability for cloud services',
      description: 'Ship faster with SDK traces, CI checks, and deploy insights.',
      headings: ['Debug latency in production', 'Code level traces and incident context'],
      features: ['Track API error rate', 'Deploy with confidence', 'Integrate with GitHub and Sentry'],
      bodyText:
        'Engineering teams use RuntimeForge to inspect runtime behavior, monitor build health, and resolve incidents from one observability workspace.',
      links: ['GitHub App: /github', 'Sentry Sync: /sentry'],
    }),
  },
  {
    id: 'ecommerce-checkout-ops',
    expectedPack: 'ecommerce-retail',
    minConfidence: 0.5,
    scraped: makeScraped({
      domain: 'cartnative.com',
      title: 'CartNative boosts checkout conversion for D2C stores',
      description: 'Manage catalog, stock, order flow, and fulfillment from one retail dashboard.',
      headings: ['Improve checkout completion', 'Track SKU inventory health'],
      features: ['AOV insights by campaign', 'Low stock alerts', 'Recover abandoned cart'],
      bodyText:
        'Retail teams optimize merchandising, shipping, and conversion with daily order analytics and demand trends.',
      links: ['Shopify app: /shopify', 'Stripe payments: /stripe'],
    }),
  },
  {
    id: 'fintech-risk-ledger',
    expectedPack: 'fintech',
    minConfidence: 0.5,
    scraped: makeScraped({
      domain: 'ledgerguard.ai',
      title: 'LedgerGuard payment risk and compliance platform',
      description: 'Reconcile transaction data, monitor fraud, and control settlement workflows.',
      headings: ['Audit ready ledger controls', 'Risk score on every transaction'],
      features: ['Invoice and billing automation', 'Dispute workflow tracking', 'Treasury visibility'],
      bodyText:
        'Finance operators use LedgerGuard to reduce reconciliation errors, detect fraud patterns, and keep compliance evidence centralized.',
      links: ['Plaid connector: /plaid', 'QuickBooks sync: /quickbooks'],
    }),
  },
  {
    id: 'gaming-meta-patch',
    expectedPack: 'gaming',
    minConfidence: 0.5,
    scraped: makeScraped({
      domain: 'metaarena.gg',
      title: 'MetaArena tier list and patch tracker for ranked players',
      description: 'Analyze comp win rate shifts and champion builds after each patch.',
      headings: ['Daily meta updates', 'Best comps for your rank'],
      features: ['Patch 14.4 breakdown', 'Guide videos by challenger coaches', 'Ranked comp explorer'],
      bodyText:
        'Players review patch notes, compare win rate by comp, and prep for tournament weekend with up to date strategy data.',
      links: ['Discord community: /discord', 'Twitch VODs: /twitch'],
    }),
  },
  {
    id: 'media-creator-channel-ops',
    expectedPack: 'media-creator',
    minConfidence: 0.5,
    scraped: makeScraped({
      domain: 'channelloop.co',
      title: 'ChannelLoop for creator content operations',
      description: 'Plan videos, track audience retention, and publish to every channel.',
      headings: ['Creator workflow from idea to publish', 'Content performance by audience segment'],
      features: ['Video publish calendar', 'Retention and CTR trends', 'Newsletter and podcast sync'],
      bodyText:
        'ChannelLoop helps creators systematize production and distribution while monitoring engagement across each platform.',
      links: ['YouTube publishing: /youtube', 'Substack distribution: /substack'],
    }),
  },
  {
    id: 'education-course-progress',
    expectedPack: 'education',
    minConfidence: 0.5,
    scraped: makeScraped({
      domain: 'cohortpath.edu',
      title: 'CohortPath learning platform for schools and academies',
      description: 'Track student progress, lesson completion, and assessment outcomes.',
      headings: ['Curriculum planning tools', 'Classroom analytics for teachers'],
      features: ['Quiz score dashboard', 'Cohort attendance tracking', 'Module completion alerts'],
      bodyText:
        'Education teams manage courses, assignments, and learning milestones while helping students stay on track through each lesson.',
      links: ['Canvas integration: /canvas', 'Zoom classes: /zoom'],
    }),
  },
  {
    id: 'real-estate-listing-pipeline',
    expectedPack: 'real-estate',
    minConfidence: 0.5,
    scraped: makeScraped({
      domain: 'closergrid.com',
      title: 'CloserGrid for modern real estate broker teams',
      description: 'Manage listings, showings, and escrow updates in a single system.',
      headings: ['Move from listing to close faster', 'Offer and occupancy visibility'],
      features: ['Showing schedule board', 'Offer tracker by property', 'Close date reminders'],
      bodyText:
        'Agents and brokers coordinate documents, buyer communication, and listing activity to improve close rate and response time.',
      links: ['Zillow feed sync: /zillow', 'DocuSign workflow: /docusign'],
    }),
  },
  {
    id: 'travel-hospitality-guest-ops',
    expectedPack: 'travel-hospitality',
    minConfidence: 0.5,
    scraped: makeScraped({
      domain: 'guestlane.travel',
      title: 'GuestLane booking and reservation operations',
      description: 'Increase occupancy with better itinerary, check in, and guest messaging.',
      headings: ['Reservation intelligence', 'Arrival and check in coordination'],
      features: ['ADR and occupancy dashboard', 'Guest support inbox', 'Booking conversion funnel'],
      bodyText:
        'Hospitality teams manage reservations, guest communication, and stay operations with reliable property level insights.',
      links: ['Airbnb channel manager: /airbnb', 'Expedia sync: /expedia'],
    }),
  },
  {
    id: 'logistics-dispatch-eta',
    expectedPack: 'logistics-ops',
    minConfidence: 0.5,
    scraped: makeScraped({
      domain: 'routepulse.io',
      title: 'RoutePulse dispatch and shipment orchestration',
      description: 'Plan routes, track ETA confidence, and optimize warehouse throughput.',
      headings: ['Fleet and delivery control center', 'On time shipment performance'],
      features: ['Dispatch board by route', 'Capacity utilization analytics', 'Fulfillment delay alerts'],
      bodyText:
        'Operations leaders coordinate shipment movement across warehouses and carriers while reducing missed delivery windows.',
      links: ['FedEx connector: /fedex', 'UPS connector: /ups'],
    }),
  },
  {
    id: 'social-community-moderation',
    expectedPack: 'social-community',
    minConfidence: 0.5,
    scraped: makeScraped({
      domain: 'tribehub.social',
      title: 'TribeHub community platform with moderation workflows',
      description: 'Grow member engagement while keeping discussion quality healthy.',
      headings: ['Community engagement analytics', 'Moderation queue and response times'],
      features: ['Flagged post triage', 'Member activity score', 'Discussion health dashboard'],
      bodyText:
        'Community teams run social spaces with clear moderation policies, fast member support, and measurable engagement loops.',
      links: ['Discord bridge: /discord', 'Telegram sync: /telegram'],
    }),
  },
  {
    id: 'general-ambiguous-product',
    expectedPack: 'general',
    minConfidence: 0,
    scraped: makeScraped({
      domain: 'northstarapp.com',
      title: 'Northstar - one platform for better product experiences',
      description: 'Align your team around outcomes, communication, and execution.',
      headings: ['Plan and build faster', 'Connect teams across workstreams'],
      features: ['Unified workspace', 'Cross functional visibility', 'AI assistant'],
      bodyText:
        'Northstar helps teams launch projects and track progress with one simple product experience.',
      links: ['Contact sales: /contact', 'Read docs: /docs'],
    }),
  },
  {
    id: 'general-mixed-signals',
    expectedPack: 'general',
    minConfidence: 0,
    scraped: makeScraped({
      domain: 'allflow.one',
      title: 'Allflow for teams, customers, and operations',
      description: 'From engagement to analytics, run everything in one place.',
      headings: ['Create workflows', 'Track metrics', 'Share updates'],
      features: ['Automation builder', 'Dashboards', 'Messaging'],
      bodyText:
        'Allflow combines project planning, reporting, and communication for companies with mixed workflows.',
      links: ['Overview: /overview', 'Pricing: /pricing'],
    }),
  },
  {
    id: 'general-minimal-site',
    expectedPack: 'general',
    minConfidence: 0,
    scraped: makeScraped({
      domain: 'simplelaunch.page',
      title: 'SimpleLaunch',
      description: 'Coming soon.',
      headings: ['Build something great'],
      features: ['Join waitlist'],
      bodyText: 'SimpleLaunch helps founders go from idea to launch.',
      links: ['Join waitlist: /waitlist'],
    }),
  },
];

function makeScraped(args: {
  domain: string;
  title: string;
  description: string;
  headings: string[];
  features: string[];
  bodyText: string;
  links: string[];
}): ScrapedData {
  return {
    url: `https://${args.domain}`,
    title: args.title,
    description: args.description,
    ogTitle: args.title,
    ogDescription: args.description,
    ogImage: '',
    headings: args.headings,
    features: args.features,
    bodyText: args.bodyText,
    structuredHints: [],
    colors: [],
    links: args.links,
    domain: args.domain,
  };
}

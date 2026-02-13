import fs from 'fs';
import path from 'path';

type PromotionPolicySegment = 'core-icp' | 'broad';
type VersionOutcome = 'accepted' | 'rejected';

interface VersionMetaEntry {
  outcome?: VersionOutcome;
}

interface VersionMetadataFile {
  rootOutputName: string;
  entries: Record<string, VersionMetaEntry>;
}

interface AuditEntry {
  type: string;
  rootOutputName: string;
  jobId: string;
}

interface AuditFile {
  rootOutputName: string;
  entries: AuditEntry[];
}

interface JobRecord {
  id: string;
  options?: {
    mode?: string;
    autoPromoteIfWinner?: boolean;
    autoPromoteSegment?: PromotionPolicySegment;
  };
}

interface SegmentMetrics {
  promotedAccepted: number;
  promotedRejected: number;
  promotedUnknownOutcome: number;
  promotedTotal: number;
  precision: number | null;
  eligibleAccepted: number;
  recall: number | null;
}

interface Report {
  generatedAt: string;
  totalRoots: number;
  totalOutcomes: number;
  minRecommendedOutcomes: number;
  hasSufficientOutcomes: boolean;
  audit: {
    attempts: number;
    promoted: number;
    skipped: number;
    failed: number;
  };
  global: SegmentMetrics;
  segments: Record<PromotionPolicySegment, SegmentMetrics>;
}

const cwd = path.resolve(__dirname, '../..');
const outDir = path.join(cwd, 'out');
const jobsDir = path.join(outDir, 'jobs');
const minRecommendedOutcomes = 20;

function safeReadJson(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function formatRatio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(3));
}

function inferSegment(job: JobRecord): PromotionPolicySegment {
  const raw = job.options?.autoPromoteSegment;
  return raw === 'broad' ? 'broad' : 'core-icp';
}

function initMetrics(): SegmentMetrics {
  return {
    promotedAccepted: 0,
    promotedRejected: 0,
    promotedUnknownOutcome: 0,
    promotedTotal: 0,
    precision: null,
    eligibleAccepted: 0,
    recall: null,
  };
}

function accumulateMetrics(
  promotedJobIds: Set<string>,
  jobsById: Map<string, JobRecord>,
  outcomesById: Map<string, VersionOutcome>,
  target: SegmentMetrics,
  bySegment: Record<PromotionPolicySegment, SegmentMetrics>,
) {
  for (const [jobId, outcome] of outcomesById.entries()) {
    const job = jobsById.get(jobId);
    if (!job?.options?.autoPromoteIfWinner) continue;
    if (job.options.mode !== 'rerender') continue;
    if (outcome !== 'accepted') continue;
    const segment = inferSegment(job);
    target.eligibleAccepted += 1;
    bySegment[segment].eligibleAccepted += 1;
  }

  for (const jobId of promotedJobIds) {
    const outcome = outcomesById.get(jobId) || null;
    const job = jobsById.get(jobId);
    const segment = inferSegment(job || {id: jobId, options: {}});
    target.promotedTotal += 1;
    bySegment[segment].promotedTotal += 1;
    if (outcome === 'accepted') {
      target.promotedAccepted += 1;
      bySegment[segment].promotedAccepted += 1;
    } else if (outcome === 'rejected') {
      target.promotedRejected += 1;
      bySegment[segment].promotedRejected += 1;
    } else {
      target.promotedUnknownOutcome += 1;
      bySegment[segment].promotedUnknownOutcome += 1;
    }
  }
}

function finalizeMetrics(metrics: SegmentMetrics): SegmentMetrics {
  const precisionDenominator = metrics.promotedAccepted + metrics.promotedRejected;
  metrics.precision = formatRatio(metrics.promotedAccepted, precisionDenominator);
  metrics.recall = formatRatio(metrics.promotedAccepted, metrics.eligibleAccepted);
  return metrics;
}

function main() {
  const files = fs.readdirSync(outDir);
  const metadataFiles = files.filter((name) => name.endsWith('-version-meta.json'));
  const jobFiles = fs.existsSync(jobsDir)
    ? fs.readdirSync(jobsDir).filter((name) => name.endsWith('.json'))
    : [];

  const jobsById = new Map<string, JobRecord>();
  for (const file of jobFiles) {
    const parsed = safeReadJson(path.join(jobsDir, file)) as JobRecord | null;
    if (!parsed?.id) continue;
    jobsById.set(parsed.id, parsed);
  }

  let totalOutcomes = 0;
  let attempts = 0;
  let promoted = 0;
  let skipped = 0;
  let failed = 0;

  const globalMetrics = initMetrics();
  const segmentMetrics: Record<PromotionPolicySegment, SegmentMetrics> = {
    'core-icp': initMetrics(),
    broad: initMetrics(),
  };

  for (const file of metadataFiles) {
    const metadata = safeReadJson(path.join(outDir, file)) as VersionMetadataFile | null;
    if (!metadata?.rootOutputName || !metadata.entries || typeof metadata.entries !== 'object') continue;
    const root = metadata.rootOutputName;
    const audit = safeReadJson(path.join(outDir, `${root}-audit.json`)) as AuditFile | null;
    if (!audit?.entries || !Array.isArray(audit.entries)) continue;

    const outcomesById = new Map<string, VersionOutcome>();
    for (const [jobId, entry] of Object.entries(metadata.entries)) {
      if (entry?.outcome === 'accepted' || entry?.outcome === 'rejected') {
        outcomesById.set(jobId, entry.outcome);
        totalOutcomes += 1;
      }
    }

    const promotedJobIds = new Set<string>();
    for (const entry of audit.entries) {
      if (entry.type === 'autopromote-promoted') {
        attempts += 1;
        promoted += 1;
        promotedJobIds.add(entry.jobId);
      } else if (entry.type === 'autopromote-skipped') {
        attempts += 1;
        skipped += 1;
      } else if (entry.type === 'autopromote-failed') {
        attempts += 1;
        failed += 1;
      }
    }

    accumulateMetrics(promotedJobIds, jobsById, outcomesById, globalMetrics, segmentMetrics);
  }

  const report: Report = {
    generatedAt: new Date().toISOString(),
    totalRoots: metadataFiles.length,
    totalOutcomes,
    minRecommendedOutcomes,
    hasSufficientOutcomes: totalOutcomes >= minRecommendedOutcomes,
    audit: {
      attempts,
      promoted,
      skipped,
      failed,
    },
    global: finalizeMetrics(globalMetrics),
    segments: {
      'core-icp': finalizeMetrics(segmentMetrics['core-icp']),
      broad: finalizeMetrics(segmentMetrics.broad),
    },
  };

  const stamp = report.generatedAt.replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const outPath = path.join(outDir, `eval-autopromote-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`Auto-promote evaluation written to ${outPath}`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.hasSufficientOutcomes) {
    console.log(
      `INSUFFICIENT_OUTCOMES: found ${report.totalOutcomes}, need at least ${report.minRecommendedOutcomes} for reliable threshold validation.`,
    );
  }
}

main();

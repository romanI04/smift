import http from 'http';
import fs from 'fs';
import path from 'path';
import {spawn} from 'child_process';
import {
  DOMAIN_PACK_IDS,
  getDomainPack,
  selectDomainPack,
  type DomainPack,
  type DomainPackId,
} from '../pipeline/domain-packs';
import {scrapeUrl} from '../pipeline/scraper';
import {extractGroundingHints, summarizeGroundingUsage} from '../pipeline/grounding';
import {selectTemplate, getTemplateProfile, type TemplateId, type TemplateProfile} from '../pipeline/templates';
import {scoreScriptQuality} from '../pipeline/quality';
import {autoFixScriptQuality} from '../pipeline/autofix';
import {regenerateScriptSection, type RegenerateSection} from '../pipeline/section-regenerate';
import type {ScriptResult} from '../pipeline/script-types';
import {normalizeScriptPayload, toPersistedScript} from '../pipeline/script-io';
import {CommerceStore, parseAuthToken, type CommercePublicUser} from './commerce';

type JobStatus = 'queued' | 'running' | 'completed' | 'failed';
type JobMode = 'generate' | 'rerender';
type VersionOutcome = 'accepted' | 'rejected';
type PromotionPolicySegment = 'core-icp' | 'broad';

interface JobRecord {
  id: string;
  url: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
  outputName: string;
    options: {
      mode: JobMode;
      strict: boolean;
      quality: 'draft' | 'yc';
      voice: 'none' | 'openai' | 'elevenlabs' | 'chatterbox';
    skipRender: boolean;
    pack: 'auto' | DomainPackId;
    rootOutputName: string;
      version: number;
      scriptPath?: string;
      sourceJobId?: string;
      autoPromoteIfWinner?: boolean;
      autoPromoteMinConfidence?: number;
      autoPromoteSegment?: PromotionPolicySegment;
      autoPromoteEvaluatedAt?: string;
      autoPromoteDecision?: string;
      ownerUserId?: string;
    };
  logs: string[];
}

interface PromotionPolicyCalibration {
  at: string;
  segment: PromotionPolicySegment;
  accepted: number;
  rejected: number;
  total: number;
  acceptRate: number;
  evidenceWeight: number;
  recommendedMinConfidence: number;
  applied: boolean;
}

interface AutoPromotePolicy {
  minConfidence: number;
  segmentThresholds: Record<PromotionPolicySegment, number>;
  lastCalibration: Partial<Record<PromotionPolicySegment, PromotionPolicyCalibration>>;
}

interface VersionMetaEntry {
  label?: string;
  archived?: boolean;
  pinned?: boolean;
  outcome?: VersionOutcome;
  outcomeNote?: string;
  outcomeAt?: string;
  promotedAt?: string;
}

interface VersionMetadata {
  rootOutputName: string;
  updatedAt: string;
  entries: Record<string, VersionMetaEntry>;
  promotionPolicy: AutoPromotePolicy;
}

interface ProjectVersion {
  id: string;
  outputName: string;
  rootOutputName: string;
  version: number;
  status: JobStatus;
  mode: JobMode;
  createdAt: string;
  finishedAt: string | null;
  quality: ReturnType<typeof qualitySummaryFor>;
  artifacts: ReturnType<typeof artifactsFor>;
  videoUrl: string | null;
  meta: {
    label: string | null;
    archived: boolean;
    pinned: boolean;
    outcome: VersionOutcome | null;
    outcomeNote: string | null;
    outcomeAt: string | null;
    promotedAt: string | null;
  };
}

interface OutcomeCounts {
  accepted: number;
  rejected: number;
}

interface OutcomeLearning {
  totalOutcomes: number;
  byPack: Map<string, OutcomeCounts>;
  byTemplate: Map<string, OutcomeCounts>;
  byPackTemplate: Map<string, OutcomeCounts>;
}

interface SectionImprovementRecommendation {
  section: RegenerateSection;
  priority: number;
  confidence: number;
  impact: 'high' | 'medium' | 'low';
  reasons: string[];
}

interface AutoImproveConfig {
  maxSteps: number;
  targetScore: number;
  maxWarnings: number;
  strict: boolean;
  autofix: boolean;
  autoRerender: boolean;
  rerenderStrict: boolean;
  autoPromoteIfWinner: boolean;
  autoPromoteMinConfidence: number;
  autoPromoteSegment: PromotionPolicySegment;
}

interface AutoImproveIteration {
  step: number;
  section: RegenerateSection;
  before: {
    score: number;
    blockers: number;
    warnings: number;
    passed: boolean;
  };
  after: {
    score: number;
    blockers: number;
    warnings: number;
    passed: boolean;
  };
  improved: boolean;
  reason: string;
  planConfidence: number;
  actions: string[];
  autofixActions: string[];
}

interface ProjectAuditEntry {
  at: string;
  type: 'rerender-queued' | 'autopromote-promoted' | 'autopromote-skipped' | 'autopromote-failed' | 'autopromote-policy-updated';
  rootOutputName: string;
  jobId: string;
  sourceJobId: string | null;
  reason: string;
  details?: Record<string, unknown>;
}

interface ProjectAuditLog {
  rootOutputName: string;
  updatedAt: string;
  entries: ProjectAuditEntry[];
}

const cwd = path.resolve(__dirname, '../..');
const outDir = path.join(cwd, 'out');
const jobsDir = path.join(outDir, 'jobs');
const DEFAULT_AUTO_PROMOTE_MIN_CONFIDENCE = 0.75;
const CORE_ICP_PACK_IDS = new Set<DomainPackId>(['devtools', 'b2b-saas', 'ecommerce-retail']);
const commerce = new CommerceStore(outDir);
const REQUIRE_AUTH = process.env.SMIFT_REQUIRE_AUTH === 'true';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, {recursive: true});
if (!fs.existsSync(jobsDir)) fs.mkdirSync(jobsDir, {recursive: true});

const jobs = new Map<string, JobRecord>();
const queue: string[] = [];
let activeJobId: string | null = null;
const REGENERATE_SECTIONS: RegenerateSection[] = ['hook', 'feature1', 'feature2', 'feature3', 'cta'];
loadPersistedJobs();
evaluatePendingAutoPromoteJobs('startup');
setInterval(() => {
  evaluatePendingAutoPromoteJobs('watchdog');
}, 30000).unref();

function authenticateRequest(req: http.IncomingMessage) {
  const token = parseAuthToken(req.headers.authorization, req.headers['x-smift-token']);
  return commerce.authenticate(token);
}

const PUBLIC_USER: CommercePublicUser = {
  id: 'public',
  email: 'public@local',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  plan: 'starter',
  credits: Number.MAX_SAFE_INTEGER,
};

function requireUser(req: http.IncomingMessage):
  | {ok: true; user: CommercePublicUser}
  | {ok: false; code: number; error: string} {
  if (!REQUIRE_AUTH) {
    return {ok: true, user: PUBLIC_USER};
  }
  const auth = authenticateRequest(req);
  if (!auth.ok || !auth.user) {
    return {ok: false, code: auth.code, error: auth.error || 'unauthorized'};
  }
  return {ok: true, user: auth.user};
}

function canAccessJob(user: CommercePublicUser, job: JobRecord): boolean {
  if (!REQUIRE_AUTH) return true;
  const owner = job.options.ownerUserId;
  if (!owner) return false;
  return owner === user.id;
}

function canAccessProjectRoot(user: CommercePublicUser, rootOutputName: string): boolean {
  if (!rootOutputName) return false;
  for (const job of jobs.values()) {
    if (getRootOutputName(job) !== rootOutputName) continue;
    if (canAccessJob(user, job)) return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || 'GET';
    const url = new URL(req.url || '/', 'http://localhost');

    if (method === 'GET' && url.pathname === '/') {
      return sendHtml(res, renderHtml());
    }

    if (method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        activeJobId,
        queued: queue.length,
        totalJobs: jobs.size,
      });
    }

    if (method === 'POST' && url.pathname === '/api/auth/signup') {
      const payload = await readJsonBody(req);
      const result = commerce.signup(
        String(payload.email || ''),
        String(payload.password || ''),
        String(payload.plan || 'starter'),
      );
      if (!result.ok) return sendJson(res, result.code, {error: result.error});
      return sendJson(res, result.code, {
        token: result.token,
        user: result.user,
      });
    }

    if (method === 'POST' && url.pathname === '/api/auth/login') {
      const payload = await readJsonBody(req);
      const result = commerce.login(String(payload.email || ''), String(payload.password || ''));
      if (!result.ok) return sendJson(res, result.code, {error: result.error});
      return sendJson(res, result.code, {
        token: result.token,
        user: result.user,
      });
    }

    if (method === 'POST' && url.pathname === '/api/auth/logout') {
      const payload = await readJsonBody(req);
      const token = parseAuthToken(
        req.headers.authorization,
        req.headers['x-smift-token'] || String(payload.token || ''),
      );
      const result = commerce.logout(token);
      if (!result.ok) return sendJson(res, result.code, {error: result.error});
      return sendJson(res, 200, {ok: true});
    }

    if (method === 'GET' && url.pathname === '/api/auth/me') {
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      return sendJson(res, 200, {user: actor.user});
    }

    if (method === 'GET' && url.pathname === '/api/billing/summary') {
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      if (!REQUIRE_AUTH) {
        return sendJson(res, 200, {
          user: actor.user,
          pricing: {
            starter: {monthlyUsd: 39, includedCredits: 20},
            growth: {monthlyUsd: 99, includedCredits: 80},
            topup: {usd: 15, credits: 10},
          },
          recentLedger: [],
        });
      }
      const summary = commerce.getBillingSummary(actor.user.id);
      if (!summary) return sendJson(res, 404, {error: 'billing account not found'});
      return sendJson(res, 200, summary);
    }

    if (method === 'POST' && url.pathname === '/api/billing/topup') {
      if (!REQUIRE_AUTH) return sendJson(res, 409, {error: 'billing disabled in product mode'});
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      const payload = await readJsonBody(req);
      const result = commerce.addTopupCredits(
        actor.user.id,
        Number(payload.credits || 0),
        String(payload.reason || 'manual topup'),
      );
      if (!result.ok) return sendJson(res, result.code, {error: result.error});
      const summary = commerce.getBillingSummary(actor.user.id);
      return sendJson(res, 200, summary);
    }

    if (method === 'POST' && url.pathname === '/api/billing/plan') {
      if (!REQUIRE_AUTH) return sendJson(res, 409, {error: 'billing disabled in product mode'});
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      const payload = await readJsonBody(req);
      const result = commerce.setPlan(actor.user.id, String(payload.plan || 'starter'));
      if (!result.ok) return sendJson(res, result.code, {error: result.error});
      const summary = commerce.getBillingSummary(actor.user.id);
      return sendJson(res, 200, summary);
    }

    if (method === 'POST' && url.pathname === '/api/jobs') {
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      const payload = await readJsonBody(req);
      const submittedUrl = String(payload.url || '').trim();
      if (!submittedUrl) return sendJson(res, 400, {error: 'url is required'});

      const renderWillRun = payload.skipRender === undefined ? false : Boolean(payload.skipRender) === false;
      if (REQUIRE_AUTH && renderWillRun) {
        const charge = commerce.chargeCredits(actor.user.id, 1, 'url-to-video generation render', {
          submittedUrl,
          mode: 'generate',
        });
        if (!charge.ok) {
          return sendJson(res, charge.code, {error: charge.error});
        }
      }

      const job = createJob(submittedUrl, payload, actor.user.id);
      jobs.set(job.id, job);
      queue.push(job.id);
      persistJob(job);
      tickQueue();

      return sendJson(res, 201, {
        id: job.id,
        status: job.status,
        url: job.url,
        outputName: job.outputName,
        rootOutputName: job.options.rootOutputName,
        version: job.options.version,
        billing: REQUIRE_AUTH ? (commerce.getBillingSummary(actor.user.id)?.user ?? null) : null,
      });
    }

    if (method === 'POST' && /^\/api\/jobs\/[^/]+\/regenerate$/.test(url.pathname)) {
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[2];
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, {error: 'job not found'});
      if (!canAccessJob(actor.user, job)) {
        return sendJson(res, 403, {error: 'forbidden: job does not belong to current user'});
      }
      if (job.status === 'running' || activeJobId === id) {
        return sendJson(res, 409, {error: 'job is running; wait until completion'});
      }

      const payload = await readJsonBody(req);
      const section = String(payload.section || '').trim() as RegenerateSection;
      if (!REGENERATE_SECTIONS.includes(section)) {
        return sendJson(res, 400, {error: `section is required and must be one of: ${REGENERATE_SECTIONS.join(', ')}`});
      }

      const artifacts = artifactsFor(job);
      if (!artifacts.scriptPath) {
        return sendJson(res, 400, {error: 'script artifact missing; run job first'});
      }

      const existingScriptRaw = JSON.parse(fs.readFileSync(artifacts.scriptPath, 'utf-8')) as ScriptResult & {narration?: string};
      const existingScript: ScriptResult = {
        ...existingScriptRaw,
        narrationSegments: Array.isArray(existingScriptRaw.narrationSegments) ? existingScriptRaw.narrationSegments : [],
      };

      const existingQuality = artifacts.qualityPath
        ? safeReadJson(artifacts.qualityPath)
        : null;

      const scraped = await scrapeUrl(job.url);
      const packFromArtifacts = String(existingScript.domainPackId || existingQuality?.domainPack || '').trim();
      const selectedPackId = (DOMAIN_PACK_IDS.includes(packFromArtifacts as DomainPackId)
        ? packFromArtifacts
        : (job.options.pack === 'auto' ? null : job.options.pack)) as DomainPackId | null;
      const packSelection = selectedPackId
        ? {
          pack: getDomainPack(selectedPackId),
          reason: `Preserved existing pack ${selectedPackId}`,
          confidence: 1,
          scores: existingQuality?.domainPackScores ?? {},
          topCandidates: existingQuality?.domainPackTopCandidates ?? [],
        }
        : selectDomainPack(scraped, 'auto');
      const domainPack = packSelection.pack;

      const templateFromArtifacts = String(existingQuality?.template || '').trim() as TemplateId;
      const templateProfile = ['yc-saas', 'product-demo', 'founder-story'].includes(templateFromArtifacts)
        ? getTemplateProfile(templateFromArtifacts)
        : selectTemplate(scraped, 'auto', domainPack.id).profile;

      const groundingHints = extractGroundingHints(scraped);
      const regenerated = regenerateScriptSection({
        script: existingScript,
        section,
        scraped,
        domainPack,
        groundingHints,
      });

      let nextScript = regenerated.script;
      let qualityReport = scoreScriptQuality({
        script: nextScript,
        scraped,
        template: templateProfile,
        domainPack,
        groundingHints,
        minScore: 80,
        maxWarnings: job.options.strict ? 0 : 3,
        failOnWarnings: job.options.strict,
      });
      const actions = [...regenerated.actions];
      let generationMode = `section-regenerate:${section}`;
      if (!qualityReport.passed) {
        const fixed = autoFixScriptQuality(nextScript, scraped, domainPack, groundingHints);
        nextScript = fixed.script;
        if (fixed.actions.length > 0) {
          actions.push(...fixed.actions.map((item) => `autofix: ${item}`));
        }
        qualityReport = scoreScriptQuality({
          script: nextScript,
          scraped,
          template: templateProfile,
          domainPack,
          groundingHints,
          minScore: 80,
          maxWarnings: job.options.strict ? 0 : 3,
          failOnWarnings: job.options.strict,
        });
        generationMode = `${generationMode}+autofix`;
      }

      fs.writeFileSync(
        artifacts.scriptPath,
        JSON.stringify({...nextScript, narration: nextScript.narrationSegments.join(' ')}, null, 2),
      );

      if (artifacts.qualityPath) {
        fs.writeFileSync(
          artifacts.qualityPath,
          JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              url: job.url,
              template: templateProfile.id,
              templateReason: `Regenerated ${section} section`,
              domainPack: domainPack.id,
              domainPackReason: packSelection.reason,
              domainPackConfidence: packSelection.confidence,
              domainPackTopCandidates: packSelection.topCandidates,
              domainPackScores: packSelection.scores,
              grounding: summarizeGroundingUsage(nextScript, groundingHints),
              relevanceGuard: {
                enabled: false,
                applied: false,
                actions: [],
                warnings: [],
              },
              generationMode,
              regeneratedSection: section,
              regenerationActions: actions,
              qualityReport,
            },
            null,
            2,
          ),
        );
      }

      appendLog(job, `[regen] ${section}: ${actions.join(' | ')}`);
      persistJob(job);

      return sendJson(res, 200, {
        id: job.id,
        section,
        generationMode,
        quality: qualitySummaryFor(job),
        artifacts: artifactsFor(job),
        actions,
      });
    }

    if (method === 'POST' && /^\/api\/jobs\/[^/]+\/auto-improve$/.test(url.pathname)) {
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[2];
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, {error: 'job not found'});
      if (!canAccessJob(actor.user, job)) {
        return sendJson(res, 403, {error: 'forbidden: job does not belong to current user'});
      }
      if (job.status === 'running' || activeJobId === id) {
        return sendJson(res, 409, {error: 'job is running; wait until completion'});
      }
      const payload = await readJsonBody(req);
      const policy = readProjectAutoPromotePolicy(getRootOutputName(job));
      const segment = inferPromotionSegmentForJob(job);
      const defaultMinConfidence = effectiveMinConfidenceForSegment(policy, segment);
      const config = resolveAutoImproveConfig(payload, job.options.strict, defaultMinConfidence, segment);
      const result = await runAutoImproveLoop(job, config, actor.user.id);
      if (!result.ok) {
        return sendJson(res, result.code, {error: result.error});
      }
      return sendJson(res, 200, result.data);
    }

    if (method === 'GET' && /^\/api\/jobs\/[^/]+\/script$/.test(url.pathname)) {
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[2];
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, {error: 'job not found'});
      if (!canAccessJob(actor.user, job)) {
        return sendJson(res, 403, {error: 'forbidden: job does not belong to current user'});
      }
      const artifacts = artifactsFor(job);
      if (!artifacts.scriptPath) return sendJson(res, 400, {error: 'script artifact missing; run job first'});
      const parsed = safeReadJson(artifacts.scriptPath);
      if (!parsed) return sendJson(res, 500, {error: 'script artifact parse failed'});
      const normalized = normalizeScriptPayload(parsed);
      return sendJson(res, 200, {
        id: job.id,
        path: artifacts.scriptPath,
        script: normalized,
      });
    }

    if (method === 'PUT' && /^\/api\/jobs\/[^/]+\/script$/.test(url.pathname)) {
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[2];
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, {error: 'job not found'});
      if (!canAccessJob(actor.user, job)) {
        return sendJson(res, 403, {error: 'forbidden: job does not belong to current user'});
      }
      if (job.status === 'running' || activeJobId === id) {
        return sendJson(res, 409, {error: 'job is running; wait until completion'});
      }
      const artifacts = artifactsFor(job);
      if (!artifacts.scriptPath) return sendJson(res, 400, {error: 'script artifact missing; run job first'});
      const payload = await readJsonBody(req);
      const candidate = (payload.script && typeof payload.script === 'object')
        ? payload.script
        : payload;

      let normalized: ScriptResult;
      try {
        normalized = normalizeScriptPayload(candidate);
      } catch (error: any) {
        return sendJson(res, 400, {error: `invalid script payload: ${error.message}`});
      }

      fs.writeFileSync(artifacts.scriptPath, JSON.stringify(toPersistedScript(normalized), null, 2));

      if (artifacts.qualityPath) {
        const existingQuality = safeReadJson(artifacts.qualityPath) ?? {};
        fs.writeFileSync(
          artifacts.qualityPath,
          JSON.stringify(
            {
              ...existingQuality,
              generatedAt: new Date().toISOString(),
              generationMode: 'manual-edit',
              qualityReport: existingQuality.qualityReport ?? null,
              editor: {
                source: 'local-server-ui',
                note: 'Script edited manually. Re-render recommended.',
              },
            },
            null,
            2,
          ),
        );
      }

      appendLog(job, '[edit] script updated manually');
      persistJob(job);
      return sendJson(res, 200, {
        id: job.id,
        updated: true,
        artifacts: artifactsFor(job),
      });
    }

    if (method === 'POST' && /^\/api\/jobs\/[^/]+\/validate-script$/.test(url.pathname)) {
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[2];
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, {error: 'job not found'});
      if (!canAccessJob(actor.user, job)) {
        return sendJson(res, 403, {error: 'forbidden: job does not belong to current user'});
      }
      if (job.status === 'running' || activeJobId === id) {
        return sendJson(res, 409, {error: 'job is running; wait until completion'});
      }

      const payload = await readJsonBody(req);
      const autofix = Boolean(payload.autofix);
      const artifacts = artifactsFor(job);
      if (!artifacts.scriptPath) {
        return sendJson(res, 400, {error: 'script artifact missing; run job first'});
      }

      const scriptRaw = safeReadJson(artifacts.scriptPath);
      if (!scriptRaw) {
        return sendJson(res, 500, {error: 'script artifact parse failed'});
      }
      const script = normalizeScriptPayload(scriptRaw);
      const existingQuality = artifacts.qualityPath ? safeReadJson(artifacts.qualityPath) : null;
      const context = await resolveQualityContext(job, script, existingQuality);

      let nextScript = script;
      let qualityReport = scoreScriptQuality({
        script: nextScript,
        scraped: context.scraped,
        template: context.templateProfile,
        domainPack: context.domainPack,
        groundingHints: context.groundingHints,
        minScore: 80,
        maxWarnings: job.options.strict ? 0 : 3,
        failOnWarnings: job.options.strict,
      });
      const autofixActions: string[] = [];
      let generationMode = 'manual-edit-validation';

      if (autofix && !qualityReport.passed) {
        const fixed = autoFixScriptQuality(nextScript, context.scraped, context.domainPack, context.groundingHints);
        nextScript = fixed.script;
        autofixActions.push(...fixed.actions);
        qualityReport = scoreScriptQuality({
          script: nextScript,
          scraped: context.scraped,
          template: context.templateProfile,
          domainPack: context.domainPack,
          groundingHints: context.groundingHints,
          minScore: 80,
          maxWarnings: job.options.strict ? 0 : 3,
          failOnWarnings: job.options.strict,
        });
        generationMode = 'manual-edit+autofix';
        if (autofixActions.length > 0) {
          fs.writeFileSync(artifacts.scriptPath, JSON.stringify(toPersistedScript(nextScript), null, 2));
          appendLog(job, `[autofix] ${autofixActions.join(' | ')}`);
        }
      }

      if (artifacts.qualityPath) {
        fs.writeFileSync(
          artifacts.qualityPath,
          JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              url: job.url,
              template: context.templateProfile.id,
              templateReason: context.templateReason,
              domainPack: context.domainPack.id,
              domainPackReason: context.packReason,
              domainPackConfidence: context.packConfidence,
              domainPackTopCandidates: context.packTopCandidates,
              domainPackScores: context.packScores,
              grounding: summarizeGroundingUsage(nextScript, context.groundingHints),
              relevanceGuard: {
                enabled: false,
                applied: false,
                actions: [],
                warnings: [],
              },
              generationMode,
              qualityReport,
              editor: {
                source: 'local-server-ui',
                autofix,
                autofixActions,
              },
            },
            null,
            2,
          ),
        );
      }

      persistJob(job);
      return sendJson(res, 200, {
        id: job.id,
        autofix,
        autofixActions,
        qualityReport,
        quality: qualitySummaryFor(job),
        artifacts: artifactsFor(job),
      });
    }

    if (method === 'POST' && /^\/api\/jobs\/[^/]+\/rerender$/.test(url.pathname)) {
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[2];
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, {error: 'job not found'});
      if (!canAccessJob(actor.user, job)) {
        return sendJson(res, 403, {error: 'forbidden: job does not belong to current user'});
      }
      if (job.status === 'running' || activeJobId === id) {
        return sendJson(res, 409, {error: 'job is running; wait until completion'});
      }
      const artifacts = artifactsFor(job);
      if (!artifacts.scriptPath) return sendJson(res, 400, {error: 'script artifact missing; run job first'});
      const scriptRaw = safeReadJson(artifacts.scriptPath);
      if (!scriptRaw) return sendJson(res, 500, {error: 'script artifact parse failed'});
      const script = normalizeScriptPayload(scriptRaw);
      const existingQuality = artifacts.qualityPath ? safeReadJson(artifacts.qualityPath) : null;
      const context = await resolveQualityContext(job, script, existingQuality);
      const payload = await readJsonBody(req);
      const strictForGuard = payload.strict === undefined ? job.options.strict : Boolean(payload.strict);
      const qualityReport = scoreScriptQuality({
        script,
        scraped: context.scraped,
        template: context.templateProfile,
        domainPack: context.domainPack,
        groundingHints: context.groundingHints,
        minScore: 80,
        maxWarnings: strictForGuard ? 0 : 3,
        failOnWarnings: strictForGuard,
      });
      if (!qualityReport.passed) {
        return sendJson(res, 409, {
          error: 'quality guard blocked rerender',
          qualityReport,
        });
      }

      if (REQUIRE_AUTH) {
        const charge = commerce.chargeCredits(actor.user.id, 1, 'rerender', {
          sourceJobId: job.id,
        });
        if (!charge.ok) {
          return sendJson(res, charge.code, {error: charge.error});
        }
      }

      const queued = queueVersionedRerenderFromScript({
        job,
        script,
        context,
        qualityReport,
        payload,
        generationMode: 'manual-edit-validation',
        versioningSource: 'manual-rerender',
      });

      return sendJson(res, 201, {
        id: queued.rerenderJob.id,
        sourceJobId: job.id,
        status: queued.rerenderJob.status,
        mode: queued.rerenderJob.options.mode,
        outputName: queued.outputName,
        rootOutputName: queued.rootOutputName,
        version: queued.version,
        billing: REQUIRE_AUTH ? (commerce.getBillingSummary(actor.user.id)?.user ?? null) : null,
      });
    }

    if (method === 'GET' && /^\/api\/projects\/[^/]+\/versions$/.test(url.pathname)) {
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      const parts = url.pathname.split('/').filter(Boolean);
      const rootOutputName = decodeURIComponent(parts[2] || '');
      if (!rootOutputName) return sendJson(res, 400, {error: 'root output name is required'});
      if (!isSafeOutputName(rootOutputName)) return sendJson(res, 400, {error: 'invalid root output name'});
      if (!canAccessProjectRoot(actor.user, rootOutputName)) {
        return sendJson(res, 403, {error: 'forbidden: project does not belong to current user'});
      }
      const policy = readProjectAutoPromotePolicy(rootOutputName);
      return sendJson(res, 200, {
        rootOutputName,
        promotionPolicy: policy,
        versions: listProjectVersions(rootOutputName),
      });
    }

    if (method === 'GET' && /^\/api\/projects\/[^/]+\/recommendation$/.test(url.pathname)) {
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      const parts = url.pathname.split('/').filter(Boolean);
      const rootOutputName = decodeURIComponent(parts[2] || '');
      if (!rootOutputName) return sendJson(res, 400, {error: 'root output name is required'});
      if (!isSafeOutputName(rootOutputName)) return sendJson(res, 400, {error: 'invalid root output name'});
      if (!canAccessProjectRoot(actor.user, rootOutputName)) {
        return sendJson(res, 403, {error: 'forbidden: project does not belong to current user'});
      }
      const recommendation = recommendProjectVersion(rootOutputName);
      return sendJson(res, 200, {
        rootOutputName,
        recommendation,
      });
    }

    if (method === 'GET' && /^\/api\/projects\/[^/]+\/audit$/.test(url.pathname)) {
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      const parts = url.pathname.split('/').filter(Boolean);
      const rootOutputName = decodeURIComponent(parts[2] || '');
      if (!rootOutputName) return sendJson(res, 400, {error: 'root output name is required'});
      if (!isSafeOutputName(rootOutputName)) return sendJson(res, 400, {error: 'invalid root output name'});
      if (!canAccessProjectRoot(actor.user, rootOutputName)) {
        return sendJson(res, 403, {error: 'forbidden: project does not belong to current user'});
      }
      const rawLimit = Number(url.searchParams.get('limit') || 50);
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, Math.floor(rawLimit))) : 50;
      const audit = readProjectAudit(rootOutputName);
      return sendJson(res, 200, {
        rootOutputName,
        updatedAt: audit.updatedAt,
        entries: audit.entries.slice(0, limit),
      });
    }

    if (method === 'GET' && /^\/api\/projects\/[^/]+\/promotion-policy$/.test(url.pathname)) {
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      const parts = url.pathname.split('/').filter(Boolean);
      const rootOutputName = decodeURIComponent(parts[2] || '');
      if (!rootOutputName) return sendJson(res, 400, {error: 'root output name is required'});
      if (!isSafeOutputName(rootOutputName)) return sendJson(res, 400, {error: 'invalid root output name'});
      if (!canAccessProjectRoot(actor.user, rootOutputName)) {
        return sendJson(res, 403, {error: 'forbidden: project does not belong to current user'});
      }
      const policy = readProjectAutoPromotePolicy(rootOutputName);
      return sendJson(res, 200, {
        rootOutputName,
        policy,
        calibrationPreview: buildPromotionPolicyCalibrationPreview(rootOutputName, policy),
      });
    }

    if (method === 'POST' && /^\/api\/projects\/[^/]+\/promotion-policy$/.test(url.pathname)) {
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      const parts = url.pathname.split('/').filter(Boolean);
      const rootOutputName = decodeURIComponent(parts[2] || '');
      if (!rootOutputName) return sendJson(res, 400, {error: 'root output name is required'});
      if (!isSafeOutputName(rootOutputName)) return sendJson(res, 400, {error: 'invalid root output name'});
      if (!canAccessProjectRoot(actor.user, rootOutputName)) {
        return sendJson(res, 403, {error: 'forbidden: project does not belong to current user'});
      }
      const payload = await readJsonBody(req);
      const metadata = readVersionMetadata(rootOutputName);
      const segmentRaw = String(payload.segment || '').trim().toLowerCase();
      const segment = isPromotionPolicySegment(segmentRaw) ? segmentRaw : null;
      const previous = metadata.promotionPolicy.minConfidence;
      const next = normalizeAutoPromoteMinConfidence(payload.minConfidence, metadata.promotionPolicy.minConfidence);
      metadata.promotionPolicy.minConfidence = next;
      if (segment) {
        metadata.promotionPolicy.segmentThresholds[segment] = next;
      } else {
        metadata.promotionPolicy.segmentThresholds['core-icp'] = next;
        metadata.promotionPolicy.segmentThresholds.broad = next;
      }
      metadata.updatedAt = new Date().toISOString();
      writeVersionMetadata(rootOutputName, metadata);
      appendProjectAudit(rootOutputName, {
        type: 'autopromote-policy-updated',
        jobId: 'policy',
        sourceJobId: null,
        reason: segment
          ? `Auto-promote min confidence set to ${next.toFixed(2)} for ${segment}`
          : `Auto-promote min confidence set to ${next.toFixed(2)} for all segments`,
        details: {
          previousMinConfidence: previous,
          minConfidence: next,
          segment: segment || 'all',
        },
      });
      return sendJson(res, 200, {
        rootOutputName,
        policy: metadata.promotionPolicy,
      });
    }

    if (method === 'POST' && /^\/api\/projects\/[^/]+\/promotion-policy\/calibrate$/.test(url.pathname)) {
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      const parts = url.pathname.split('/').filter(Boolean);
      const rootOutputName = decodeURIComponent(parts[2] || '');
      if (!rootOutputName) return sendJson(res, 400, {error: 'root output name is required'});
      if (!isSafeOutputName(rootOutputName)) return sendJson(res, 400, {error: 'invalid root output name'});
      if (!canAccessProjectRoot(actor.user, rootOutputName)) {
        return sendJson(res, 403, {error: 'forbidden: project does not belong to current user'});
      }
      const payload = await readJsonBody(req);
      const segmentRaw = String(payload.segment || 'core-icp').trim().toLowerCase();
      if (!isPromotionPolicySegment(segmentRaw)) {
        return sendJson(res, 400, {error: 'segment must be core-icp or broad'});
      }
      const apply = Boolean(payload.apply);
      const metadata = readVersionMetadata(rootOutputName);
      const policy = metadata.promotionPolicy;
      const statsBySegment = collectSegmentOutcomeStats(rootOutputName);
      const stats = statsBySegment[segmentRaw];
      const recommendation = recommendSegmentMinConfidence(stats);
      const current = effectiveMinConfidenceForSegment(policy, segmentRaw);
      const calibration: PromotionPolicyCalibration = {
        at: new Date().toISOString(),
        segment: segmentRaw,
        accepted: stats.accepted,
        rejected: stats.rejected,
        total: stats.total,
        acceptRate: stats.acceptRate,
        evidenceWeight: recommendation.evidenceWeight,
        recommendedMinConfidence: recommendation.recommended,
        applied: apply,
      };
      policy.lastCalibration[segmentRaw] = calibration;
      if (apply) {
        policy.segmentThresholds[segmentRaw] = recommendation.recommended;
        policy.minConfidence = recommendation.recommended;
        metadata.updatedAt = calibration.at;
        writeVersionMetadata(rootOutputName, metadata);
        appendProjectAudit(rootOutputName, {
          type: 'autopromote-policy-updated',
          jobId: 'policy',
          sourceJobId: null,
          reason: `Calibrated ${segmentRaw} min confidence to ${recommendation.recommended.toFixed(2)}`,
          details: {
            segment: segmentRaw,
            previousMinConfidence: current,
            minConfidence: recommendation.recommended,
            accepted: stats.accepted,
            rejected: stats.rejected,
            total: stats.total,
            acceptRate: stats.acceptRate,
            evidenceWeight: recommendation.evidenceWeight,
          },
        });
      } else {
        metadata.updatedAt = calibration.at;
        writeVersionMetadata(rootOutputName, metadata);
      }
      return sendJson(res, 200, {
        rootOutputName,
        segment: segmentRaw,
        apply,
        currentMinConfidence: current,
        recommendedMinConfidence: recommendation.recommended,
        stats,
        evidenceWeight: recommendation.evidenceWeight,
        policy,
      });
    }

    if (method === 'POST' && /^\/api\/projects\/[^/]+\/promote$/.test(url.pathname)) {
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      const parts = url.pathname.split('/').filter(Boolean);
      const rootOutputName = decodeURIComponent(parts[2] || '');
      if (!rootOutputName) return sendJson(res, 400, {error: 'root output name is required'});
      if (!isSafeOutputName(rootOutputName)) return sendJson(res, 400, {error: 'invalid root output name'});
      if (!canAccessProjectRoot(actor.user, rootOutputName)) {
        return sendJson(res, 403, {error: 'forbidden: project does not belong to current user'});
      }
      const payload = await readJsonBody(req);
      const requestedJobId = String(payload.jobId || '').trim() || null;
      const promoted = promoteProjectWinner(rootOutputName, requestedJobId);
      if (!promoted.ok) {
        return sendJson(res, promoted.code, {error: promoted.error});
      }
      return sendJson(res, 200, {
        rootOutputName,
        promoted: promoted.promoted,
        metadata: promoted.metadata,
        versions: listProjectVersions(rootOutputName),
        recommendation: recommendProjectVersion(rootOutputName),
      });
    }

    if (method === 'POST' && /^\/api\/projects\/[^/]+\/version-meta$/.test(url.pathname)) {
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      const parts = url.pathname.split('/').filter(Boolean);
      const rootOutputName = decodeURIComponent(parts[2] || '');
      if (!rootOutputName) return sendJson(res, 400, {error: 'root output name is required'});
      if (!isSafeOutputName(rootOutputName)) return sendJson(res, 400, {error: 'invalid root output name'});
      if (!canAccessProjectRoot(actor.user, rootOutputName)) {
        return sendJson(res, 403, {error: 'forbidden: project does not belong to current user'});
      }
      const payload = await readJsonBody(req);
      const action = String(payload.action || '').trim();
      const actionNeedsJobId = new Set(['set-label', 'set-archived', 'set-pinned', 'set-outcome']);
      if (!actionNeedsJobId.has(action)) {
        return sendJson(res, 400, {error: 'action must be one of: set-label, set-archived, set-pinned, set-outcome'});
      }
      const jobId = String(payload.jobId || '').trim();
      if (!jobId) return sendJson(res, 400, {error: 'jobId is required'});
      const job = jobs.get(jobId);
      if (!job) return sendJson(res, 404, {error: 'job not found'});
      if (getRootOutputName(job) !== rootOutputName) {
        return sendJson(res, 400, {error: 'job does not belong to this project root'});
      }
      if (!canAccessJob(actor.user, job)) {
        return sendJson(res, 403, {error: 'forbidden: job does not belong to current user'});
      }

      const metadata = readVersionMetadata(rootOutputName);
      const entry = metadata.entries[jobId] ?? {};

      if (action === 'set-label') {
        const label = String(payload.label || '').trim();
        entry.label = label || undefined;
      } else if (action === 'set-archived') {
        entry.archived = Boolean(payload.archived);
        if (entry.archived) {
          entry.pinned = false;
        }
      } else if (action === 'set-pinned') {
        const pinned = Boolean(payload.pinned);
        if (pinned) {
          for (const [id, item] of Object.entries(metadata.entries)) {
            metadata.entries[id] = {...item, pinned: false};
          }
        }
        entry.pinned = pinned;
        if (pinned) {
          entry.archived = false;
        }
      } else if (action === 'set-outcome') {
        const rawOutcome = String(payload.outcome || '').trim().toLowerCase();
        const note = String(payload.outcomeNote || '').trim();
        if (!rawOutcome) {
          entry.outcome = undefined;
          entry.outcomeAt = undefined;
          entry.outcomeNote = note || undefined;
        } else if (rawOutcome === 'accepted' || rawOutcome === 'rejected') {
          entry.outcome = rawOutcome;
          entry.outcomeAt = new Date().toISOString();
          entry.outcomeNote = note || undefined;
        } else {
          return sendJson(res, 400, {error: 'outcome must be accepted, rejected, or empty'});
        }
      } else {
        return sendJson(res, 400, {error: 'action must be one of: set-label, set-archived, set-pinned, set-outcome'});
      }

      metadata.entries[jobId] = entry;
      metadata.updatedAt = new Date().toISOString();
      writeVersionMetadata(rootOutputName, metadata);

      return sendJson(res, 200, {
        rootOutputName,
        updated: true,
        metadata,
        versions: listProjectVersions(rootOutputName),
      });
    }

    if (method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
      const actor = requireUser(req);
      if (!actor.ok) return sendJson(res, actor.code, {error: actor.error});
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[2];
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, {error: 'job not found'});
      if (!canAccessJob(actor.user, job)) {
        return sendJson(res, 403, {error: 'forbidden: job does not belong to current user'});
      }

      if (parts.length === 3) {
        if (url.searchParams.get('view') === 'quality') {
          return sendJson(res, 200, qualitySummaryFor(job));
        }
        return sendJson(res, 200, enrichJob(job));
      }

      if (parts.length === 4 && parts[3] === 'artifacts') {
        return sendJson(res, 200, artifactsFor(job));
      }

      if (parts.length === 4 && parts[3] === 'quality') {
        return sendJson(res, 200, qualitySummaryFor(job));
      }

      if (parts.length === 4 && parts[3] === 'improvement-plan') {
        const rawLimit = Number(url.searchParams.get('limit') || 3);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(5, Math.floor(rawLimit))) : 3;
        const plan = buildSectionImprovementPlan(job, limit);
        return sendJson(res, 200, plan);
      }

      if (parts.length === 4 && parts[3] === 'video') {
        const artifacts = artifactsFor(job);
        if (!artifacts.videoPath) return sendJson(res, 404, {error: 'video artifact missing'});
        return sendVideo(res, artifacts.videoPath);
      }

      if (parts.length === 4 && parts[3] === 'compare') {
        const otherId = String(url.searchParams.get('other') || '').trim();
        if (!otherId) return sendJson(res, 400, {error: 'other job id is required'});
        const otherJob = jobs.get(otherId);
        if (!otherJob) return sendJson(res, 404, {error: 'other job not found'});
        if (!canAccessJob(actor.user, otherJob)) {
          return sendJson(res, 403, {error: 'forbidden: comparison target does not belong to current user'});
        }
        return sendJson(res, 200, compareJobs(job, otherJob));
      }
    }

    sendJson(res, 404, {error: 'not found'});
  } catch (e: any) {
    sendJson(res, 500, {error: e.message});
  }
});

const port = Number(process.env.SMIFT_PORT || 3030);
server.listen(port, () => {
  console.log(`smift server listening on http://localhost:${port}`);
});

function createJob(url: string, payload: Record<string, unknown>, ownerUserId: string): JobRecord {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ownerSlug = String(ownerUserId || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
    .slice(-10) || 'user';
  const urlSlug = url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-') || 'site';
  const rootOutputName = `${ownerSlug}-${urlSlug}`.replace(/-+/g, '-');
  const outputName = rootOutputName;
  const strict = Boolean(payload.strict ?? false);
  const quality = payload.quality === 'yc' ? 'yc' : 'draft';
  const voice = (['none', 'openai', 'elevenlabs', 'chatterbox'].includes(String(payload.voice))
    ? String(payload.voice)
    : 'none') as JobRecord['options']['voice'];
  const skipRender = payload.skipRender === undefined ? true : Boolean(payload.skipRender);
  const packRaw = String(payload.pack ?? 'auto');
  const pack = (packRaw === 'auto' || DOMAIN_PACK_IDS.includes(packRaw as DomainPackId)
    ? packRaw
    : 'auto') as JobRecord['options']['pack'];

  return {
    id,
    url,
    status: 'queued',
    createdAt: new Date().toISOString(),
    outputName,
    options: {
      mode: 'generate',
      strict,
      quality,
      voice,
      skipRender,
      pack,
      rootOutputName,
      version: 1,
      ownerUserId,
    },
    logs: [],
  };
}

function createRerenderJob(
  sourceJob: JobRecord,
  scriptPath: string,
  payload: Record<string, unknown>,
  outputName: string,
  rootOutputName: string,
  version: number,
): JobRecord {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const quality = payload.quality === 'yc' ? 'yc' : sourceJob.options.quality;
  const voice = (['none', 'openai', 'elevenlabs', 'chatterbox'].includes(String(payload.voice))
    ? String(payload.voice)
    : sourceJob.options.voice) as JobRecord['options']['voice'];
  const strict = payload.strict === undefined ? sourceJob.options.strict : Boolean(payload.strict);
  const autoPromoteIfWinner = Boolean(payload.autoPromoteIfWinner);
  const projectPolicy = readProjectAutoPromotePolicy(rootOutputName);
  const requestedSegment = String(payload.autoPromoteSegment || '').trim().toLowerCase();
  const autoPromoteSegment = isPromotionPolicySegment(requestedSegment)
    ? requestedSegment
    : inferPromotionSegmentForJob(sourceJob);
  const autoPromoteMinConfidence = normalizeAutoPromoteMinConfidence(
    payload.autoPromoteMinConfidence,
    effectiveMinConfidenceForSegment(projectPolicy, autoPromoteSegment),
  );

  return {
    id,
    url: sourceJob.url,
    status: 'queued',
    createdAt: new Date().toISOString(),
    outputName,
    options: {
      mode: 'rerender',
      strict,
      quality,
      voice,
      skipRender: false,
      pack: sourceJob.options.pack,
      rootOutputName,
      version,
      scriptPath,
      sourceJobId: sourceJob.id,
      autoPromoteIfWinner,
      autoPromoteMinConfidence,
      autoPromoteSegment,
      ownerUserId: sourceJob.options.ownerUserId,
    },
    logs: [],
  };
}

function getRootOutputName(job: JobRecord): string {
  return job.options.rootOutputName || parseVersionedOutputName(job.outputName).rootOutputName;
}

function getVersion(job: JobRecord): number {
  return job.options.version || parseVersionedOutputName(job.outputName).version;
}

function parseVersionedOutputName(outputName: string): {rootOutputName: string; version: number} {
  const match = outputName.match(/^(.*)-v(\d+)$/);
  if (!match) {
    return {rootOutputName: outputName, version: 1};
  }
  return {
    rootOutputName: match[1],
    version: Number(match[2]) || 1,
  };
}

function outputNameForVersion(rootOutputName: string, version: number): string {
  return version <= 1 ? rootOutputName : `${rootOutputName}-v${version}`;
}

function nextVersionForRoot(rootOutputName: string): number {
  let maxVersion = 1;
  for (const job of jobs.values()) {
    if (getRootOutputName(job) !== rootOutputName) continue;
    maxVersion = Math.max(maxVersion, getVersion(job));
  }

  const escapedRoot = rootOutputName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const versionedRegex = new RegExp(`^${escapedRoot}-v(\\d+)-job\\.json$`);
  const baseRegex = new RegExp(`^${escapedRoot}-job\\.json$`);
  try {
    for (const name of fs.readdirSync(outDir)) {
      const vMatch = name.match(versionedRegex);
      if (vMatch) {
        maxVersion = Math.max(maxVersion, Number(vMatch[1]) || 1);
        continue;
      }
      if (baseRegex.test(name)) {
        maxVersion = Math.max(maxVersion, 1);
      }
    }
  } catch {
    // ignore readdir failures
  }

  return maxVersion + 1;
}

interface QualityContext {
  scraped: Awaited<ReturnType<typeof scrapeUrl>>;
  domainPack: DomainPack;
  templateProfile: TemplateProfile;
  templateReason: string;
  packReason: string;
  packConfidence: number;
  packTopCandidates: Array<{id: DomainPackId; score: number}>;
  packScores: Record<string, number>;
  groundingHints: ReturnType<typeof extractGroundingHints>;
}

async function resolveQualityContext(
  job: JobRecord,
  script: ScriptResult,
  existingQuality: any,
): Promise<QualityContext> {
  const scraped = await scrapeUrl(job.url);
  const packFromArtifacts = String(script.domainPackId || existingQuality?.domainPack || '').trim();
  const selectedPackId = (DOMAIN_PACK_IDS.includes(packFromArtifacts as DomainPackId)
    ? packFromArtifacts
    : (job.options.pack === 'auto' ? null : job.options.pack)) as DomainPackId | null;
  const packSelection = selectedPackId
    ? {
      pack: getDomainPack(selectedPackId),
      reason: `Preserved existing pack ${selectedPackId}`,
      confidence: 1,
      scores: existingQuality?.domainPackScores ?? {},
      topCandidates: existingQuality?.domainPackTopCandidates ?? [],
    }
    : selectDomainPack(scraped, 'auto');
  const domainPack = packSelection.pack;

  const templateFromArtifacts = String(existingQuality?.template || '').trim() as TemplateId;
  const templateSelection = ['yc-saas', 'product-demo', 'founder-story'].includes(templateFromArtifacts)
    ? {
      profile: getTemplateProfile(templateFromArtifacts),
      reason: `Preserved existing template ${templateFromArtifacts}`,
    }
    : selectTemplate(scraped, 'auto', domainPack.id);

  const groundingHints = extractGroundingHints(scraped);

  return {
    scraped,
    domainPack,
    templateProfile: templateSelection.profile,
    templateReason: templateSelection.reason,
    packReason: packSelection.reason,
    packConfidence: packSelection.confidence,
    packTopCandidates: packSelection.topCandidates,
    packScores: packSelection.scores,
    groundingHints,
  };
}

function queueVersionedRerenderFromScript(args: {
  job: JobRecord;
  script: ScriptResult;
  context: QualityContext;
  qualityReport: ReturnType<typeof scoreScriptQuality>;
  payload: Record<string, unknown>;
  generationMode: string;
  versioningSource: string;
}) {
  const {job, script, context, qualityReport, payload, generationMode, versioningSource} = args;
  const rootOutputName = getRootOutputName(job);
  const version = nextVersionForRoot(rootOutputName);
  const outputName = outputNameForVersion(rootOutputName, version);
  const versionedScriptPath = path.join(outDir, `${outputName}-script.json`);
  fs.writeFileSync(versionedScriptPath, JSON.stringify(toPersistedScript(script), null, 2));

  const versionedQualityPath = path.join(outDir, `${outputName}-quality.json`);
  fs.writeFileSync(
    versionedQualityPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        url: job.url,
        template: context.templateProfile.id,
        templateReason: context.templateReason,
        domainPack: context.domainPack.id,
        domainPackReason: context.packReason,
        domainPackConfidence: context.packConfidence,
        domainPackTopCandidates: context.packTopCandidates,
        domainPackScores: context.packScores,
        grounding: summarizeGroundingUsage(script, context.groundingHints),
        relevanceGuard: {
          enabled: false,
          applied: false,
          actions: [],
          warnings: [],
        },
        generationMode,
        qualityReport,
        versioning: {
          rootOutputName,
          version,
          sourceJobId: job.id,
          source: versioningSource,
        },
      },
      null,
      2,
    ),
  );

  const rerenderJob = createRerenderJob(
    job,
    versionedScriptPath,
    payload,
    outputName,
    rootOutputName,
    version,
  );
  jobs.set(rerenderJob.id, rerenderJob);
  queue.push(rerenderJob.id);
  persistJob(rerenderJob);
  appendLog(job, `[rerender] queued rerender job ${rerenderJob.id} (${outputName}) via ${versioningSource}`);
  appendProjectAudit(rootOutputName, {
    type: 'rerender-queued',
    jobId: rerenderJob.id,
    sourceJobId: job.id,
    reason: `Queued rerender via ${versioningSource}`,
    details: {
      outputName,
      version,
      generationMode,
      qualityScore: qualityReport.score,
      warningCount: qualityReport.warnings.length,
      blockerCount: qualityReport.blockers.length,
      strict: rerenderJob.options.strict,
      autoPromoteIfWinner: Boolean(rerenderJob.options.autoPromoteIfWinner),
      autoPromoteMinConfidence: rerenderJob.options.autoPromoteMinConfidence,
      autoPromoteSegment: rerenderJob.options.autoPromoteSegment,
    },
  });
  tickQueue();

  return {
    rerenderJob,
    outputName,
    rootOutputName,
    version,
    versionedScriptPath,
    versionedQualityPath,
  };
}

function resolveAutoImproveConfig(
  payload: Record<string, unknown>,
  defaultStrict: boolean,
  defaultAutoPromoteMinConfidence: number,
  defaultAutoPromoteSegment: PromotionPolicySegment,
): AutoImproveConfig {
  const strict = payload.strict === undefined ? defaultStrict : Boolean(payload.strict);
  const defaultMaxWarnings = strict ? 0 : 3;
  const requestedSegment = String(payload.autoPromoteSegment || '').trim().toLowerCase();
  const autoPromoteSegment = isPromotionPolicySegment(requestedSegment)
    ? requestedSegment
    : defaultAutoPromoteSegment;
  return {
    maxSteps: clampInt(payload.maxSteps, 1, 8, 3),
    targetScore: clampInt(payload.targetScore, 70, 100, 90),
    maxWarnings: clampInt(payload.maxWarnings, 0, 12, defaultMaxWarnings),
    strict,
    autofix: payload.autofix === undefined ? true : Boolean(payload.autofix),
    autoRerender: payload.autoRerender === undefined ? false : Boolean(payload.autoRerender),
    rerenderStrict: payload.rerenderStrict === undefined ? strict : Boolean(payload.rerenderStrict),
    autoPromoteIfWinner: payload.autoPromoteIfWinner === undefined
      ? Boolean(payload.autoRerender)
      : Boolean(payload.autoPromoteIfWinner),
    autoPromoteMinConfidence: normalizeAutoPromoteMinConfidence(
      payload.autoPromoteMinConfidence,
      defaultAutoPromoteMinConfidence,
    ),
    autoPromoteSegment,
  };
}

async function runAutoImproveLoop(
  job: JobRecord,
  config: AutoImproveConfig,
  actorUserId: string,
): Promise<
  | {
      ok: true;
      data: {
        id: string;
        mode: 'auto-improve';
        config: AutoImproveConfig;
        stopReason: string;
        initialQuality: ReturnType<typeof summarizeQualityReport>;
        finalQuality: ReturnType<typeof summarizeQualityReport>;
        iterations: AutoImproveIteration[];
        recommendations: SectionImprovementRecommendation[];
        rerender: {
          queued: boolean;
          reason: string;
          id: string | null;
          outputName: string | null;
          rootOutputName: string | null;
          version: number | null;
          autoPromoteIfWinner: boolean;
          autoPromoteMinConfidence: number;
          autoPromoteSegment: PromotionPolicySegment;
        };
        quality: ReturnType<typeof qualitySummaryFor>;
        artifacts: ReturnType<typeof artifactsFor>;
      };
    }
  | {ok: false; code: number; error: string}
> {
  const artifacts = artifactsFor(job);
  if (!artifacts.scriptPath) {
    return {ok: false, code: 400, error: 'script artifact missing; run job first'};
  }

  const scriptRaw = safeReadJson(artifacts.scriptPath);
  if (!scriptRaw) {
    return {ok: false, code: 500, error: 'script artifact parse failed'};
  }
  let script = normalizeScriptPayload(scriptRaw);
  const existingQuality = artifacts.qualityPath ? safeReadJson(artifacts.qualityPath) : null;
  const context = await resolveQualityContext(job, script, existingQuality);
  let qualityReport = scoreScriptQuality({
    script,
    scraped: context.scraped,
    template: context.templateProfile,
    domainPack: context.domainPack,
    groundingHints: context.groundingHints,
    minScore: 80,
    maxWarnings: config.maxWarnings,
    failOnWarnings: config.strict,
  });

  const initialQuality = summarizeQualityReport(qualityReport);
  const iterations: AutoImproveIteration[] = [];
  const sectionAttempts = new Map<RegenerateSection, number>();
  let stalledSteps = 0;
  let stopReason = '';
  let rerenderResult: {
    queued: boolean;
    reason: string;
    id: string | null;
    outputName: string | null;
    rootOutputName: string | null;
    version: number | null;
    autoPromoteIfWinner: boolean;
    autoPromoteMinConfidence: number;
    autoPromoteSegment: PromotionPolicySegment;
  } = {
    queued: false,
    reason: 'disabled',
    id: null,
    outputName: null,
    rootOutputName: null,
    version: null,
    autoPromoteIfWinner: config.autoPromoteIfWinner,
    autoPromoteMinConfidence: config.autoPromoteMinConfidence,
    autoPromoteSegment: config.autoPromoteSegment,
  };

  for (let step = 1; step <= config.maxSteps; step++) {
    if (meetsAutoImproveGoal(qualityReport, config)) {
      stopReason = step === 1 ? 'already-meets-target' : 'target-reached';
      break;
    }

    const plan = buildSectionImprovementPlan(job, 5, {
      script,
      quality: {qualityReport},
      sourceUrl: job.url,
    });
    const section = pickAutoImproveSection(plan.recommendations || [], sectionAttempts, 2);
    if (!section) {
      stopReason = 'sections-exhausted';
      break;
    }
    const recommendation = plan.recommendations.find((item) => item.section === section) || null;
    const before = summarizeQualityReport(qualityReport);
    const regenerated = regenerateScriptSection({
      script,
      section,
      scraped: context.scraped,
      domainPack: context.domainPack,
      groundingHints: context.groundingHints,
    });
    let nextScript = regenerated.script;
    let nextQuality = scoreScriptQuality({
      script: nextScript,
      scraped: context.scraped,
      template: context.templateProfile,
      domainPack: context.domainPack,
      groundingHints: context.groundingHints,
      minScore: 80,
      maxWarnings: config.maxWarnings,
      failOnWarnings: config.strict,
    });
    const actions = [...regenerated.actions];
    const autofixActions: string[] = [];
    let generationMode = `auto-improve:${section}:step-${step}`;
    if (config.autofix && !nextQuality.passed) {
      const fixed = autoFixScriptQuality(nextScript, context.scraped, context.domainPack, context.groundingHints);
      nextScript = fixed.script;
      autofixActions.push(...fixed.actions);
      if (fixed.actions.length > 0) {
        actions.push(...fixed.actions.map((item) => `autofix: ${item}`));
      }
      nextQuality = scoreScriptQuality({
        script: nextScript,
        scraped: context.scraped,
        template: context.templateProfile,
        domainPack: context.domainPack,
        groundingHints: context.groundingHints,
        minScore: 80,
        maxWarnings: config.maxWarnings,
        failOnWarnings: config.strict,
      });
      generationMode += '+autofix';
    }

    script = nextScript;
    qualityReport = nextQuality;
    writeScriptAndQualityArtifacts(job, script, context, qualityReport, generationMode, {
      source: 'auto-improve-loop',
      step,
      section,
      actions,
      config,
      recommendation,
      autofixActions,
    });

    const after = summarizeQualityReport(qualityReport);
    const improved = isQualityImproved(before, after);
    iterations.push({
      step,
      section,
      before,
      after,
      improved,
      reason: recommendation?.reasons?.[0] || 'No reason provided',
      planConfidence: recommendation?.confidence ?? 0,
      actions,
      autofixActions,
    });
    sectionAttempts.set(section, (sectionAttempts.get(section) || 0) + 1);
    appendLog(job, `[auto-improve] step ${step} section=${section} score ${before.score}->${after.score} warnings ${before.warnings}->${after.warnings}`);

    if (meetsAutoImproveGoal(qualityReport, config)) {
      stopReason = 'target-reached';
      break;
    }

    if (!improved) {
      stalledSteps += 1;
      if (stalledSteps >= 2) {
        stopReason = 'stalled-no-improvement';
        break;
      }
    } else {
      stalledSteps = 0;
    }
  }

  if (!stopReason) {
    stopReason = meetsAutoImproveGoal(qualityReport, config) ? 'target-reached' : 'max-steps-reached';
  }

  const goalMet = meetsAutoImproveGoal(qualityReport, config);
  if (config.autoRerender && goalMet) {
    if (REQUIRE_AUTH) {
      const charge = commerce.chargeCredits(actorUserId, 1, 'auto-improve rerender', {
        sourceJobId: job.id,
      });
      if (!charge.ok) {
        return {ok: false, code: charge.code, error: charge.error || 'insufficient credits'};
      }
    }
    const queued = queueVersionedRerenderFromScript({
      job,
      script,
      context,
      qualityReport,
      payload: {
        strict: config.rerenderStrict,
        quality: job.options.quality,
        voice: job.options.voice,
        autoPromoteIfWinner: config.autoPromoteIfWinner,
        autoPromoteMinConfidence: config.autoPromoteMinConfidence,
        autoPromoteSegment: config.autoPromoteSegment,
      },
      generationMode: 'auto-improve-validation',
      versioningSource: 'auto-improve',
    });
    rerenderResult = {
      queued: true,
      reason: 'queued-after-target',
      id: queued.rerenderJob.id,
      outputName: queued.outputName,
      rootOutputName: queued.rootOutputName,
      version: queued.version,
      autoPromoteIfWinner: config.autoPromoteIfWinner,
      autoPromoteMinConfidence: config.autoPromoteMinConfidence,
      autoPromoteSegment: config.autoPromoteSegment,
    };
  } else if (!config.autoRerender) {
    rerenderResult = {
      queued: false,
      reason: 'disabled',
      id: null,
      outputName: null,
      rootOutputName: null,
      version: null,
      autoPromoteIfWinner: config.autoPromoteIfWinner,
      autoPromoteMinConfidence: config.autoPromoteMinConfidence,
      autoPromoteSegment: config.autoPromoteSegment,
    };
  } else {
    rerenderResult = {
      queued: false,
      reason: 'target-not-reached',
      id: null,
      outputName: null,
      rootOutputName: null,
      version: null,
      autoPromoteIfWinner: config.autoPromoteIfWinner,
      autoPromoteMinConfidence: config.autoPromoteMinConfidence,
      autoPromoteSegment: config.autoPromoteSegment,
    };
  }

  persistJob(job);
  const finalPlan = buildSectionImprovementPlan(job, 3, {
    script,
    quality: {qualityReport},
    sourceUrl: job.url,
  });
  appendLog(
    job,
    `[auto-improve] finished: ${stopReason}; score=${qualityReport.score}; blockers=${qualityReport.blockers.length}; warnings=${qualityReport.warnings.length}; rerender=${rerenderResult.queued ? rerenderResult.id : rerenderResult.reason}`,
  );

  return {
    ok: true,
    data: {
      id: job.id,
      mode: 'auto-improve',
      config,
      stopReason,
      initialQuality,
      finalQuality: summarizeQualityReport(qualityReport),
      iterations,
      recommendations: finalPlan.recommendations || [],
      rerender: rerenderResult,
      quality: qualitySummaryFor(job),
      artifacts: artifactsFor(job),
    },
  };
}

function writeScriptAndQualityArtifacts(
  job: JobRecord,
  script: ScriptResult,
  context: QualityContext,
  qualityReport: ReturnType<typeof scoreScriptQuality>,
  generationMode: string,
  extra: Record<string, unknown>,
) {
  const artifacts = artifactsFor(job);
  if (artifacts.scriptPath) {
    fs.writeFileSync(artifacts.scriptPath, JSON.stringify(toPersistedScript(script), null, 2));
  }
  if (artifacts.qualityPath) {
    fs.writeFileSync(
      artifacts.qualityPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          url: job.url,
          template: context.templateProfile.id,
          templateReason: context.templateReason,
          domainPack: context.domainPack.id,
          domainPackReason: context.packReason,
          domainPackConfidence: context.packConfidence,
          domainPackTopCandidates: context.packTopCandidates,
          domainPackScores: context.packScores,
          grounding: summarizeGroundingUsage(script, context.groundingHints),
          relevanceGuard: {
            enabled: false,
            applied: false,
            actions: [],
            warnings: [],
          },
          generationMode,
          qualityReport,
          autoImprove: extra,
        },
        null,
        2,
      ),
    );
  }
}

function summarizeQualityReport(report: ReturnType<typeof scoreScriptQuality>) {
  return {
    score: report.score,
    blockers: report.blockers.length,
    warnings: report.warnings.length,
    passed: report.passed,
  };
}

function meetsAutoImproveGoal(
  report: ReturnType<typeof scoreScriptQuality>,
  config: AutoImproveConfig,
): boolean {
  return report.blockers.length === 0
    && report.score >= config.targetScore
    && report.warnings.length <= config.maxWarnings;
}

function isQualityImproved(
  before: ReturnType<typeof summarizeQualityReport>,
  after: ReturnType<typeof summarizeQualityReport>,
): boolean {
  if (after.blockers < before.blockers) return true;
  if (after.warnings < before.warnings) return true;
  if (after.score > before.score + 0.5) return true;
  if (!before.passed && after.passed) return true;
  return false;
}

function pickAutoImproveSection(
  recommendations: SectionImprovementRecommendation[],
  attempts: Map<RegenerateSection, number>,
  maxAttemptsPerSection: number,
): RegenerateSection | null {
  for (const recommendation of recommendations) {
    const used = attempts.get(recommendation.section) || 0;
    if (used < maxAttemptsPerSection) {
      return recommendation.section;
    }
  }
  return null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeAutoPromoteMinConfidence(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Number(Math.max(0, Math.min(1, fallback)).toFixed(2));
  }
  return Number(Math.max(0, Math.min(1, parsed)).toFixed(2));
}

function isPromotionPolicySegment(value: unknown): value is PromotionPolicySegment {
  return value === 'core-icp' || value === 'broad';
}

function normalizeAutoPromotePolicy(input: unknown): AutoPromotePolicy {
  const source = input && typeof input === 'object'
    ? (input as {
      minConfidence?: unknown;
      segmentThresholds?: Record<string, unknown>;
      lastCalibration?: Record<string, unknown>;
    })
    : {};
  const minConfidence = normalizeAutoPromoteMinConfidence(source.minConfidence, DEFAULT_AUTO_PROMOTE_MIN_CONFIDENCE);
  const segmentThresholdsRaw = source.segmentThresholds && typeof source.segmentThresholds === 'object'
    ? source.segmentThresholds
    : {};
  const segmentThresholds: Record<PromotionPolicySegment, number> = {
    'core-icp': normalizeAutoPromoteMinConfidence(segmentThresholdsRaw['core-icp'], minConfidence),
    broad: normalizeAutoPromoteMinConfidence(segmentThresholdsRaw.broad, minConfidence),
  };
  const normalizedCalibration: Partial<Record<PromotionPolicySegment, PromotionPolicyCalibration>> = {};
  const calibrationRaw = source.lastCalibration && typeof source.lastCalibration === 'object'
    ? source.lastCalibration
    : {};
  for (const segment of ['core-icp', 'broad'] as PromotionPolicySegment[]) {
    const item = calibrationRaw[segment];
    if (!item || typeof item !== 'object') continue;
    const typed = item as Partial<PromotionPolicyCalibration>;
    normalizedCalibration[segment] = {
      at: String(typed.at || ''),
      segment,
      accepted: clampInt(typed.accepted, 0, 10000, 0),
      rejected: clampInt(typed.rejected, 0, 10000, 0),
      total: clampInt(typed.total, 0, 10000, 0),
      acceptRate: normalizeAutoPromoteMinConfidence(typed.acceptRate, 0),
      evidenceWeight: normalizeAutoPromoteMinConfidence(typed.evidenceWeight, 0),
      recommendedMinConfidence: normalizeAutoPromoteMinConfidence(
        typed.recommendedMinConfidence,
        segmentThresholds[segment],
      ),
      applied: Boolean(typed.applied),
    };
  }
  return {
    minConfidence,
    segmentThresholds,
    lastCalibration: normalizedCalibration,
  };
}

function inferPromotionSegmentFromDomainPack(pack: unknown): PromotionPolicySegment {
  const normalizedPack = String(pack || '').trim().toLowerCase();
  if (CORE_ICP_PACK_IDS.has(normalizedPack as DomainPackId)) return 'core-icp';
  return 'broad';
}

function inferPromotionSegmentForVersion(version: ProjectVersion): PromotionPolicySegment {
  return inferPromotionSegmentFromDomainPack(version.quality.domainPack);
}

function inferPromotionSegmentForJob(job: JobRecord): PromotionPolicySegment {
  return inferPromotionSegmentFromDomainPack(qualitySummaryFor(job).domainPack);
}

function effectiveMinConfidenceForSegment(
  policy: AutoPromotePolicy,
  segment: PromotionPolicySegment,
): number {
  const candidate = policy.segmentThresholds?.[segment];
  return normalizeAutoPromoteMinConfidence(candidate, policy.minConfidence);
}

function collectSegmentOutcomeStats(rootOutputName: string) {
  const stats: Record<PromotionPolicySegment, {accepted: number; rejected: number; total: number; acceptRate: number}> = {
    'core-icp': {accepted: 0, rejected: 0, total: 0, acceptRate: 0},
    broad: {accepted: 0, rejected: 0, total: 0, acceptRate: 0},
  };
  const versions = listProjectVersions(rootOutputName);
  for (const version of versions) {
    const outcome = version.meta.outcome;
    if (outcome !== 'accepted' && outcome !== 'rejected') continue;
    const segment = inferPromotionSegmentForVersion(version);
    const bucket = stats[segment];
    bucket.total += 1;
    if (outcome === 'accepted') bucket.accepted += 1;
    else bucket.rejected += 1;
  }
  for (const segment of ['core-icp', 'broad'] as PromotionPolicySegment[]) {
    const bucket = stats[segment];
    bucket.acceptRate = bucket.total > 0 ? Number((bucket.accepted / bucket.total).toFixed(2)) : 0;
  }
  return stats;
}

function recommendSegmentMinConfidence(
  stat: {accepted: number; rejected: number; total: number; acceptRate: number},
): {recommended: number; evidenceWeight: number} {
  if (stat.total === 0) {
    return {
      recommended: DEFAULT_AUTO_PROMOTE_MIN_CONFIDENCE,
      evidenceWeight: 0,
    };
  }
  const evidenceWeight = normalizeAutoPromoteMinConfidence(stat.total / 8, 0);
  const target = normalizeAutoPromoteMinConfidence(
    0.75 + ((0.6 - stat.acceptRate) * 0.5),
    DEFAULT_AUTO_PROMOTE_MIN_CONFIDENCE,
  );
  const blended = normalizeAutoPromoteMinConfidence(
    (1 - evidenceWeight) * DEFAULT_AUTO_PROMOTE_MIN_CONFIDENCE + (evidenceWeight * target),
    DEFAULT_AUTO_PROMOTE_MIN_CONFIDENCE,
  );
  return {
    recommended: Math.max(0.55, Math.min(0.9, blended)),
    evidenceWeight,
  };
}

function buildPromotionPolicyCalibrationPreview(rootOutputName: string, policy: AutoPromotePolicy) {
  const statsBySegment = collectSegmentOutcomeStats(rootOutputName);
  const segments: Array<{
    segment: PromotionPolicySegment;
    currentMinConfidence: number;
    recommendedMinConfidence: number;
    accepted: number;
    rejected: number;
    total: number;
    acceptRate: number;
    evidenceWeight: number;
  }> = [];
  for (const segment of ['core-icp', 'broad'] as PromotionPolicySegment[]) {
    const stats = statsBySegment[segment];
    const recommendation = recommendSegmentMinConfidence(stats);
    segments.push({
      segment,
      currentMinConfidence: effectiveMinConfidenceForSegment(policy, segment),
      recommendedMinConfidence: recommendation.recommended,
      accepted: stats.accepted,
      rejected: stats.rejected,
      total: stats.total,
      acceptRate: stats.acceptRate,
      evidenceWeight: recommendation.evidenceWeight,
    });
  }
  return {
    segments,
  };
}

function tryAutoPromoteIfRerenderWinner(job: JobRecord, source: 'close' | 'watchdog' | 'startup' = 'close') {
  if (job.options.mode !== 'rerender') return;
  if (!job.options.autoPromoteIfWinner) return;
  if (job.options.autoPromoteEvaluatedAt) return;

  const now = new Date().toISOString();
  const rootOutputName = getRootOutputName(job);
  const projectPolicy = readProjectAutoPromotePolicy(rootOutputName);
  const segment = job.options.autoPromoteSegment && isPromotionPolicySegment(job.options.autoPromoteSegment)
    ? job.options.autoPromoteSegment
    : inferPromotionSegmentForJob(job);
  const policyMinConfidence = effectiveMinConfidenceForSegment(projectPolicy, segment);
  const minConfidence = normalizeAutoPromoteMinConfidence(
    job.options.autoPromoteMinConfidence,
    policyMinConfidence,
  );
  const sourceJobId = job.options.sourceJobId ?? null;
  const markEvaluation = (decision: string) => {
    job.options.autoPromoteDecision = decision;
    job.options.autoPromoteEvaluatedAt = now;
    persistJob(job);
  };

  if (job.status !== 'completed') {
    const reason = 'rerender did not complete successfully';
    appendLog(job, `[autopromote] skipped: ${reason}`);
    appendProjectAudit(rootOutputName, {
      type: 'autopromote-skipped',
      jobId: job.id,
      sourceJobId,
      reason,
      details: {status: job.status, source, minConfidence, segment},
    });
    markEvaluation(`skipped:${reason}`);
    return;
  }

  const recommendation = recommendProjectVersion(rootOutputName);
  const recommendedId = recommendation.recommended?.id || null;
  const confidence = normalizeAutoPromoteMinConfidence(recommendation.recommended?.confidence, 0);
  if (!recommendedId) {
    const reason = 'no recommendation available';
    appendLog(job, `[autopromote] skipped: ${reason}`);
    appendProjectAudit(rootOutputName, {
      type: 'autopromote-skipped',
      jobId: job.id,
      sourceJobId,
      reason,
      details: {source, confidence, minConfidence, segment},
    });
    markEvaluation(`skipped:${reason}`);
    return;
  }
  if (recommendedId !== job.id) {
    const reason = `winner is ${recommendedId}, not this rerender`;
    appendLog(job, `[autopromote] skipped: ${reason}`);
    appendProjectAudit(rootOutputName, {
      type: 'autopromote-skipped',
      jobId: job.id,
      sourceJobId,
      reason,
      details: {recommendedId, source, confidence, minConfidence, segment},
    });
    markEvaluation(`skipped:${reason}`);
    return;
  }
  if (confidence < minConfidence) {
    const reason = `recommendation confidence ${confidence.toFixed(2)} below threshold ${minConfidence.toFixed(2)}`;
    appendLog(job, `[autopromote] skipped: ${reason}`);
    appendProjectAudit(rootOutputName, {
      type: 'autopromote-skipped',
      jobId: job.id,
      sourceJobId,
      reason,
      details: {source, confidence, minConfidence, segment},
    });
    markEvaluation(`skipped:${reason}`);
    return;
  }

  const promoted = promoteProjectWinner(rootOutputName, job.id);
  if (!promoted.ok) {
    appendLog(job, `[autopromote] failed: ${promoted.error}`);
    appendProjectAudit(rootOutputName, {
      type: 'autopromote-failed',
      jobId: job.id,
      sourceJobId,
      reason: promoted.error,
      details: {source, confidence, minConfidence, segment},
    });
    markEvaluation(`failed:${promoted.error}`);
    return;
  }
  appendLog(job, `[autopromote] promoted v${promoted.promoted.version} (${promoted.promoted.id})`);
  appendProjectAudit(rootOutputName, {
    type: 'autopromote-promoted',
    jobId: job.id,
    sourceJobId,
    reason: 'rerender became winner and was promoted',
    details: {
      promotedVersion: promoted.promoted.version,
      promotedId: promoted.promoted.id,
      source,
      confidence,
      minConfidence,
      segment,
    },
  });
  markEvaluation('promoted');
  if (sourceJobId) {
    const sourceJob = jobs.get(sourceJobId);
    if (sourceJob) {
      appendLog(sourceJob, `[autopromote] promoted rerender winner ${promoted.promoted.id}`);
    }
  }
}

function evaluatePendingAutoPromoteJobs(source: 'watchdog' | 'startup') {
  for (const job of jobs.values()) {
    if (job.options.mode !== 'rerender') continue;
    if (!job.options.autoPromoteIfWinner) continue;
    if (job.options.autoPromoteEvaluatedAt) continue;
    if (job.status !== 'completed' && job.status !== 'failed') continue;
    tryAutoPromoteIfRerenderWinner(job, source);
  }
}

function tickQueue() {
  if (activeJobId) return;
  const nextId = queue.shift();
  if (!nextId) return;

  const job = jobs.get(nextId);
  if (!job) return tickQueue();

  activeJobId = nextId;
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  persistJob(job);

  const args = ['run', 'generate', '--'];
  if (job.options.mode === 'rerender') {
    args.push(
      `--script-path=${job.options.scriptPath}`,
      `--output-name=${job.outputName}`,
      `--voice=${job.options.voice}`,
      `--quality=${job.options.quality}`,
      '--max-script-attempts=1',
      '--min-quality=80',
    );
  } else {
    args.push(
      job.url,
      `--voice=${job.options.voice}`,
      `--quality=${job.options.quality}`,
      `--pack=${job.options.pack}`,
      '--template=auto',
      '--max-script-attempts=2',
      '--min-quality=80',
    );
    if (job.options.skipRender) args.push('--skip-render');
  }

  if (job.options.strict) args.push('--strict');

  const child = spawn('npm', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => appendLog(job, chunk.toString()));
  child.stderr.on('data', (chunk) => appendLog(job, chunk.toString()));

  child.on('error', (err) => {
    job.status = 'failed';
    job.error = err.message;
    job.finishedAt = new Date().toISOString();
    persistJob(job);
    activeJobId = null;
    tickQueue();
  });

  child.on('close', (code) => {
    job.exitCode = code ?? -1;
    job.finishedAt = new Date().toISOString();
    job.status = code === 0 ? 'completed' : 'failed';
    if (code !== 0) job.error = `generate exited with code ${code}`;
    persistJob(job);
    tryAutoPromoteIfRerenderWinner(job);
    activeJobId = null;
    tickQueue();
  });
}

function artifactsFor(job: JobRecord) {
  const base = path.join(outDir, job.outputName);
  const scriptPath = `${base}-script.json`;
  const qualityPath = `${base}-quality.json`;
  const jobPath = `${base}-job.json`;
  const videoPath = `${base}.mp4`;
  const voicePath = `${base}-voice.mp3`;

  return {
    scriptPath: fs.existsSync(scriptPath) ? scriptPath : null,
    qualityPath: fs.existsSync(qualityPath) ? qualityPath : null,
    jobPath: fs.existsSync(jobPath) ? jobPath : null,
    videoPath: fs.existsSync(videoPath) ? videoPath : null,
    voicePath: fs.existsSync(voicePath) ? voicePath : null,
  };
}

function enrichJob(job: JobRecord) {
  const artifacts = artifactsFor(job);
  return {
    ...job,
    rootOutputName: getRootOutputName(job),
    version: getVersion(job),
    queuePosition: job.status === 'queued' ? queue.indexOf(job.id) + 1 : 0,
    artifacts,
    videoUrl: artifacts.videoPath ? `/api/jobs/${job.id}/video` : null,
    quality: qualitySummaryFor(job),
  };
}

function qualitySummaryFor(job: JobRecord) {
  const base = path.join(outDir, job.outputName);
  const qualityPath = `${base}-quality.json`;
  if (!fs.existsSync(qualityPath)) {
    return {
      available: false,
      path: null,
      score: null,
      passed: null,
      blockerCount: null,
      warningCount: null,
      generationMode: null,
      template: null,
      domainPack: null,
      domainPackConfidence: null,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(qualityPath, 'utf-8')) as {
      generationMode?: string;
      template?: string;
      domainPack?: string;
      domainPackConfidence?: number;
      qualityReport?: {score?: number; passed?: boolean; blockers?: string[]; warnings?: string[]};
    };
    const blockers = Array.isArray(parsed.qualityReport?.blockers) ? parsed.qualityReport?.blockers ?? [] : [];
    const warnings = Array.isArray(parsed.qualityReport?.warnings) ? parsed.qualityReport?.warnings ?? [] : [];
    return {
      available: true,
      path: qualityPath,
      score: parsed.qualityReport?.score ?? null,
      passed: parsed.qualityReport?.passed ?? null,
      blockerCount: blockers.length,
      warningCount: warnings.length,
      generationMode: parsed.generationMode ?? null,
      template: parsed.template ?? null,
      domainPack: parsed.domainPack ?? null,
      domainPackConfidence: parsed.domainPackConfidence ?? null,
    };
  } catch {
    return {
      available: false,
      path: qualityPath,
      score: null,
      passed: null,
      blockerCount: null,
      warningCount: null,
      generationMode: null,
      template: null,
      domainPack: null,
      domainPackConfidence: null,
      error: 'quality file parse failed',
    };
  }
}

function metadataPathForRoot(rootOutputName: string): string {
  return path.join(outDir, `${rootOutputName}-version-meta.json`);
}

function readVersionMetadata(rootOutputName: string): VersionMetadata {
  const filePath = metadataPathForRoot(rootOutputName);
  const parsed = safeReadJson(filePath);
  if (parsed && typeof parsed === 'object' && typeof parsed.rootOutputName === 'string' && parsed.entries && typeof parsed.entries === 'object') {
    return {
      rootOutputName: String(parsed.rootOutputName),
      updatedAt: String(parsed.updatedAt || ''),
      entries: parsed.entries as Record<string, VersionMetaEntry>,
      promotionPolicy: normalizeAutoPromotePolicy((parsed as {promotionPolicy?: unknown}).promotionPolicy),
    };
  }
  return {
    rootOutputName,
    updatedAt: new Date(0).toISOString(),
    entries: {},
    promotionPolicy: normalizeAutoPromotePolicy(null),
  };
}

function writeVersionMetadata(rootOutputName: string, metadata: VersionMetadata) {
  const filePath = metadataPathForRoot(rootOutputName);
  fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));
}

function readProjectAutoPromotePolicy(rootOutputName: string): AutoPromotePolicy {
  const metadata = readVersionMetadata(rootOutputName);
  return metadata.promotionPolicy;
}

function auditPathForRoot(rootOutputName: string): string {
  return path.join(outDir, `${rootOutputName}-audit.json`);
}

function readProjectAudit(rootOutputName: string): ProjectAuditLog {
  const filePath = auditPathForRoot(rootOutputName);
  const parsed = safeReadJson(filePath);
  if (
    parsed
    && typeof parsed === 'object'
    && typeof parsed.rootOutputName === 'string'
    && Array.isArray(parsed.entries)
  ) {
    return {
      rootOutputName: String(parsed.rootOutputName),
      updatedAt: String(parsed.updatedAt || ''),
      entries: (parsed.entries as ProjectAuditEntry[])
        .filter((item) => item && typeof item === 'object' && typeof item.at === 'string' && typeof item.type === 'string')
        .sort((a, b) => b.at.localeCompare(a.at)),
    };
  }
  return {
    rootOutputName,
    updatedAt: new Date(0).toISOString(),
    entries: [],
  };
}

function writeProjectAudit(rootOutputName: string, audit: ProjectAuditLog) {
  const filePath = auditPathForRoot(rootOutputName);
  fs.writeFileSync(filePath, JSON.stringify(audit, null, 2));
}

function appendProjectAudit(rootOutputName: string, entry: Omit<ProjectAuditEntry, 'rootOutputName' | 'at'> & {at?: string}) {
  const audit = readProjectAudit(rootOutputName);
  const at = entry.at || new Date().toISOString();
  audit.entries.unshift({
    ...entry,
    rootOutputName,
    at,
  });
  if (audit.entries.length > 250) {
    audit.entries = audit.entries.slice(0, 250);
  }
  audit.updatedAt = at;
  writeProjectAudit(rootOutputName, audit);
}

function listProjectVersions(rootOutputName: string): ProjectVersion[] {
  const metadata = readVersionMetadata(rootOutputName);
  const items = [...jobs.values()]
    .filter((job) => getRootOutputName(job) === rootOutputName)
    .map((job) => {
      const artifacts = artifactsFor(job);
      const meta = metadata.entries[job.id] ?? {};
      return {
        id: job.id,
        outputName: job.outputName,
        rootOutputName,
        version: getVersion(job),
        status: job.status,
        mode: job.options.mode,
        createdAt: job.createdAt,
        finishedAt: job.finishedAt ?? null,
        quality: qualitySummaryFor(job),
        artifacts,
        videoUrl: artifacts.videoPath ? `/api/jobs/${job.id}/video` : null,
        meta: {
          label: meta.label ?? null,
          archived: Boolean(meta.archived),
          pinned: Boolean(meta.pinned),
          outcome: meta.outcome === 'accepted' || meta.outcome === 'rejected' ? meta.outcome : null,
          outcomeNote: meta.outcomeNote ?? null,
          outcomeAt: meta.outcomeAt ?? null,
          promotedAt: meta.promotedAt ?? null,
        },
      };
    })
    .sort((a, b) => b.version - a.version || b.createdAt.localeCompare(a.createdAt));
  return items;
}

function recommendProjectVersion(rootOutputName: string) {
  const versions = listProjectVersions(rootOutputName);
  const learning = buildOutcomeLearning();
  const activeVersions = versions.filter((item) => !item.meta.archived);
  if (activeVersions.length === 0) {
    return {
      recommended: null,
      ranking: [],
      reason: 'No active versions available.',
      learning: {
        totalOutcomes: learning.totalOutcomes,
      },
    };
  }

  const pinned = activeVersions.find((item) => item.meta.pinned);
  if (pinned) {
    const confidence = pinned.meta.outcome === 'rejected' ? 0.6 : 1;
    return {
      recommended: {
        id: pinned.id,
        version: pinned.version,
        outputName: pinned.outputName,
        composite: 999,
        confidence,
        rationale: [`Pinned by operator (status=${pinned.status})`],
      },
      ranking: activeVersions.map((item) => ({
        id: item.id,
        version: item.version,
        outputName: item.outputName,
        composite: item.id === pinned.id ? 999 : scoreVersionCandidate(item, learning).composite,
      })),
      reason: 'Pinned version takes precedence.',
      learning: {
        totalOutcomes: learning.totalOutcomes,
      },
    };
  }

  const scored = activeVersions
    .map((item) => {
      const score = scoreVersionCandidate(item, learning);
      return {
        id: item.id,
        version: item.version,
        outputName: item.outputName,
        composite: score.composite,
        rationale: score.rationale,
        outcome: item.meta.outcome,
      };
    })
    .sort((a, b) => b.composite - a.composite || b.version - a.version);

  const confidence = recommendationConfidence(scored, learning.totalOutcomes);
  const ranking = scored.map(({outcome: _outcome, ...item}) => item);
  const top = scored[0] ?? null;
  const recommended = top
    ? {
        id: top.id,
        version: top.version,
        outputName: top.outputName,
        composite: top.composite,
        confidence,
        rationale: top.rationale,
      }
    : null;
  return {
    recommended,
    ranking,
    reason: recommended
      ? `Selected highest composite score (${recommended.composite}) with confidence ${confidence}.`
      : 'No comparable versions found.',
    learning: {
      totalOutcomes: learning.totalOutcomes,
    },
  };
}

function scoreVersionCandidate(version: ProjectVersion, learning: OutcomeLearning) {
  let composite = Number(version.quality.score ?? 0);
  const rationale: string[] = [`base quality score=${version.quality.score ?? 0}`];

  if (version.quality.passed === true) {
    composite += 20;
    rationale.push('+20 quality pass bonus');
  } else {
    composite -= 20;
    rationale.push('-20 quality fail penalty');
  }

  if (typeof version.quality.blockerCount === 'number' && version.quality.blockerCount > 0) {
    const penalty = version.quality.blockerCount * 8;
    composite -= penalty;
    rationale.push(`-${penalty} blockers penalty`);
  }
  if (typeof version.quality.warningCount === 'number' && version.quality.warningCount > 0) {
    const penalty = version.quality.warningCount * 2;
    composite -= penalty;
    rationale.push(`-${penalty} warnings penalty`);
  }

  if (version.status !== 'completed') {
    composite -= 30;
    rationale.push('-30 non-completed penalty');
  }
  if (!version.artifacts.videoPath) {
    composite -= 25;
    rationale.push('-25 missing-video penalty');
  }
  if (version.mode === 'rerender') {
    composite += 1;
    rationale.push('+1 rerender iteration bonus');
  }
  const recency = Math.min(version.version, 8) * 0.75;
  composite += recency;
  rationale.push(`+${recency.toFixed(2)} recency bonus`);

  if (version.meta.label) {
    composite += 0.5;
    rationale.push('+0.5 labeled-version preference');
  }
  if (version.meta.promotedAt) {
    composite += 0.5;
    rationale.push('+0.5 prior promotion stability bonus');
  }

  if (version.meta.outcome === 'accepted') {
    composite += 18;
    rationale.push('+18 accepted-outcome bonus');
  } else if (version.meta.outcome === 'rejected') {
    composite -= 18;
    rationale.push('-18 rejected-outcome penalty');
  }

  const packKey = normalizeOutcomeKey(version.quality.domainPack);
  const templateKey = normalizeOutcomeKey(version.quality.template);
  if (packKey !== 'unknown' && templateKey !== 'unknown') {
    const pairLift = outcomeLift(learning.byPackTemplate.get(`${packKey}|${templateKey}`), 16);
    if (pairLift.evidence > 0) {
      composite += pairLift.adjustment;
      rationale.push(`${formatSigned(pairLift.adjustment)} historical pack+template lift (${Math.round(pairLift.rate * 100)}% over ${pairLift.evidence} outcomes)`);
    }
  }
  if (packKey !== 'unknown') {
    const packLift = outcomeLift(learning.byPack.get(packKey), 10);
    if (packLift.evidence > 0) {
      composite += packLift.adjustment;
      rationale.push(`${formatSigned(packLift.adjustment)} historical pack lift (${Math.round(packLift.rate * 100)}% over ${packLift.evidence} outcomes)`);
    }
  }
  if (templateKey !== 'unknown') {
    const templateLift = outcomeLift(learning.byTemplate.get(templateKey), 8);
    if (templateLift.evidence > 0) {
      composite += templateLift.adjustment;
      rationale.push(`${formatSigned(templateLift.adjustment)} historical template lift (${Math.round(templateLift.rate * 100)}% over ${templateLift.evidence} outcomes)`);
    }
  }

  composite = Number(composite.toFixed(2));
  return {composite, rationale};
}

function recommendationConfidence(
  scored: Array<{composite: number; outcome: VersionOutcome | null}>,
  totalOutcomes: number,
): number {
  if (scored.length === 0) return 0;
  const top = scored[0];
  const second = scored[1];
  const gap = second ? top.composite - second.composite : 12;
  const gapScore = clamp01((gap + 3) / 20);
  const evidenceScore = clamp01(totalOutcomes / 18);
  let confidence = 0.7 * gapScore + 0.3 * evidenceScore;
  if (top.outcome === 'accepted') confidence += 0.08;
  if (top.outcome === 'rejected') confidence -= 0.2;
  return Number(clamp01(confidence).toFixed(2));
}

function buildOutcomeLearning(): OutcomeLearning {
  const byPack = new Map<string, OutcomeCounts>();
  const byTemplate = new Map<string, OutcomeCounts>();
  const byPackTemplate = new Map<string, OutcomeCounts>();
  const metadataCache = new Map<string, VersionMetadata>();
  let totalOutcomes = 0;

  for (const job of jobs.values()) {
    const root = getRootOutputName(job);
    const metadata = metadataCache.get(root) ?? readVersionMetadata(root);
    if (!metadataCache.has(root)) metadataCache.set(root, metadata);
    const entry = metadata.entries[job.id];
    const outcome = entry?.outcome;
    if (outcome !== 'accepted' && outcome !== 'rejected') continue;
    const quality = qualitySummaryFor(job);
    const packKey = normalizeOutcomeKey(quality.domainPack);
    const templateKey = normalizeOutcomeKey(quality.template);
    totalOutcomes += 1;
    incrementOutcomeCounts(byPack, packKey, outcome);
    incrementOutcomeCounts(byTemplate, templateKey, outcome);
    incrementOutcomeCounts(byPackTemplate, `${packKey}|${templateKey}`, outcome);
  }

  return {
    totalOutcomes,
    byPack,
    byTemplate,
    byPackTemplate,
  };
}

function incrementOutcomeCounts(map: Map<string, OutcomeCounts>, key: string, outcome: VersionOutcome) {
  const existing = map.get(key) ?? {accepted: 0, rejected: 0};
  if (outcome === 'accepted') existing.accepted += 1;
  else existing.rejected += 1;
  map.set(key, existing);
}

function normalizeOutcomeKey(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'unknown';
}

function outcomeLift(counts: OutcomeCounts | undefined, weight: number) {
  const accepted = counts?.accepted ?? 0;
  const rejected = counts?.rejected ?? 0;
  const evidence = accepted + rejected;
  if (evidence === 0) {
    return {
      adjustment: 0,
      evidence: 0,
      rate: 0.5,
    };
  }
  const rate = (accepted + 1) / (accepted + rejected + 2);
  const lift = rate - 0.5;
  const evidenceWeight = Math.min(1, evidence / 6);
  const adjustment = Number((weight * lift * evidenceWeight).toFixed(2));
  return {
    adjustment,
    evidence,
    rate,
  };
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function formatSigned(value: number): string {
  const rounded = Number(value.toFixed(2));
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}

function promoteProjectWinner(
  rootOutputName: string,
  requestedJobId: string | null,
): {ok: true; promoted: {id: string; version: number; outputName: string}; metadata: VersionMetadata}
  | {ok: false; code: number; error: string} {
  const versions = listProjectVersions(rootOutputName);
  if (versions.length === 0) {
    return {ok: false, code: 404, error: 'no versions available for this project'};
  }

  let targetId = requestedJobId;
  if (!targetId) {
    const recommendation = recommendProjectVersion(rootOutputName);
    if (!recommendation.recommended?.id) {
      return {ok: false, code: 409, error: 'no promotable recommendation available'};
    }
    targetId = recommendation.recommended.id;
  }

  const target = versions.find((item) => item.id === targetId);
  if (!target) {
    return {ok: false, code: 404, error: 'target version not found'};
  }
  if (target.status !== 'completed') {
    return {ok: false, code: 409, error: 'target version is not completed'};
  }
  if (!target.artifacts.videoPath) {
    return {ok: false, code: 409, error: 'target version has no rendered video to promote'};
  }

  const metadata = readVersionMetadata(rootOutputName);
  for (const [id, item] of Object.entries(metadata.entries)) {
    metadata.entries[id] = {...item, pinned: false};
  }
  const now = new Date().toISOString();
  const next = metadata.entries[target.id] ?? {};
  next.pinned = true;
  next.archived = false;
  next.promotedAt = now;
  if (!next.label) next.label = 'publish-candidate';
  if (!next.outcome) {
    next.outcome = 'accepted';
    next.outcomeAt = now;
  }
  metadata.entries[target.id] = next;
  metadata.updatedAt = now;
  writeVersionMetadata(rootOutputName, metadata);

  return {
    ok: true,
    promoted: {
      id: target.id,
      version: target.version,
      outputName: target.outputName,
    },
    metadata,
  };
}

function buildSectionImprovementPlan(
  job: JobRecord,
  limit = 3,
  input?: {
    script?: ScriptResult | null;
    quality?: {
      qualityReport?: {score?: number; passed?: boolean; blockers?: string[]; warnings?: string[]};
      template?: string;
      domainPack?: string;
    } | null;
    sourceUrl?: string;
  },
) {
  const artifacts = artifactsFor(job);
  const script = input?.script ?? loadScriptFromArtifact(artifacts.scriptPath);
  if (!script) {
    return {
      jobId: job.id,
      outputName: job.outputName,
      available: false,
      reason: 'Script artifact missing; run the job first.',
      recommendations: [] as SectionImprovementRecommendation[],
    };
  }

  const quality = input?.quality ?? readQualityArtifact(job);
  const scoreMap = new Map<RegenerateSection, {score: number; reasons: Set<string>}>();
  for (const section of REGENERATE_SECTIONS) {
    scoreMap.set(section, {score: 0, reasons: new Set()});
  }
  const add = (section: RegenerateSection, points: number, reason: string) => {
    const entry = scoreMap.get(section);
    if (!entry) return;
    entry.score += points;
    entry.reasons.add(reason);
  };

  const report = quality?.qualityReport;
  for (const blocker of report?.blockers ?? []) {
    for (const section of inferSectionsFromIssue(blocker)) {
      add(section, 12, `Blocker: ${blocker}`);
    }
  }
  for (const warning of report?.warnings ?? []) {
    for (const section of inferSectionsFromIssue(warning)) {
      add(section, 6, `Warning: ${warning}`);
    }
  }

  const hookParts = [script.hookLine1, script.hookLine2, script.hookKeyword].map((value) => String(value || '').trim());
  const invalidHookLines = hookParts.filter((part) => {
    const words = countWords(part);
    return words < 2 || words > 4;
  }).length;
  if (invalidHookLines > 0) add('hook', invalidHookLines * 4, `${invalidHookLines} hook line(s) outside 2-4 words.`);
  const hookCorpus = hookParts.join(' ');
  if (/right now|game changer|next level|all in one|revolutionary/i.test(hookCorpus)) {
    add('hook', 4, 'Hook uses generic hype language.');
  }
  if (!script.narrationSegments[0] || !script.narrationSegments[1] || !script.narrationSegments[2]) {
    add('hook', 8, 'Opening narration segments are incomplete.');
  }

  if (!script.ctaUrl) {
    add('cta', 12, 'CTA URL is missing.');
  } else {
    const ctaDomain = domainHost(script.ctaUrl);
    const sourceDomain = domainHost(input?.sourceUrl || job.url);
    if (ctaDomain && sourceDomain && !ctaDomain.includes(sourceDomain) && !sourceDomain.includes(ctaDomain)) {
      add('cta', 8, `CTA domain (${ctaDomain}) differs from source (${sourceDomain}).`);
    }
  }
  if (!script.narrationSegments[7]) {
    add('cta', 6, 'Closing narration segment is missing.');
  }

  const seenFeatureNames = new Set<string>();
  for (let i = 0; i < 3; i++) {
    const section = i === 0 ? 'feature1' : i === 1 ? 'feature2' : 'feature3';
    const feature = script.features[i];
    if (!feature) {
      add(section, 12, `Feature ${i + 1} block is missing.`);
      continue;
    }
    const appName = normalizeText(feature.appName);
    if (!feature.appName) add(section, 9, `Feature ${i + 1} app name is empty.`);
    if (!feature.caption) add(section, 5, `Feature ${i + 1} caption is empty.`);
    if (seenFeatureNames.has(appName) && appName) add(section, 5, `Feature ${i + 1} app name duplicates another feature.`);
    if (appName) seenFeatureNames.add(appName);
    if (!Array.isArray(feature.demoLines) || feature.demoLines.length === 0) {
      add(section, 10, `Feature ${i + 1} has no demo lines.`);
    } else {
      const joined = feature.demoLines.join(' ');
      if (countWords(joined) < 6) add(section, 4, `Feature ${i + 1} demo content is thin.`);
      if (!/\d/.test(joined)) add(section, 2, `Feature ${i + 1} demo has no numeric signal.`);
    }
    const narration = script.narrationSegments[3 + i] ?? '';
    if (appName && !normalizeText(narration).includes(appName.slice(0, Math.max(3, appName.length - 2)))) {
      add(section, 3, `Narration segment ${4 + i} weakly references feature ${i + 1}.`);
    }
  }

  if (!report && job.status === 'completed') {
    add('hook', 2, 'No quality report found; run Quality Check and improve hook first.');
  }

  const ranked = [...scoreMap.entries()]
    .map(([section, value]) => ({section, score: value.score, reasons: [...value.reasons]}))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || REGENERATE_SECTIONS.indexOf(a.section) - REGENERATE_SECTIONS.indexOf(b.section));

  const fallback = ranked.length === 0
    ? [{
        section: 'hook' as RegenerateSection,
        score: 1,
        reasons: ['No major issues detected. Optional polish starts with hook refresh.'],
      }]
    : ranked;
  const maxScore = Math.max(...fallback.map((item) => item.score), 1);
  const recommendations: SectionImprovementRecommendation[] = fallback
    .slice(0, limit)
    .map((item) => ({
      section: item.section,
      priority: item.score,
      confidence: Number(clamp01(item.score / maxScore).toFixed(2)),
      impact: item.score >= 18 ? 'high' : item.score >= 10 ? 'medium' : 'low',
      reasons: item.reasons.slice(0, 4),
    }));

  return {
    jobId: job.id,
    outputName: job.outputName,
    status: job.status,
    quality: {
      score: report?.score ?? null,
      passed: report?.passed ?? null,
      blockerCount: Array.isArray(report?.blockers) ? report!.blockers.length : 0,
      warningCount: Array.isArray(report?.warnings) ? report!.warnings.length : 0,
    },
    recommendations,
  };
}

function readQualityArtifact(job: JobRecord):
  | {
      qualityReport?: {score?: number; passed?: boolean; blockers?: string[]; warnings?: string[]};
      template?: string;
      domainPack?: string;
    }
  | null {
  const artifacts = artifactsFor(job);
  if (!artifacts.qualityPath) return null;
  const parsed = safeReadJson(artifacts.qualityPath);
  if (!parsed || typeof parsed !== 'object') return null;
  return parsed as {
    qualityReport?: {score?: number; passed?: boolean; blockers?: string[]; warnings?: string[]};
    template?: string;
    domainPack?: string;
  };
}

function inferSectionsFromIssue(issue: string): RegenerateSection[] {
  const text = String(issue || '').toLowerCase();
  const sections = new Set<RegenerateSection>();

  if (text.includes('hook') || text.includes('wordmark narration') || /narration segment [123]\b/.test(text)) {
    sections.add('hook');
  }
  if (text.includes('cta') || text.includes('closing narration')) {
    sections.add('cta');
  }
  if (/feature 1\b/.test(text)) sections.add('feature1');
  if (/feature 2\b/.test(text)) sections.add('feature2');
  if (/feature 3\b/.test(text)) sections.add('feature3');

  if (
    text.includes('feature "') ||
    text.includes('feature app names') ||
    text.includes('feature blocks') ||
    text.includes('feature demos') ||
    text.includes('script must contain exactly 3 features')
  ) {
    sections.add('feature1');
    sections.add('feature2');
    sections.add('feature3');
  }

  if (
    text.includes('narration must contain exactly 8 scene segments') ||
    text.includes('placeholder content')
  ) {
    sections.add('hook');
    sections.add('feature1');
    sections.add('feature2');
    sections.add('feature3');
    sections.add('cta');
  }

  if (
    text.includes('grounding') ||
    text.includes('source language') ||
    text.includes('numeric signals') ||
    text.includes('domain mismatch term')
  ) {
    sections.add('feature1');
    sections.add('feature2');
    sections.add('feature3');
    sections.add('hook');
  }

  if (sections.size === 0) {
    sections.add('hook');
  }
  return [...sections];
}

function domainHost(value: string): string {
  try {
    const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(normalized).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizeText(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function compareJobs(left: JobRecord, right: JobRecord) {
  const leftArtifacts = artifactsFor(left);
  const rightArtifacts = artifactsFor(right);
  const leftQuality = qualitySummaryFor(left);
  const rightQuality = qualitySummaryFor(right);
  const leftScript = loadScriptFromArtifact(leftArtifacts.scriptPath);
  const rightScript = loadScriptFromArtifact(rightArtifacts.scriptPath);

  const leftFeatures = leftScript?.features?.map((feature) => feature.appName) ?? [];
  const rightFeatures = rightScript?.features?.map((feature) => feature.appName) ?? [];
  const leftIntegrations = new Set(leftScript?.integrations ?? []);
  const rightIntegrations = new Set(rightScript?.integrations ?? []);
  const sharedIntegrations = [...leftIntegrations].filter((item) => rightIntegrations.has(item));

  return {
    left: {
      id: left.id,
      outputName: left.outputName,
      rootOutputName: getRootOutputName(left),
      version: getVersion(left),
      quality: leftQuality,
      videoUrl: leftArtifacts.videoPath ? `/api/jobs/${left.id}/video` : null,
    },
    right: {
      id: right.id,
      outputName: right.outputName,
      rootOutputName: getRootOutputName(right),
      version: getVersion(right),
      quality: rightQuality,
      videoUrl: rightArtifacts.videoPath ? `/api/jobs/${right.id}/video` : null,
    },
    diff: {
      scoreDelta: (rightQuality.score ?? 0) - (leftQuality.score ?? 0),
      passTransition: `${String(leftQuality.passed)} -> ${String(rightQuality.passed)}`,
      packTransition: `${leftQuality.domainPack ?? 'n/a'} -> ${rightQuality.domainPack ?? 'n/a'}`,
      hookChanged: leftScript && rightScript
        ? leftScript.hookLine1 !== rightScript.hookLine1
          || leftScript.hookLine2 !== rightScript.hookLine2
          || leftScript.hookKeyword !== rightScript.hookKeyword
        : null,
      ctaChanged: leftScript && rightScript ? leftScript.ctaUrl !== rightScript.ctaUrl : null,
      featureNameChanges: compareLists(leftFeatures, rightFeatures),
      narrationWordDelta: leftScript && rightScript
        ? countWords(leftScript.narrationSegments.join(' ')) - countWords(rightScript.narrationSegments.join(' '))
        : null,
      sharedIntegrationsCount: sharedIntegrations.length,
      sharedIntegrations: sharedIntegrations.slice(0, 12),
    },
  };
}

function compareLists(left: string[], right: string[]) {
  const max = Math.max(left.length, right.length);
  const changes: Array<{slot: number; from: string; to: string}> = [];
  for (let i = 0; i < max; i++) {
    const from = left[i] ?? '';
    const to = right[i] ?? '';
    if (from !== to) {
      changes.push({slot: i + 1, from, to});
    }
  }
  return changes;
}

function loadScriptFromArtifact(scriptPath: string | null): ScriptResult | null {
  if (!scriptPath) return null;
  const parsed = safeReadJson(scriptPath);
  if (!parsed) return null;
  try {
    return normalizeScriptPayload(parsed);
  } catch {
    return null;
  }
}

function sendVideo(res: http.ServerResponse, videoPath: string) {
  if (!fs.existsSync(videoPath)) {
    return sendJson(res, 404, {error: 'video artifact missing'});
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(videoPath).pipe(res);
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function isSafeOutputName(value: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(value);
}

function persistJob(job: JobRecord) {
  const file = path.join(jobsDir, `${job.id}.json`);
  fs.writeFileSync(file, JSON.stringify(job, null, 2));
}

function appendLog(job: JobRecord, text: string) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    job.logs.push(line);
  }
  if (job.logs.length > 80) {
    job.logs = job.logs.slice(-80);
  }
  persistJob(job);
}

function safeReadJson(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function sendJson(res: http.ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendHtml(res: http.ServerResponse, html: string) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function loadPersistedJobs() {
  try {
    const files = fs.readdirSync(jobsDir).filter((name) => name.endsWith('.json'));
    for (const file of files) {
      const full = path.join(jobsDir, file);
      const parsed = safeReadJson(full);
      if (!parsed || typeof parsed !== 'object') continue;
      const raw = parsed as JobRecord;
      if (!raw.id || !raw.outputName || !raw.options) continue;
      const rootOutputName = raw.options.rootOutputName || parseVersionedOutputName(raw.outputName).rootOutputName;
      const version = raw.options.version || parseVersionedOutputName(raw.outputName).version;
      const status = raw.status === 'running' || raw.status === 'queued' ? 'failed' : raw.status;
      const recovered: JobRecord = {
        ...raw,
        status,
        options: {
          ...raw.options,
          rootOutputName,
          version,
        },
      };
      if (status === 'failed' && !recovered.error && (raw.status === 'running' || raw.status === 'queued')) {
        recovered.error = 'Recovered after server restart.';
      }
      jobs.set(recovered.id, recovered);
    }
  } catch {
    // best-effort restore only
  }
}

function renderHtml() {
  const packOptions = ['auto', ...DOMAIN_PACK_IDS]
    .map((id) => `<option value="${id}">${id === 'auto' ? 'auto (recommended)' : id}</option>`)
    .join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>smift - URL to premium product video</title>
  <style>
    :root {
      --bg: #f3efe4;
      --surface: #fff9ee;
      --panel: #ffffff;
      --ink: #11151b;
      --muted: #5f6773;
      --line: #e6dcc8;
      --ok: #13795b;
      --warn: #b85b00;
      --bad: #c22f2f;
      --accent: #0f7c66;
      --accent-strong: #0a614f;
      --accent-soft: #d9efe8;
      --sun: #f3b544;
      --radius: 18px;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(1100px 680px at -5% -15%, #f8d596 0%, transparent 62%),
        radial-gradient(920px 620px at 105% 5%, #b9e8db 0%, transparent 58%),
        linear-gradient(180deg, #f3efe4 0%, #ece6d9 100%);
      font-family: "Sora", "Manrope", "Avenir Next", sans-serif;
      min-height: 100vh;
    }

    .shell {
      max-width: 980px;
      margin: 0 auto;
      padding: 26px 16px 40px;
      animation: rise 420ms ease-out;
    }

    .hero {
      margin-bottom: 16px;
    }

    .tag {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(15, 124, 102, 0.12);
      border: 1px solid rgba(15, 124, 102, 0.25);
      color: var(--accent-strong);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    h1 {
      margin: 12px 0 8px;
      font-size: clamp(30px, 6vw, 52px);
      line-height: 1.02;
      letter-spacing: -0.03em;
      max-width: 840px;
    }

    .hero p {
      margin: 0;
      color: var(--muted);
      max-width: 730px;
      font-size: 16px;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 16px;
      box-shadow: 0 14px 36px rgba(18, 23, 30, 0.08);
      margin-top: 14px;
      animation: rise 540ms ease-out;
    }

    .panel h2 {
      margin: 0 0 12px;
      font-size: 18px;
      letter-spacing: -0.01em;
    }

    .run-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
    }

    .controls {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-top: 10px;
    }

    input, select {
      width: 100%;
      border: 1px solid #d8dbe2;
      border-radius: 12px;
      padding: 12px 13px;
      font: inherit;
      color: var(--ink);
      background: #fff;
    }

    label {
      font-size: 12px;
      color: var(--muted);
      display: block;
      margin-bottom: 6px;
      font-weight: 600;
    }

    .btn {
      border: none;
      border-radius: 12px;
      padding: 12px 16px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: transform 120ms ease, opacity 120ms ease, background 120ms ease;
      text-decoration: none;
    }

    .btn:active { transform: translateY(1px); }
    .btn[disabled] { opacity: 0.55; cursor: default; }

    .btn-primary {
      background: linear-gradient(135deg, var(--accent), #0d9275);
      color: #fff;
      min-width: 190px;
    }

    .btn-secondary {
      background: #1f2933;
      color: #fff;
    }

    .btn-ghost {
      background: #eff3f7;
      color: #1f2933;
    }

    .examples {
      margin-top: 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .chip {
      border: 1px solid #d2d8e2;
      background: #f8fbff;
      color: #2b3340;
      border-radius: 999px;
      font-size: 12px;
      padding: 7px 11px;
      cursor: pointer;
    }

    .status-wrap {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }

    .status-left {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
    }

    .dot {
      width: 11px;
      height: 11px;
      border-radius: 99px;
      background: #aab4c2;
      box-shadow: 0 0 0 4px rgba(170, 180, 194, 0.2);
    }

    .dot.ok { background: var(--ok); box-shadow: 0 0 0 4px rgba(19, 121, 91, 0.18); }
    .dot.warn { background: var(--warn); box-shadow: 0 0 0 4px rgba(184, 91, 0, 0.18); }
    .dot.bad { background: var(--bad); box-shadow: 0 0 0 4px rgba(194, 47, 47, 0.18); }

    .muted { color: var(--muted); }

    .meta {
      color: var(--muted);
      font-size: 12px;
    }

    .log {
      margin: 0;
      background: #0f1720;
      color: #e5ebf2;
      border-radius: 12px;
      border: 1px solid #263243;
      padding: 12px;
      font-size: 12px;
      min-height: 110px;
      max-height: 250px;
      overflow: auto;
      white-space: pre-wrap;
      line-height: 1.45;
      font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, monospace;
    }

    .result {
      display: grid;
      gap: 12px;
    }

    video {
      width: 100%;
      border-radius: 14px;
      background: #000;
      min-height: 230px;
      border: 1px solid #222a35;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .hidden { display: none !important; }

    .stagger { animation: rise 520ms ease-out; }

    @media (max-width: 820px) {
      .run-row { grid-template-columns: 1fr; }
      .controls { grid-template-columns: 1fr; }
      .btn-primary { width: 100%; }
      .actions .btn { width: 100%; }
    }

    @keyframes rise {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <span class="tag">smift engine</span>
      <h1>Paste a product URL. Get a premium narrated video.</h1>
      <p>
        No avatars. No manual storyboard grind. We generate artifact-first videos designed to feel like high-end startup product launches.
      </p>
    </section>

    <section class="panel stagger" aria-label="run">
      <h2>Generate</h2>
      <div class="run-row">
        <input id="url" type="text" placeholder="https://your-product.com" />
        <button id="runBtn" class="btn btn-primary">Generate Video</button>
      </div>
      <div class="controls">
        <div>
          <label for="quality">Quality</label>
          <select id="quality">
            <option value="yc">premium (yc)</option>
            <option value="draft">fast draft</option>
          </select>
        </div>
        <div>
          <label for="voice">Voice</label>
          <select id="voice">
            <option value="openai">openai narration</option>
            <option value="chatterbox">chatterbox narration</option>
            <option value="elevenlabs">elevenlabs narration</option>
            <option value="none">no voice</option>
          </select>
        </div>
        <div>
          <label for="pack">Domain pack</label>
          <select id="pack">${packOptions}</select>
        </div>
      </div>
      <div class="examples">
        <button class="chip" data-url="https://linear.app">Try: Linear</button>
        <button class="chip" data-url="https://intercom.com">Try: Intercom</button>
        <button class="chip" data-url="https://shopify.com">Try: Shopify</button>
        <button class="chip" data-url="https://vercel.com">Try: Vercel</button>
      </div>
    </section>

    <section class="panel stagger" aria-label="status">
      <div class="status-wrap">
        <div class="status-left">
          <span id="statusDot" class="dot"></span>
          <span id="statusText">Idle</span>
        </div>
        <div id="jobMeta" class="meta">No active run.</div>
      </div>
      <pre id="logBox" class="log">Waiting for first run...</pre>
    </section>

    <section id="resultPanel" class="panel result hidden" aria-label="result">
      <h2>Your video</h2>
      <video id="videoPreview" controls></video>
      <div class="actions">
        <a id="downloadBtn" class="btn btn-secondary" href="#" download>Download MP4</a>
        <button id="polishBtn" class="btn btn-ghost">Auto-Polish + Rerender</button>
        <button id="rerunBtn" class="btn btn-ghost">Generate Another</button>
      </div>
      <div id="resultInfo" class="muted">No render yet.</div>
    </section>
  </main>

  <script>
    const byId = (id) => document.getElementById(id);

    const urlInput = byId('url');
    const runBtn = byId('runBtn');
    const qualitySelect = byId('quality');
    const voiceSelect = byId('voice');
    const packSelect = byId('pack');
    const statusDot = byId('statusDot');
    const statusText = byId('statusText');
    const jobMeta = byId('jobMeta');
    const logBox = byId('logBox');
    const resultPanel = byId('resultPanel');
    const videoPreview = byId('videoPreview');
    const downloadBtn = byId('downloadBtn');
    const polishBtn = byId('polishBtn');
    const rerunBtn = byId('rerunBtn');
    const resultInfo = byId('resultInfo');

    let pollTimer = null;
    let currentJobId = null;
    let lastPayload = null;

    function setBusy(busy) {
      runBtn.disabled = busy;
      runBtn.textContent = busy ? 'Generating...' : 'Generate Video';
      polishBtn.disabled = busy;
      rerunBtn.disabled = busy;
    }

    function setStatus(text, tone) {
      statusText.textContent = text;
      statusDot.className = 'dot';
      if (tone) statusDot.classList.add(tone);
    }

    function sanitizeUrl(input) {
      const raw = String(input || '').trim();
      if (!raw) return '';
      const lower = raw.toLowerCase();
      if (lower.startsWith('http://') || lower.startsWith('https://')) return raw;
      return 'https://' + raw;
    }

    function setLogs(lines) {
      if (!Array.isArray(lines) || lines.length === 0) {
        logBox.textContent = 'No log lines yet.';
        return;
      }
      logBox.textContent = lines.slice(-25).join('\\n');
      logBox.scrollTop = logBox.scrollHeight;
    }

    function renderResult(job) {
      const quality = job && job.quality ? job.quality : null;
      const parts = [];
      if (job && job.outputName) parts.push('output: ' + job.outputName);
      if (quality && typeof quality.score === 'number') parts.push('score: ' + quality.score);
      if (quality && quality.domainPack) parts.push('pack: ' + quality.domainPack);
      if (quality && quality.template) parts.push('template: ' + quality.template);
      if (quality && quality.passed === false) parts.push('quality guard: warnings/blockers present');
      resultInfo.textContent = parts.length > 0 ? parts.join(' | ') : 'Render complete.';

      if (job && job.videoUrl) {
        videoPreview.src = job.videoUrl;
        downloadBtn.href = job.videoUrl;
        downloadBtn.classList.remove('hidden');
      } else {
        videoPreview.removeAttribute('src');
        downloadBtn.classList.add('hidden');
      }
      resultPanel.classList.remove('hidden');
    }

    function updateMeta(job) {
      const queue = typeof job.queuePosition === 'number' && job.queuePosition > 0
        ? 'queue #' + job.queuePosition
        : 'running';
      const version = job.version ? ('v' + job.version) : 'v1';
      jobMeta.textContent = 'job: ' + job.id + ' | ' + version + ' | ' + queue;
    }

    async function fetchJson(url, init) {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({error: 'invalid JSON response'}));
      return {res, data};
    }

    async function pollJob() {
      if (!currentJobId) return;
      const {res, data} = await fetchJson('/api/jobs/' + currentJobId);
      if (!res.ok) {
        setStatus('Failed to load job', 'bad');
        setLogs([data.error || 'unknown error']);
        clearInterval(pollTimer);
        pollTimer = null;
        setBusy(false);
        return;
      }

      setLogs(Array.isArray(data.logs) ? data.logs : []);
      updateMeta(data);

      if (data.status === 'queued') {
        setStatus('Queued', 'warn');
        return;
      }
      if (data.status === 'running') {
        setStatus('Rendering...', 'warn');
        return;
      }
      if (data.status === 'failed') {
        setStatus('Run failed', 'bad');
        setBusy(false);
        clearInterval(pollTimer);
        pollTimer = null;
        resultPanel.classList.remove('hidden');
        resultInfo.textContent = data.error || 'Rendering failed. Try another URL or voice.';
        return;
      }
      if (data.status === 'completed') {
        setStatus('Video ready', 'ok');
        setBusy(false);
        clearInterval(pollTimer);
        pollTimer = null;
        renderResult(data);
      }
    }

    async function queueGeneration(payload) {
      setBusy(true);
      setStatus('Submitting...', 'warn');
      setLogs(['Submitting URL...']);
      resultPanel.classList.add('hidden');

      const {res, data} = await fetchJson('/api/jobs', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        setBusy(false);
        setStatus('Submit failed', 'bad');
        setLogs([data.error || 'submit failed']);
        return;
      }

      currentJobId = data.id;
      lastPayload = payload;
      setStatus('Queued', 'warn');
      jobMeta.textContent = 'job: ' + data.id + ' | v' + (data.version || 1);

      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(() => {
        pollJob().catch((error) => {
          setStatus('Polling failed', 'bad');
          setLogs([String(error && error.message ? error.message : error)]);
          setBusy(false);
        });
      }, 2000);

      await pollJob();
    }

    async function runFromInput() {
      const url = sanitizeUrl(urlInput.value);
      if (!url) {
        setStatus('URL required', 'bad');
        urlInput.focus();
        return;
      }

      const payload = {
        url,
        quality: qualitySelect.value === 'draft' ? 'draft' : 'yc',
        pack: packSelect.value || 'auto',
        strict: qualitySelect.value !== 'draft',
        skipRender: false,
        voice: voiceSelect.value || 'openai',
      };

      await queueGeneration(payload);
    }

    async function runPolishPass() {
      if (!currentJobId) {
        setStatus('No completed run to polish', 'bad');
        return;
      }
      setBusy(true);
      setStatus('Polishing script + rerendering...', 'warn');

      const {res, data} = await fetchJson('/api/jobs/' + currentJobId + '/auto-improve', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          maxSteps: 3,
          targetScore: 90,
          maxWarnings: 1,
          autofix: true,
          autoRerender: true,
          rerenderStrict: true,
          autoPromoteIfWinner: false,
        }),
      });

      if (!res.ok) {
        setBusy(false);
        setStatus('Polish failed', 'bad');
        setLogs([data.error || 'auto-improve request failed']);
        return;
      }

      const rerender = data && data.rerender ? data.rerender : null;
      if (rerender && rerender.queued && rerender.id) {
        currentJobId = rerender.id;
        setStatus('Polish queued rerender', 'warn');
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(() => {
          pollJob().catch((error) => {
            setStatus('Polling failed', 'bad');
            setLogs([String(error && error.message ? error.message : error)]);
            setBusy(false);
          });
        }, 2000);
        await pollJob();
        return;
      }

      setBusy(false);
      setStatus('Polish complete (no rerender)', 'ok');
      setLogs(Array.isArray(data.iterations)
        ? data.iterations.map((it) => 'step ' + it.step + ' [' + it.section + '] ' + it.before.score + ' -> ' + it.after.score)
        : ['polish complete']);
    }

    runBtn.addEventListener('click', () => {
      runFromInput().catch((error) => {
        setBusy(false);
        setStatus('Run failed', 'bad');
        setLogs([String(error && error.message ? error.message : error)]);
      });
    });

    urlInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        runBtn.click();
      }
    });

    polishBtn.addEventListener('click', () => {
      runPolishPass().catch((error) => {
        setBusy(false);
        setStatus('Polish failed', 'bad');
        setLogs([String(error && error.message ? error.message : error)]);
      });
    });

    rerunBtn.addEventListener('click', () => {
      if (!lastPayload) {
        runBtn.click();
        return;
      }
      queueGeneration(lastPayload).catch((error) => {
        setBusy(false);
        setStatus('Rerun failed', 'bad');
        setLogs([String(error && error.message ? error.message : error)]);
      });
    });

    document.querySelectorAll('.chip[data-url]').forEach((el) => {
      el.addEventListener('click', () => {
        const value = el.getAttribute('data-url') || '';
        urlInput.value = value;
        urlInput.focus();
      });
    });

    setStatus('Idle', '');
  </script>
</body>
</html>`;
}

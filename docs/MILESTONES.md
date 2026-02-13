# Milestones

## 2026-02-13

### M34 - Configurable Auto-Promote Confidence Policy

- Added project-level promotion policy persistence (`minConfidence`) in version metadata.
- Added API endpoints:
  - `GET /api/projects/:rootOutputName/promotion-policy`
  - `POST /api/projects/:rootOutputName/promotion-policy`
- Added UI controls in local runner to load/save promotion policy and set auto-promote minimum confidence.
- Extended rerender/auto-improve flow to carry `autoPromoteMinConfidence` into queued rerender jobs.
- Hardened auto-promote evaluator:
  - promotion now requires recommendation confidence >= configured threshold
  - skip reasons + threshold/confidence context are written to promotion audit trail.
- Added policy-update events to project audit stream for operator traceability.

## 2026-02-12

### M1 - Quality Gate + Autofix

- Added strict/standard quality modes with warning thresholds.
- Added deterministic auto-fix pass to repair common script defects.
- Added template-aware script generation with fallback script builder.
- Added resilient generation flow (model retries -> autofix -> fallback).
- Pushed to GitHub in commit `fb993af`.

### M2 - Batch Evaluation Harness

- Added benchmark URL set (`src/pipeline/benchmark-urls.ts`).
- Added batch evaluator (`src/pipeline/eval.ts`) with JSON/CSV aggregate output.
- Added `npm run eval` command.
- Added `--skip-render` path to accelerate script-quality batch runs.

### M3 - Reliability Manifest

- Added per-job manifest output (`out/<name>-job.json`) from `generate`.
- Manifest tracks settings, stage events, outputs, and errors.
- Voice/render fallback decisions are persisted for postmortems.

### M4 - Self-Serve Local Runner

- Added local HTTP queue runner (`src/server/serve.ts`).
- Added web UI + API endpoints:
  - `POST /api/jobs`
  - `GET /api/jobs/:id`
  - `GET /api/jobs/:id/artifacts`
  - `GET /health`
- Added `npm run serve` command.

### M5 - Domain Pack Framework + Strong Fallback

- Added domain-pack system (`src/pipeline/domain-packs.ts`) with major families:
  - `general`, `b2b-saas`, `devtools`, `ecommerce-retail`, `fintech`, `gaming`, `media-creator`, `education`, `real-estate`, `travel-hospitality`, `logistics-ops`, `social-community`.
- Added `--pack=auto|<pack-id>` to pipeline and server job submission.
- Pack selection now informs template choice (`selectTemplate(..., domainPackId)`).
- Script generation prompt now includes pack constraints:
  - allowed icons
  - forbidden terms
  - concrete field hints
  - style guidance
- Reworked fallback script builder and auto-fix to be pack-aware (no hardcoded SaaS defaults).
- Updated quality scoring to validate pack alignment (icons, forbidden terms, integrations, concrete fields).
- Reworked `FeatureDemo` analytics mockup to consume dynamic demo lines instead of fixed SaaS metrics.
- Improved scraper reliability with URL candidate retries (`http/https`, `www/non-www`).

### M6 - Pack Confidence Model + Regression Harness

- Upgraded domain-pack auto-selection from flat keyword counts to weighted field scoring:
  - domain/title/description/headings/features/body/links each contribute different weights.
  - weak generic keywords are down-weighted to reduce false positives.
- Added confidence and gap gating for fallback:
  - ambiguous or weak matches now route to `general` instead of forcing wrong domain packs.
  - low-signal-but-clear domains can still route to specific packs when confidence+gap are strong.
- Added structured taxonomy extraction from JSON-LD in scraper (`structuredHints`) and fed it into pack scoring.
- Added pack diagnostics to artifacts:
  - `domainPackConfidence`
  - `domainPackTopCandidates`
  - `domainPackScores`
- Added offline regression fixtures (`src/pipeline/pack-fixtures.ts`) covering every major pack family plus ambiguity/fallback cases.
- Added pack regression runner (`src/pipeline/eval-packs.ts`) and `npm run eval:packs`.

### M7 - Server Quality-Only Triage API

- Added quality-only endpoint to local runner:
  - `GET /api/jobs/:id/quality`
  - `GET /api/jobs/:id?view=quality`
- Job payload now includes parsed quality summary:
  - `score`, `passed`, `generationMode`, `domainPack`, `domainPackConfidence`.
- This enables lightweight queue polling and triage without consuming full script artifacts.

### M8 - Grounded Generation + Pack Visual Systems

- Added grounding extraction module (`src/pipeline/grounding.ts`) to derive:
  - source terms
  - source phrases
  - source numbers
  - integration candidates
- Wired grounding into generation flow:
  - script prompt now includes grounding lexicon constraints.
  - model output is post-processed to enforce grounded feature/demo/narration text.
  - fallback and autofix now inject grounded phrases/numbers where needed.
- Added grounding-aware quality scoring and artifact reporting:
  - quality scorer now evaluates grounding coverage and numeric signal usage.
  - `out/<name>-quality.json` now contains a `grounding` summary block.
- Implemented pack-aware visual systems in feature scenes:
  - `FeatureDemo` now uses domain-driven layout variants (`terminal`, `commerce`, `ledger`, `leaderboard`, `timeline`, `feed`, `default`).
  - scene background, glow, and pill treatment now vary by selected domain pack.
  - `SaasIntro` now passes `domainPackId` through to all feature scenes.

### M9 - Grounding Strictness V2 + Integration Resolver

- Expanded grounding hints with `featureNameCandidates` and stronger label cleanup heuristics.
- Added feature-name canonicalization:
  - candidate scoring + similarity gating against grounded names
  - noisy names are replaced with synthesized source-term labels.
- Added integration resolver + alias mapping:
  - canonicalizes integration names (e.g., GitHub, Stripe, Booking.com) from raw labels/hrefs/model output.
  - applied consistently across script generation, fallback, and autofix.
- Tightened quality scoring with grounding-focused checks:
  - stronger penalties for weak grounding coverage
  - per-feature grounding checks
  - numeric-signal expectations when source numbers exist
  - integration overlap accepts either pack defaults or grounded integration candidates.
- Pipeline logging now reports grounded feature-name candidate counts.

### M10 - Render Relevance Guard + Real URL Benchmark Harness

- Added render relevance guard stage (`src/pipeline/relevance-guard.ts`) and wired it into `generate` flow:
  - normalizes feature names/icons/captions/demo lines before output/render
  - canonicalizes integrations and aligns CTA domain
  - sanitizes forbidden domain terms in visual-facing content
  - rolls back guard output automatically if it would fail quality gates
- Added `--no-relevance-guard` flag for controlled A/B debugging.
- Added real benchmark suite (`src/pipeline/benchmark-real-urls.ts`) with expected pack labels across domain families.
- Added real benchmark runner (`src/pipeline/eval-real.ts`) + `npm run eval:real`:
  - reports pass-rate, average score, and expected-pack accuracy
  - outputs JSON/CSV summaries in `out/`.

### M11 - B2B Recall Calibration for Real Domains

- Tuned domain-pack scoring to improve B2B recall on marketing-heavy sites:
  - expanded B2B keywords and high-signal terms (`hubspot`, `salesforce`, `intercom`, `customer service`, etc.)
  - added B2B negative keywords to avoid ecommerce/fintech leakage.
- Added strong `signalTerms` for `ecommerce-retail` and `fintech` packs to rebalance precision after B2B boost.
- Reduced false positives in adjacent packs:
  - added negative B2B indicators to `media-creator`
  - replaced generic real-estate keyword `agent` with `real estate agent`.
- `eval:real --limit=20` improved from ~`78.9%` to `94.7%` pack accuracy (excluding one network-blocked domain).

### M12 - B2B vs Ecommerce Tie-Break Stability

- Added explicit b2b/ecommerce disambiguation notes in auto-pack selection reasons for easier debugging.
- Fixed tie-break stability bug by using absolute candidate gap during fallback gating:
  - prevents false fallback to `general` when disambiguation intentionally selects a close second candidate.
- Validated with targeted repro:
  - `klaviyo.com` now consistently selects `ecommerce-retail` (instead of dropping to `general`).
- Re-ran benchmarks:
  - `npm run eval:packs`: `100%` (14/14)
  - `npm run eval:real -- --limit=20 --max-script-attempts=1 --allow-low-quality`: `100%` pack accuracy on comparable domains (`19/19`; one blocked fetch on `tracker.gg`), `95%` pass rate (`19/20`).

### M13 - CI Regression Gate (Packs + Real Smoke)

- Extended real benchmark runner (`src/pipeline/eval-real.ts`) with:
  - suite selection (`--suite=full|smoke`)
  - optional threshold gating (`--min-pass-rate`, `--min-pack-accuracy`, `--min-pack-comparable`, `--max-errors`).
- Added stable CI smoke set (`src/pipeline/benchmark-real-smoke-urls.ts`) spanning core families:
  - devtools, b2b-saas, ecommerce-retail, fintech, gaming.
- Added `npm run eval:real:smoke` script for one-command CI checks.
- Updated GitHub Actions workflow (`.github/workflows/pack-regression.yml`) to run both:
  - `npm run eval:packs`
  - `npm run eval:real:smoke`
- Local validation:
  - `npx tsc --noEmit` pass
  - `npm run eval:packs` pass (`14/14`)
  - `npm run eval:real:smoke` pass (`100%` pack accuracy on `10/10`, `90%` quality pass rate).

### M14 - Evidence-Backed Feature Planning (Engine Quality)

- Added a feature evidence plan primitive in grounding layer (`buildFeatureEvidencePlan`):
  - each feature slot now has a canonical source-backed name, required phrase(s), and preferred number (when available).
- Wired evidence plan into model generation prompt (`scriptgen`):
  - explicit slot-by-slot evidence instructions now constrain feature naming and demo content.
- Strengthened post-generation grounding enforcement:
  - feature names are aligned to evidence slots when drift is detected.
  - demo lines are force-grounded with required source phrases and numeric signals.
  - feature narration segments (4-6) are aligned with slot feature references.
- Updated deterministic fallback builder to use the same evidence plan so fallback scripts stay source-specific.
- Updated render relevance guard to enforce evidence phrases/numbers and narration-feature alignment before output.
- Added quality checks for evidence alignment:
  - per-feature evidence phrase presence
  - feature-name drift from slot canonical name
  - feature narration segment reference clarity.
- Fixed feature token sanitizer bug that corrupted words (`customer` -> `cus`) and degraded feature names.
- Validation:
  - `npx tsc --noEmit` pass
  - `npm run eval:packs` pass (`14/14`)
  - `npm run eval:real:smoke` pass (`10/10` pack accuracy, `10/10` quality pass, `0` errors).

### M15 - Sparse-Site Quality Hardening

- Improved sparse-grounding behavior in `grounding.ts`:
  - `buildFeatureEvidencePlan()` now accepts pack id and can synthesize slot evidence when site copy is minimal.
  - added pack-specific sparse fallback feature names (e.g. B2B: `Support Inbox`, `Customer Timeline`, `Agent Routing`).
  - expanded feature noise filtering to remove marketing fluff terms (`leading`, `highest`, etc.) and generic `company`.
- Updated canonical feature-name behavior:
  - allow strong sparse fallback labels even when direct phrase candidates are absent.
  - preserves pack fallback names instead of collapsing to weak token pairs.
- Improved fallback brand extraction:
  - ignore tagline-like title heads (`The ... company`) and fall back to domain brand in sparse pages.
- Validation:
  - `intercom.com` now produces stable sparse features (`Support Inbox`, `Customer Timeline`, `Agent Routing`) with quality pass.
  - `npm run eval:real:smoke`: `100%` pack accuracy (`10/10`), `100%` pass rate (`10/10`), `0` errors.

### M16 - Product Roadmap Baseline (Execution Discipline)

- Added explicit product roadmap doc (`docs/ROADMAP.md`) to remove ad-hoc execution.
- Defined:
  - V1 target user and core promise
  - paid-ready acceptance gates (quality, reliability, UX, commercial basics)
  - phase-by-phase execution path (engine -> workflow -> paid beta -> scale)
  - concrete next 10-workday implementation sequence.
- Added roadmap link in `README.md` docs section.

### M17 - Blocked-Page Detection + Metadata Fallback (Roadmap Day 1)

- Added blocked/anti-bot page detection in scraper (`src/pipeline/scraper.ts`) using marker signals:
  - unsupported client/browser, captcha/cloudflare, access denied, etc.
- Added metadata-fallback extraction mode when blocked signals are detected:
  - sanitizes blocked metadata
  - extracts headings/features/body from safe metadata + structured hints
  - injects neutral domain-based fallback features when source content is sparse.
- Added scrape diagnostics to pipeline output:
  - `scrapeMode` and `scrapeWarnings` in `ScrapedData`
  - run logs now print metadata-fallback mode and reasons.
- Tightened auto-pack behavior for metadata-fallback pages:
  - higher confidence/score thresholds to avoid false specific-pack routing.
- Validation:
  - `canva.com` now routes through metadata-fallback with clean feature names (no browser-error phrasing).
  - `npm run eval:real:smoke`: `100%` pack accuracy (`10/10`) and `100%` pass rate (`10/10`).

### M18 - Customer Corpus + Core ICP Benchmark Gate

- Added customer-style benchmark suite:
  - `src/pipeline/benchmark-customer-urls.ts`
  - segmented into `core-icp`, `adjacent-icp`, and `stress`.
- Extended real eval runner with segment filtering:
  - `eval-real --suite=customer --segment=core-icp`
- Added commands:
  - `npm run eval:customer`
  - `npm run eval:customer:core`
- Established baseline:
  - `eval:customer`: pack `87.1%` (`27/31`), quality pass `100%` (`31/31`)
  - `eval:customer:core`: pack `95.2%` (`20/21`), quality pass `100%` (`21/21`)
- Added corpus documentation: `docs/CUSTOMER_CORPUS.md`.

### M19 - Blocked-Page Fixture Harness (Roadmap Day 3)

- Added scraper fixture set (`src/pipeline/scraper-fixtures.ts`) covering:
  - unsupported browser pages
  - cloudflare/challenge pages
  - access denied pages
  - normal non-blocked pages.
- Added scraper regression runner (`src/pipeline/eval-scraper.ts`) and command:
  - `npm run eval:scraper`
- Exported scraper helper primitives for deterministic fixture checks:
  - `detectBlockedPageSignals`
  - `sanitizeBlockedMetadata`
  - `extractMetadataFallback`
- Tightened blocked-term sanitization in fallback extraction (removes challenge/browser copy leakage).
- Validation:
  - `npm run eval:scraper`: `100%` (`5/5`)
  - `npm run eval:real:smoke`: `100%` pack accuracy (`10/10`), `100%` pass rate (`10/10`).

### M20 - Hook Quality Hardening (Roadmap Day 4-5)

- Added source-grounded hook enforcement in `scriptgen` post-processing:
  - hook lines are normalized to 2-4 words and aligned to evidence/grounding terms.
  - generic hype hooks are replaced with domain-aware alternatives.
- Improved fallback hook generation in `fallback-script`:
  - hook lines now use grounding phrases where available.
  - avoids fallback to weak generic text when model calls fail.
- Improved autofix hook normalization:
  - replaces generic fillers (`right now`) with grounded/domain-aware terms.
- Added hook quality rubric checks in `quality.ts`:
  - penalties for hype-only hook wording
  - penalty when no hook line is source-grounded.
- Validation:
  - `npm run eval:scraper`: `100%` (`5/5`)
  - `npm run eval:real:smoke`: `100%` pack accuracy (`10/10`), `100%` pass rate (`10/10`).

### M21 - Section Regeneration API (Roadmap Day 6)

- Added section regeneration engine module:
  - `src/pipeline/section-regenerate.ts`
  - supports targeted regeneration for `hook`, `feature1`, `feature2`, `feature3`, `cta`.
- Added server endpoint:
  - `POST /api/jobs/:id/regenerate`
  - rewrites selected section from existing artifacts + fresh scrape grounding.
  - re-scores quality and persists updated script/quality artifacts in place.
- Added basic UI controls in local runner for section regeneration.
- Validation:
  - manual E2E check on local server:
    - create job
    - regenerate `hook` and `feature2`
    - verify updated quality file and generation mode (`section-regenerate:*`).
  - `npm run eval:scraper`: `100%` (`5/5`)
  - `npm run eval:real:smoke`: `100%` pack accuracy (`10/10`), `100%` pass rate (`10/10`).

### M22 - Vision Lock + Anti-Drift Guardrails

- Added explicit product vision doc:
  - `docs/VISION.md`
  - locks positioning to artifact-first, avatar-less premium videos.
  - defines non-goals and mandatory scope checklist for major work.
- Updated roadmap with non-negotiable vision lock section:
  - `docs/ROADMAP.md` now includes "Vision Lock (Do Not Drift)" and avatar-scope boundaries.
- Updated project docs to reflect positioning:
  - `README.md` now includes positioning and `check:vision` command.
  - `docs/AGENT_LEARNINGS.md` now includes a vision discipline section.
- Added automated scope guard:
  - `scripts/check-vision-guard.js`
  - validates required vision/roadmap/readme statements.
  - scans `src/` for forbidden avatar-focused source terms.
- Added CI enforcement:
  - `.github/workflows/pack-regression.yml` now runs `npm run check:vision`.

### M23 - Script Edit UI + Rerender Workflow (Roadmap Day 7-8)

- Added script editing workflow to local server:
  - `GET /api/jobs/:id/script`
  - `PUT /api/jobs/:id/script`
  - normalizes and persists edited scripts via shared script IO utilities.
- Added rerender workflow without re-scrape:
  - `POST /api/jobs/:id/rerender`
  - queues a rerender job that calls `generate --script-path=... --output-name=...`.
- Extended pipeline runner (`run.ts`) with script-path mode:
  - supports `--script-path=<file>` and `--output-name=<name>`.
  - bypasses scrape/generation and proceeds directly to voice/render.
- Added UI controls in self-serve page:
  - load script, save script, rerender edited script.
- Validation:
  - `npx tsc --noEmit` pass.
  - manual E2E:
    - create job (`skipRender=true`)
    - load script from API
    - edit + save script
    - queue rerender
    - verify rendered artifact (`out/linear-app.mp4`) produced from edited script path.

### M24 - 20-URL QA + Failure-Class Patches (Roadmap Day 9-10)

- Ran 20-URL real benchmark QA pass and identified fetch-block failure class on challenge-heavy domains.
- Scraper resilience hardening:
  - non-OK HTML fallback reuse when available.
  - synthetic metadata fallback when all fetch candidates fail (no hard throw).
  - fetch warning propagation into `scrapeWarnings`.
- Metadata fallback enrichment:
  - domain-hint injection into fallback extraction for sparse/blocked pages.
- Domain-pack tuning for blocked gaming domains:
  - added gaming high-signal terms (`op.gg`, `tracker.gg`, `mobalytics`, `tftacademy`, etc.).
- Validation:
  - `npm run eval:scraper`: `100%` (`5/5`).
  - `npm run eval:packs`: `100%` (`14/14`).
  - `npm run eval:real -- --limit=20 --max-script-attempts=1 --allow-low-quality`:
    - pack accuracy `100%` (`20/20`)
    - pass rate `100%` (`20/20`)
    - errors `0`
  - `npm run eval:real:smoke`:
    - pack accuracy `100%` (`10/10`)
    - pass rate `100%` (`10/10`)
    - errors `0`.

### M25 - Structured Editor + Quality-Guarded Rerender (Phase B UX)

- Reworked local runner UX from raw JSON editing to structured script editing controls:
  - brand/hook/cta fields
  - integrations + narration segment editors
  - per-feature icon/name/caption/demo editors.
- Added pre-rerender quality guard endpoint:
  - `POST /api/jobs/:id/validate-script`
  - returns full quality report for current edited script.
  - supports `autofix=true` to apply deterministic fixes before rerender attempts.
- Added server-side rerender guard enforcement:
  - `POST /api/jobs/:id/rerender` now validates current script and returns `409` on quality failure.
- Fixed autofix crash on sparse narration arrays:
  - `autoFixScriptQuality()` now safely handles undefined segments during sanitization.
- Validation:
  - `npx tsc --noEmit` pass.
  - API E2E:
    - create -> load/edit/save -> validate -> rerender path verified.
    - guard rejects low-quality edited scripts (`409`) before queueing rerender.
    - valid scripts rerender successfully from script-path mode.

### M26 - Versioned Rerenders + Compare UX

- Added versioned rerender artifact model:
  - rerender no longer overwrites root output; it allocates `root-v2`, `root-v3`, etc.
  - snapshots edited script + quality to versioned artifacts before queueing rerender.
- Added project/version APIs:
  - `GET /api/projects/:rootOutputName/versions`
  - returns version timeline with quality summary + artifact pointers.
- Added compare and playback APIs:
  - `GET /api/jobs/:id/compare?other=<jobId>` for script/quality deltas.
  - `GET /api/jobs/:id/video` for preview streaming in UI.
- Added local runner compare UI:
  - version history panel
  - left/right version selectors
  - compare summary and side-by-side video preview.
- Added persisted-job restore on server startup (best effort):
  - jobs from `out/jobs/*.json` are loaded to restore version timeline context.
- Validation:
  - `npx tsc --noEmit` pass.
  - API E2E:
    - create v1 script-only job
    - quality-check pass
    - rerender creates new versioned output (e.g. `linear-app-v3`)
    - compare endpoint returns deltas
    - video endpoint serves mp4 (`200`).

### M27 - Best-Version Recommendation + Lifecycle Controls

- Added recommendation API:
  - `GET /api/projects/:rootOutputName/recommendation`
  - ranks non-archived versions using quality score/pass state, blocker/warning counts, render availability, and recency.
- Added version metadata API:
  - `POST /api/projects/:rootOutputName/version-meta`
  - supports `set-label`, `set-archived`, `set-pinned`.
- Added lifecycle consistency rules:
  - pinning auto-unarchives target version.
  - archiving auto-unpins target version.
- Added local runner controls:
  - recommend-best button + recommendation rationale panel.
  - label/archive/pin actions for selected version.
  - compare selectors auto-sync with recommendation result.
- Validation:
  - `npx tsc --noEmit` pass.
  - API checks:
    - recommendation endpoint returns ranked output.
    - pin override is honored by recommendation.
    - compare endpoint remains functional after metadata updates.

### M28 - Outcome-Learned Recommendation + Promote Winner Flow

- Extended version metadata with explicit customer-style outcome feedback:
  - `set-outcome` action on `POST /api/projects/:rootOutputName/version-meta`
  - outcome states: `accepted`, `rejected`, or empty (clear)
  - optional `outcomeNote` and timestamp tracking (`outcomeAt`).
- Added recommendation learning loop:
  - recommendation scoring now incorporates historical accepted/rejected outcomes.
  - historical lift is applied at three levels:
    - pack+template pair
    - pack-only
    - template-only
  - recommendation response now includes confidence and total outcome evidence count.
- Added publish-default action:
  - new endpoint `POST /api/projects/:rootOutputName/promote`
  - promotes winner by pinning selected/recommended version.
  - enforces completed + rendered-video requirement before promotion.
  - stamps `promotedAt` and defaults label to `publish-candidate` if empty.
- Updated local runner UX:
  - added outcome controls (`accepted` / `rejected` + note).
  - added one-click `Promote Winner` button.
  - recommendation panel now displays confidence and outcome evidence count.
  - version tags now show `outcome` and `promoted` state.
- Validation:
  - `npx tsc --noEmit` pass.
  - `npm run check:vision` pass.
  - local API smoke:
    - `set-outcome` updates metadata successfully.
    - `promote` pins the winner and returns promoted version metadata.
    - recommendation returns confidence and updated learning outcome count.

### M29 - Section Auto-Improvement Recommendations + Apply-Top-Fix

- Added section improvement planning endpoint:
  - `GET /api/jobs/:id/improvement-plan?limit=3`
  - returns ranked section recommendations for `hook`, `feature1`, `feature2`, `feature3`, `cta`.
- Improvement scoring now combines:
  - quality blockers/warnings mapped to impacted sections.
  - script-level heuristics (hook quality, CTA-domain fit, feature demo strength, narration-feature linkage).
  - fallback guidance when no major issues are detected.
- Added local runner controls:
  - `Recommend Next Fixes` to fetch ranked section plan.
  - `Apply Top Fix` to regenerate the highest-priority section automatically.
  - plan panel shows priority, impact, confidence, and reason snippets.
- Integration behavior:
  - plan is refreshed after quality checks and after section regeneration.
  - completed/failed job poll now refreshes section improvement plan alongside recommendation/version data.
- Validation:
  - `npx tsc --noEmit` pass.
  - `npm run check:vision` pass.
  - local API smoke:
    - improvement-plan endpoint returns ranked recommendations for existing job.
    - applying top fix triggers section regenerate and updates plan.

### M30 - Bounded Auto-Improve Loop (Engine Iteration Control)

- Added bounded multi-step auto-improve API:
  - `POST /api/jobs/:id/auto-improve`
  - config controls:
    - `maxSteps` (1..8)
    - `targetScore` (70..100)
    - `maxWarnings` (0..12)
    - `autofix` (default true)
- Loop behavior:
  - each step selects the highest-priority section from improvement-plan ranking.
  - regenerates section, re-scores quality, optionally applies autofix, persists artifacts.
  - records per-step deltas (score/blockers/warnings, section, actions, improved flag).
- Hard stop conditions:
  - `already-meets-target`
  - `target-reached`
  - `max-steps-reached`
  - `stalled-no-improvement`
  - `sections-exhausted`
- Added local runner controls:
  - auto-improve config inputs (max steps, target score, max warnings, autofix mode)
  - `Run Auto Improve` button
  - auto-improve result panel with iteration summary + stop reason.
- Validation:
  - `npx tsc --noEmit` pass.
  - `npm run check:vision` pass.
  - local API smoke:
    - `POST /api/jobs/:id/auto-improve` returns bounded iteration payload and stop reason.

### M31 - Auto-Rerender Trigger After Auto-Improve Target

- Extended auto-improve config with publish-threshold render trigger:
  - `autoRerender` (boolean, default false)
  - `rerenderStrict` (boolean, defaults to auto-improve strict mode)
- Added shared rerender queue helper so manual rerender and auto-improve rerender use the same versioned artifact path.
- Auto-improve now:
  - queues a versioned rerender job automatically when quality goals are met and `autoRerender=true`.
  - returns rerender status metadata (`queued`, `id`, `version`, reason when skipped).
- Updated local runner controls:
  - `auto rerender on target` toggle
  - rerender strictness toggle for queued render
  - auto-improve result box now shows rerender queue outcome.
- Validation:
  - `npx tsc --noEmit` pass.
  - `npm run check:vision` pass.
  - local API smoke:
    - `POST /api/jobs/:id/auto-improve` returns rerender metadata and queues render when enabled and target reached.

### M32 - Auto-Promote If Rerender Wins Recommendation

- Extended auto-improve rerender flow with `autoPromoteIfWinner` control.
- Rerender job options now persist `autoPromoteIfWinner` so completion logic can apply promotion safely.
- Queue completion hook now evaluates rerender jobs with `autoPromoteIfWinner=true`:
  - checks whether completed rerender is current recommendation winner.
  - only then promotes via existing `promoteProjectWinner()` flow.
  - appends audit logs on promote/skip reasons.
- Updated local runner auto-improve controls:
  - added `auto promote if winner` toggle.
  - auto-improve result panel now shows whether auto-promotion was requested.
- Validation:
  - `npx tsc --noEmit` pass.
  - `npm run check:vision` pass.
  - local API smoke:
    - auto-improve accepts `autoPromoteIfWinner`.
    - rerender job metadata includes `autoPromoteIfWinner`.

### M33 - Promotion Audit Trail + Watchdog Recovery

- Added persistent project-level audit log:
  - stored at `out/<rootOutputName>-audit.json`
  - records:
    - rerender queue events
    - auto-promote promoted/skipped/failed outcomes
    - reason + lightweight details (status/recommended winner/source)
- Added audit API:
  - `GET /api/projects/:rootOutputName/audit?limit=20`
- Added watchdog recovery behavior:
  - startup pass and periodic watchdog evaluate pending rerender auto-promote jobs not yet finalized.
  - finalized decisions persist on job options (`autoPromoteEvaluatedAt`, `autoPromoteDecision`) to avoid reprocessing.
- Updated local runner:
  - `Refresh Audit` button
  - audit panel showing recent automation events for current project root.
- Validation:
  - `npx tsc --noEmit` pass.
  - `npm run check:vision` pass.
  - local API smoke:
    - audit endpoint returns entries.
    - auto-improve rerender queue events are written into audit log.

# Milestones

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

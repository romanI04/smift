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

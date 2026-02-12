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


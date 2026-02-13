# smift

URL-first product intro video generator.

Paste a URL, generate a structured script with quality checks, produce narration, and render a launch-style video.

## Positioning

- Artifact-first, premium output.
- Avatar-less by strategy (no anthropomorphic presenter focus).
- Value comes from URL-to-meaning relevance, credibility, and visual polish.

## Requirements

- Node 20+
- `ffmpeg` + `ffprobe` on PATH
- API keys in `/Users/romanimanov/clawd/.env` as needed:
  - `openai_api_key`
  - `eleven_labs_api_key` (optional)
  - `replicate_key` (optional)

## Core Commands

- `npm run generate -- <url>`: full pipeline
- `npm run generate -- <url> --skip-render`: script + quality only
- `npm run generate -- <url> --strict`: strict quality mode
- `npm run eval -- --limit=10`: benchmark batch summary (JSON + CSV)
- `npm run eval:scraper`: blocked-page scraper fixture regression suite
- `npm run eval:packs`: offline domain-pack regression suite
- `npm run eval:real -- --limit=20`: real-URL benchmark with expected-pack accuracy
- `npm run eval:real:smoke`: CI-friendly real-URL smoke suite with threshold gating
- `npm run eval:customer`: customer-style corpus benchmark
- `npm run eval:customer:core`: core paying-segment benchmark (primary GTM gate)
- `npm run check:vision`: scope-lock validation (vision/roadmap guard)
- `npm run serve`: local self-serve queue + web UI (`http://localhost:3030`)
  - quality-only status view: `GET /api/jobs/:id/quality` (or `GET /api/jobs/:id?view=quality`)
  - section regenerate API: `POST /api/jobs/:id/regenerate` with body `{ "section": "hook|feature1|feature2|feature3|cta" }`
  - script read API: `GET /api/jobs/:id/script`
  - script edit API: `PUT /api/jobs/:id/script` with body `{ "script": <full-script-json> }`
  - script validate API: `POST /api/jobs/:id/validate-script` with body `{ "autofix": true|false }`
  - rerender API: `POST /api/jobs/:id/rerender` (quality-guarded, renders from existing script artifact without re-scrape)
  - section improvement plan API: `GET /api/jobs/:id/improvement-plan?limit=3` (recommends next section(s) to regenerate)
  - auto-improve API: `POST /api/jobs/:id/auto-improve` (bounded section iteration loop with stop conditions)
  - version list API: `GET /api/projects/:rootOutputName/versions`
  - recommendation API: `GET /api/projects/:rootOutputName/recommendation`
  - version metadata API: `POST /api/projects/:rootOutputName/version-meta` (actions: `set-label`, `set-archived`, `set-pinned`, `set-outcome`)
  - promote winner API: `POST /api/projects/:rootOutputName/promote` (pins recommended winner and marks publish candidate)
  - compare API: `GET /api/jobs/:id/compare?other=<jobId>`
  - video stream API: `GET /api/jobs/:id/video`

## Useful Flags (`generate`)

- `--voice=none|openai|elevenlabs|chatterbox`
- `--quality=draft|yc`
- `--template=auto|yc-saas|product-demo|founder-story`
- `--pack=auto|general|b2b-saas|devtools|ecommerce-retail|fintech|gaming|media-creator|education|real-estate|travel-hospitality|logistics-ops|social-community`
- `--voice-mode=single|segmented`
- `--strict` or `--quality-mode=strict`
- `--min-quality=<n>`
- `--max-warnings=<n>`
- `--max-script-attempts=<n>`
- `--allow-low-quality`
- `--no-autofix`
- `--no-relevance-guard`
- `--skip-render`
- `--script-path=<path-to-script.json>` (rerender from edited script without scraping/generation)
- `--output-name=<name>` (pair with `--script-path` to control output artifact names)

## Useful Flags (`eval:real`)

- `--suite=full|smoke`
- `--segment=<segment-id>` (used by customer suite, e.g. `core-icp`)
- `--limit=<n>`
- `--min-pass-rate=<percent>`
- `--min-pack-accuracy=<percent>`
- `--min-pack-comparable=<n>`
- `--max-errors=<n>`

## Outputs

Generated artifacts land in `out/`:

- `<name>-script.json`
- `<name>-quality.json`
- `<name>-job.json` (run manifest)
- `<name>-voice.mp3` (if voice enabled)
- `<name>.mp4` (if render enabled)
- `eval-summary-*.json` + `.csv` (batch eval)

## Domain Packs

- Domain packs are selected automatically from scraped copy (`--pack=auto`) or forced via `--pack=<id>`.
- Pack selection drives template default, icon constraints, forbidden terms, concrete on-screen fields, and fallback integrations.
- Auto-selection now uses weighted field scoring (domain/title/headings/features/body/links) plus confidence+gap gating.
- Pack scoring supports high-confidence signal terms per domain family (used for better real-world recall on sparse/marketing pages).
- Scraper contributes `structuredHints` from JSON-LD metadata when available.
- Feature scenes now use pack-aware visual layouts (terminal/ledger/commerce/leaderboard/timeline/feed) instead of one generic mockup style.
- Pack metadata is defined in `src/pipeline/domain-packs.ts`.
- Quality report includes `domainPack` and `domainPackReason` for traceability.
- Quality report also includes `domainPackConfidence`, `domainPackTopCandidates`, and `domainPackScores`.
- Scraper can switch to `metadata-fallback` mode on blocked/challenge pages to avoid using anti-bot text as grounding input.

## Grounding

- The pipeline extracts source grounding hints (`terms`, `phrases`, `featureNameCandidates`, `numbers`, `integrationCandidates`) from scraped content.
- The generator builds a slot-based feature evidence plan from grounded hints and enforces it during generation, fallback, and relevance guard.
- Sparse pages use pack-aware fallback evidence labels so feature blocks stay domain-relevant even with minimal scrape text.
- Script generation prompt and post-processing use grounding hints to reduce off-domain wording.
- Feature names are canonicalized against grounded candidates; noisy labels fall back to synthesized term-based names.
- Integrations are canonicalized through a known-tool resolver + alias mapping.
- A render relevance guard runs before output/render to enforce icon/name/demo/integration consistency.
- Quality report includes a `grounding` block with coverage and match stats so relevance is auditable per run.
- Quality report includes `relevanceGuard` actions/warnings for traceability.

## Docs

- `docs/MILESTONES.md`: sprint milestone log
- `docs/AGENT_LEARNINGS.md`: implementation notes and known traps for future agents
- `docs/ROADMAP.md`: paid-product roadmap, acceptance gates, and execution order
- `docs/VISION.md`: non-negotiable positioning and anti-drift scope lock
- `docs/CUSTOMER_CORPUS.md`: customer URL corpus and benchmark baselines

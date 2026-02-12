# Agent Learnings

## Quality System Behavior

- Strict mode (`--strict`) fails if warnings remain above threshold, not just blockers.
- `autoFixScriptQuality()` can move scripts from non-pass to pass without another model call.
- Scene pacing should be informational (`notes`) rather than hard warning; otherwise strict mode can false-fail good scripts.

## Pipeline Reliability

- Use `--skip-render` for fast eval loops; rendering dominates runtime.
- Always rely on `out/<name>-job.json` to diagnose stage failures instead of stdout alone.
- TTS providers are volatile; keep `voice=none` for benchmark correctness and speed.

## Eval Harness

- `npm run eval -- --limit=N` provides pass-rate and average score quickly.
- By default, eval calls `generate` with `--skip-render` and `--allow-low-quality` so aggregate metrics keep flowing.
- If you need full media validation, run eval with `--with-render`.

## Self-Serve Server

- Server is intentionally single-worker queue to avoid local resource contention.
- Jobs are persisted to `out/jobs/<id>.json` for operational traceability.
- API returns local artifact paths; downstream systems can upload them if needed.
- Server now supports pack control (`payload.pack` / UI dropdown), forwarded to `generate --pack=...`.
- Use `GET /api/jobs/:id/quality` (or `?view=quality`) for cheap status polling when full artifacts are unnecessary.

## Domain Pack System

- Treat `general` as the stability fallback, not as a primary happy path.
- Use `selectDomainPack(scraped, requested)` once after scraping, then pass the result through scriptgen, autofix, fallback, and quality scoring.
- Keep pack metadata cohesive: when adding a new pack, always define keywords, allowed icons, forbidden terms, concrete fields, fallback integrations, and style hint together.
- Template routing should stay pack-aware (`defaultTemplateForPack`), otherwise auto-template can drift into irrelevant visual language.
- Check `out/<name>-quality.json` for `domainPack` and `domainPackReason` during debugging; it is the quickest signal for misclassification.
- Use `domainPackConfidence` and `domainPackTopCandidates` in `out/<name>-quality.json` before changing prompts; many misses are classification uncertainty, not generation defects.
- `npm run eval:packs` is the first-line regression check for pack routing changes (offline, deterministic, fast).
- Sparse pages are common; classifier now allows low-signal-but-clear routing (score/gap/confidence) to avoid over-falling back to `general`.
- Scraper exposes `structuredHints` from JSON-LD metadata. Keep this field in fixtures when adding new pack tests.

## Grounding + Visual Layers

- `extractGroundingHints()` should run once per scrape and be passed through generation, fallback, autofix, and quality scoring.
- If scripts feel generic, inspect `quality.grounding.coverage` first; low coverage usually means weak source extraction or over-aggressive prompt edits.
- Feature scene visuals are now pack-driven. If a pack looks off, start in `src/scenes/FeatureDemo.tsx` (`DOMAIN_VISUAL_THEMES` + `selectMockup`) before touching pipeline prompts.
- Feature naming is now canonicalized in `grounding.ts`; avoid adding ad-hoc name cleanup logic inside scriptgen/autofix.
- Use `canonicalizeIntegrations()` everywhere integrations are mutated. Mixing raw + canonical tool names increases false warnings.
- Render relevance guard runs post-generation. If you need raw model behavior for debugging, run with `--no-relevance-guard`.
- Guard may be intentionally skipped if it regresses quality gates; check `quality.relevanceGuard` in output JSON for rollback details.

## Real Benchmarking

- `npm run eval:real -- --limit=N` is the fastest way to track real-domain pack drift and script quality together.
- Use `npm run eval:real:smoke` for CI: it runs a stable multi-pack subset and enforces threshold gates.
- Track both metrics: quality pass-rate can stay high while pack accuracy drops; both need to be monitored.
- B2B recall depends heavily on customer-service/sales vocabulary; signal terms now help recover sparse or marketing-heavy pages.
- After changing one pack’s signal terms, run `eval:real` on at least 20 URLs to check cross-pack regressions.
- If tie-break logic can choose a non-top raw candidate, compute score separation with an absolute gap before ambiguity fallback checks.
- Keep smoke thresholds realistic (`min-pack-comparable`, `max-errors`) so transient fetch blocks do not create noisy CI failures.

## Known Gaps / Next Work

- Better brand-name extraction for titles with separators (e.g. `Linear – Plan and build products`).
- Add dedicated retry backoff policy per TTS engine + transient network errors.
- Add persistent queue backend (SQLite/Redis) for crash recovery.
- Add auth/quotas before exposing self-serve runner beyond localhost.
- Add a renderless "quality-only" output mode in server responses for fast triage.
- Add domain-aware terms to scraper extraction (e.g. schema.org / JSON-LD hints) to improve pack confidence on sparse landing pages.
- Reduce repetitive feature-name roots on sparse single-theme sites (e.g. TFT pages repeating "Teamfight Tactics" variants).

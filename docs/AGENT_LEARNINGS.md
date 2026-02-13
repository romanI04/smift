# Agent Learnings

## Vision Lock Discipline

- `docs/VISION.md` is the primary scope authority for product direction.
- Smift is artifact-first and avatar-less; do not introduce anthropomorphic presenter work into core priorities.
- For major roadmap changes, apply the scope checklist from `docs/VISION.md` before implementation.
- If a task does not improve relevance, artifact quality, editability, or reliability, deprioritize it.
- Run `npm run check:vision` after roadmap/positioning edits.

## Quality System Behavior

- Strict mode (`--strict`) fails if warnings remain above threshold, not just blockers.
- `autoFixScriptQuality()` can move scripts from non-pass to pass without another model call.
- Scene pacing should be informational (`notes`) rather than hard warning; otherwise strict mode can false-fail good scripts.
- Hook quality is now explicitly scored; generic hype phrasing is penalized even if word-count constraints pass.

## Pipeline Reliability

- Use `--skip-render` for fast eval loops; rendering dominates runtime.
- Always rely on `out/<name>-job.json` to diagnose stage failures instead of stdout alone.
- TTS providers are volatile; keep `voice=none` for benchmark correctness and speed.
- Scraper now supports `scrapeMode=metadata-fallback` for blocked pages; check this first when outputs look generic.
- If a domain is blocked/challenged, sanitize metadata and avoid feeding challenge-copy into grounding.
- Run `npm run eval:scraper` after scraper changes to catch blocked-page fallback regressions before real-url evals.
- Scraper now degrades gracefully on hard fetch failures:
  - it can reuse non-OK HTML responses as fallback source input,
  - it emits synthetic metadata fallback instead of hard-failing when every fetch candidate is blocked.

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
- Use `POST /api/jobs/:id/regenerate` for targeted iteration (`hook`, `feature1..3`, `cta`) without re-running full workflow from scratch.
- Use `GET /api/jobs/:id/script` + `PUT /api/jobs/:id/script` for minimal JSON script edit workflow.
- Use `POST /api/jobs/:id/validate-script` before rerendering edited scripts; it returns blockers/warnings and supports `autofix=true`.
- Use `POST /api/jobs/:id/rerender` to render from edited script artifacts without re-scraping.
- Rerender jobs now create versioned outputs (`root`, `root-v2`, `root-v3`, ...), preserving prior artifacts.
- Rerender endpoint now enforces quality guard server-side; it returns `409` if edited script fails quality checks.
- Use `GET /api/projects/:rootOutputName/versions` to retrieve version history for compare UX.
- Use `GET /api/projects/:rootOutputName/recommendation` for automated best-version ranking.
- Use `POST /api/projects/:rootOutputName/version-meta` for label/archive/pin/outcome controls.
- Use `POST /api/projects/:rootOutputName/promote` to pin the current winner as publish default.
- Use `GET /api/jobs/:id/improvement-plan` to rank which script section to regenerate first (`hook`, `feature1..3`, `cta`).
- Use `POST /api/jobs/:id/auto-improve` for bounded multi-step section iteration (`maxSteps`, `targetScore`, `maxWarnings`, `autofix`).
- `auto-improve` supports optional auto-rerender when loop reaches target (`autoRerender=true`, optional `rerenderStrict`).
- `auto-improve` also supports `autoPromoteIfWinner`: rerender is promoted automatically only if that rerender is recommendation winner at completion time.
- Use `GET /api/projects/:rootOutputName/audit` to inspect rerender queue and auto-promote outcomes (`promoted`/`skipped`/`failed`).
- Use `GET /api/jobs/:id/compare?other=<jobId>` for quick quality/script delta summary.
- Use `GET /api/jobs/:id/video` for preview playback in local compare panels.
- Pinning a version now automatically unarchives it; archiving a version automatically unpins it.
- Recommendation confidence now combines score-gap strength with historical accepted/rejected outcomes.
- Improvement-plan ranking combines quality issues (warnings/blockers) with script heuristics and should be used before manual regenerate loops.
- Auto-improve loop has hard stop conditions (`target-reached`, `max-steps`, `stalled`, `sections-exhausted`) to prevent mindless iteration.
- If auto-rerender is enabled, auto-improve can switch active work to a new versioned rerender job immediately after reaching thresholds.
- Auto-promote does not bypass ranking/pin logic; it only executes when the rerendered version is the current recommendation winner.
- Startup/watchdog pass now evaluates any pending auto-promote rerenders not finalized in prior runs and writes audit entries.

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
- `buildFeatureEvidencePlan()` is now the canonical way to derive slot-level feature constraints. Reuse it in scriptgen, fallback, and guard to avoid drift.
- Pass `domainPack.id` into `buildFeatureEvidencePlan()` for sparse pages; pack-aware fallback names significantly improve feature relevance.
- If scripts feel generic, inspect `quality.grounding.coverage` first; low coverage usually means weak source extraction or over-aggressive prompt edits.
- Feature scene visuals are now pack-driven. If a pack looks off, start in `src/scenes/FeatureDemo.tsx` (`DOMAIN_VISUAL_THEMES` + `selectMockup`) before touching pipeline prompts.
- Feature naming is now canonicalized in `grounding.ts`; avoid adding ad-hoc name cleanup logic inside scriptgen/autofix.
- Avoid aggressive substring connector stripping in token cleanup; it can corrupt domain words (`customer` -> `cus`) and poison feature names.
- Sparse pages need a special-case allowance for high-quality fallback labels when phrase candidates are empty.
- Use `canonicalizeIntegrations()` everywhere integrations are mutated. Mixing raw + canonical tool names increases false warnings.
- Render relevance guard runs post-generation. If you need raw model behavior for debugging, run with `--no-relevance-guard`.
- Guard may be intentionally skipped if it regresses quality gates; check `quality.relevanceGuard` in output JSON for rollback details.
- Keep fallback hooks grounding-aware. When model calls fail, generic hooks become a major relevance regression vector.
- `autoFixScriptQuality()` now safely handles sparse/partial narration arrays during sanitization (no crash on undefined segment holes).

## Real Benchmarking

- `npm run eval:real -- --limit=N` is the fastest way to track real-domain pack drift and script quality together.
- Use `npm run eval:real:smoke` for CI: it runs a stable multi-pack subset and enforces threshold gates.
- Use `npm run eval:customer:core` as the primary business-quality gate for model tuning work.
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

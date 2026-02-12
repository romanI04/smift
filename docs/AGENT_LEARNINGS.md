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

## Known Gaps / Next Work

- Better brand-name extraction for titles with separators (e.g. `Linear – Plan and build products`).
- Add dedicated retry backoff policy per TTS engine + transient network errors.
- Add persistent queue backend (SQLite/Redis) for crash recovery.
- Add auth/quotas before exposing self-serve runner beyond localhost.
- Add a renderless "quality-only" output mode in server responses for fast triage.

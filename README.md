# smift

URL-first product intro video generator.

Paste a URL, generate a structured script with quality checks, produce narration, and render a launch-style video.

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
- `npm run serve`: local self-serve queue + web UI (`http://localhost:3030`)

## Useful Flags (`generate`)

- `--voice=none|openai|elevenlabs|chatterbox`
- `--quality=draft|yc`
- `--template=auto|yc-saas|product-demo|founder-story`
- `--voice-mode=single|segmented`
- `--strict` or `--quality-mode=strict`
- `--min-quality=<n>`
- `--max-warnings=<n>`
- `--max-script-attempts=<n>`
- `--allow-low-quality`
- `--no-autofix`
- `--skip-render`

## Outputs

Generated artifacts land in `out/`:

- `<name>-script.json`
- `<name>-quality.json`
- `<name>-job.json` (run manifest)
- `<name>-voice.mp3` (if voice enabled)
- `<name>.mp4` (if render enabled)
- `eval-summary-*.json` + `.csv` (batch eval)

## Docs

- `docs/MILESTONES.md`: sprint milestone log
- `docs/AGENT_LEARNINGS.md`: implementation notes and known traps for future agents

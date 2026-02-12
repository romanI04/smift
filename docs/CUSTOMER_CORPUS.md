# Customer Corpus

## Purpose

This corpus defines the real customer-style URL set we optimize against while building V1.
It prevents ad-hoc tuning and keeps engine work tied to likely paying users.

Source of truth file:
- `src/pipeline/benchmark-customer-urls.ts`

## Segments

1. `core-icp`
- Startup/SMB devtools + B2B SaaS + ecommerce growth tooling.
- This is the first paying wedge.

2. `adjacent-icp`
- Fintech and creator tool companies.
- Expansion segment after core quality is stable.

3. `stress`
- Challenging domains (blocked/challenge pages, ambiguous content).
- Used to test robustness and fallback behavior.

## Operational Commands

- Full customer set:
  - `npm run eval:customer`
- Core paying segment only:
  - `npm run eval:customer:core`

## Current Baseline (2026-02-12)

- `eval:customer`:
  - pack accuracy: `87.1%` (`27/31`)
  - quality pass: `100%` (`31/31`)
- `eval:customer:core`:
  - pack accuracy: `95.2%` (`20/21`)
  - quality pass: `100%` (`21/21`)

## Decision Rule

- Core ICP metric is the primary optimization target.
- Adjacent/stress regressions are allowed short-term only if core ICP improves and no severe relevance failure appears.

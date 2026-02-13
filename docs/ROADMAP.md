# Product Roadmap

## 1) Product Definition

### Target User (V1)
- Solo founders and small startup teams.
- They need a launch/demo-style product video from a URL with minimal effort.
- They care about speed and relevance more than deep customization.

### Core Promise
- Paste URL.
- Get a relevant 35-45s video draft.
- Make small edits.
- Export and publish.

### Why Customers Pay
- Saves hours per video.
- Produces materially better first draft than generic template tools.
- Works reliably across common startup website types.

## 2) Paid-Ready Definition (V1)

V1 is "paid-ready" only when all are true:

1. Engine Quality
- Real-domain pack accuracy >= 90% on benchmark set.
- Quality pass rate >= 90% on benchmark set.
- Off-domain visual/content errors <= 5%.

2. Reliability
- URL -> script success >= 97%.
- URL -> render success >= 95% (with supported voice mode).
- Median generation time <= 3 min in draft quality.

3. UX
- User can review/edit script before render.
- User can rerender from edited script without re-scraping.
- Clear quality warnings shown before export.

4. Commercial Basics
- Authentication.
- Billing with usage limits.
- Basic support channel + error logging.

## 3) Execution Phases

### Phase A - Engine Excellence (Current Priority)
Goal: Make output feel consistently "native" to the source product.

Scope:
- Blocked/anti-bot page detection + fallback scraping strategy.
- Better sparse-page extraction and feature grounding.
- Stronger hook quality (first 5 seconds).
- Domain pack coverage tuning with measured regressions.
- Maintain customer corpus and optimize primarily on `core-icp`.

Exit gates:
- `eval:real:smoke` stays >= 95% quality pass and >= 95% pack accuracy.
- `eval:real --limit=20` stays >= 90% quality pass and >= 90% pack accuracy.
- `eval:customer:core` stays >= 90% quality pass and >= 90% pack accuracy.
- Manual review of 20 URLs: <= 1 major relevance failure.

### Phase B - Product Workflow
Goal: User can reliably go from URL to publishable draft in one session.

Scope:
- Script editor screen (hook, features, CTA, narration).
- "Regenerate section" controls (hook only, feature 2 only, etc.).
- Render options presets and retry UX.
- Download + share-ready output.

Exit gates:
- 80% of test users can produce acceptable output without developer help.
- Median time from URL to export <= 8 minutes.

### Phase C - Paid Beta
Goal: First real customers pay and keep using.

Scope:
- Auth + billing + credits.
- Project history + artifact persistence.
- Usage analytics and failure monitoring.
- Onboarding for top 2-3 ICP domains.

Exit gates:
- 5-10 paying beta users.
- Week-2 retention >= 40%.
- Refund/churn reasons mostly non-quality-related.

### Phase D - Scale + Expansion
Goal: Expand domains and improve margins.

Scope:
- More domain packs and fallback templates.
- Better rendering throughput/cost controls.
- Team features and collaboration.

## 4) Immediate Step-by-Step Plan (Next 10 Workdays)

1. Implement blocked-page classifier in scraper.
2. Add fallback extraction path for blocked pages (metadata-first + structured hints).
3. Add blocked-page fixtures + eval tests.
4. Improve first-5-second hook generator with source-grounded hook patterns.
5. Add hook quality rubric and penalties in scorer.
6. Implement script section regeneration API.
7. Add minimal script edit UI for hook/features/CTA.
8. Add rerender-from-edited-script flow.
9. Run 20-URL manual QA and log failures.
10. Patch top 3 failure classes and rerun benchmarks.

### Execution Status

- Completed:
  - Step 1: blocked-page classifier in scraper.
  - Step 2: metadata-first fallback extraction for blocked pages.
  - Step 3: blocked-page fixtures + scraper eval runner.
  - Step 4: first-5-second hook grounding improvements.
  - Step 5: hook quality rubric and scoring penalties.
  - Step 6: script section regeneration API.
- Next up:
  - Step 7: minimal script edit UI flow.

## 5) Non-Negotiable Prioritization Rules

1. Engine quality before hosting polish.
2. Every task must map to one of the paid-ready gates.
3. No infra-only work unless it unblocks user-visible quality or reliability.
4. Every meaningful change must pass benchmark checks before merge.

## 6) What You Need To Do

Minimal and simple:
- Provide 10-20 representative customer URLs.
- Review 5 generated videos per week and mark only:
  - "relevant"
  - "partly relevant"
  - "off-target"
- I handle the rest of the implementation path.

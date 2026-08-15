# Project status

## Release candidate

- Version: `v0.2.0`
- Branch: `codex/next-meaningful-release`
- Product boundary: one stationary machine and writing desk; no walking, accounts, or public board
- Standalone build: one self-contained HTML file that opens directly from disk
- Hosting: GitHub Pages continues to deploy from `main`; this branch is not live until merged

## Completed release work

- Replaced the collision-prone solid front apron with an open keyboard bay, low front rail, rear shoulders, and low side sills.
- Added the missing Backquote/tilde key and exhaustive mapping for all 47 printable US-QWERTY keys and 94 characters.
- Added deterministic swept-clearance checks for every key top and 52 immediate/edge neighbor pairs.
- Rebuilt input scheduling so key feedback is immediate while physical impacts remain ordered and only one typebar occupies the print point at a time.
- Replaced full paper-texture uploads per character with small dirty-region uploads.
- Added crash-safe, page-addressed paper storage plus visible release, filing, crumpling, discard, recovery, reinsertion, and fresh-feed rituals.
- Added a stationary Philadelphia room, early-evening lighting, live rain/snow, independent paper/room/weather audio, and optional unease.
- Added a one-draw-call room fallback so atmosphere does not steal the machine's timing budget.
- Constrained camera movement to writer, mechanism, ribbon, carriage, paper, and inspection views.
- Added reduced-motion propagation, mobile input, exact text/PNG exports, and direct-file recovery checks.

## Verified release gates

- `79` unit tests pass across document, machine, geometry, paper state/view/storage, mechanical audio, room state/view/backdrop, and atmosphere audio, including monotonic scheduler-time and idle-reservation regressions.
- A simulated 15/60/120-minute writing test completes with empty transient queues, bounded latency history, and exact action counts.
- A real-browser 44-key burst always gates exact input order, 44 completed actions, immediate queue-to-feedback response, an empty final queue, and 36 ink impressions. Wall-clock start and impact limits are enforced when the runner sustains a trustworthy render cadence; transient peak queue depth remains diagnostic because browser automation can batch otherwise timely key delivery. A reference local run measured `0.7 ms` p95 queue-to-feedback, `50.5 ms` p95 physical impact, and a peak queue depth of `1`.
- Mechanics timing is gated independently at a deterministic 12 ms input cadence and 4 ms simulation step, including one typebar at the print point, exact impact order, an empty final queue, and p95 simulated impact at or below `125 ms`. Full-scene rendering is gated separately.
- Exhaustive unit checks cover every printable key/character; real browser input covers Backquote and all four rows plus Tab, Backspace, independent Shift, return, red ribbon, mobile input, and focus recovery.
- Minimum swept key-to-shell clearance measured `+0.0677`; the minimum across 52 neighboring pairs measured `+0.0350`; Equal/Backspace measured `+0.0450`.
- A 5 MiB quota test stored 25 completely full 65×46 pages at a `3,685,956`-byte transactional peak and wrote only one page blob on the final checkpoint.
- Stale-tab writes are rejected before mutation; quota, corruption, missing-page, journal recovery, and animation-abort/resync paths are covered.
- Partial paper uploads used `152,988` bytes across the typing sample versus a `3,053,568`-byte full texture.
- TXT and PNG downloads matched the live document; the PNG was byte-for-byte identical to the full-resolution paper canvas.
- File-based offline loading, typing, persistence, zero external requests, and the WebGL-disabled fallback passed.
- Reloads during extraction and durable filing reconstructed the exact page decision; default-medium and high-quality smoke checks passed.
- The complete 11-view visual matrix passed for intro, writer, typed paper, inspection, loose paper, manuscript, discard, rain, snow, field guide, and mobile.

## Intentional limits

- Meridian No. 88 is a mechanically coherent fictional composite, not a licensed one-to-one replica of a specific historic brand.
- Machine and atmosphere sounds are procedural; an instrumented recording session with restored physical machines remains a future authenticity upgrade.
- Accounts, public posting, restoration workbench tasks, and additional machine models remain deliberately deferred.

## Recommended next step

Review the release candidate with Philadelphia typists and repairers, capture their mechanical and acoustic notes, then merge and publish `v0.2.0` when that human authenticity review is satisfactory.

# Project status

Last reviewed: 2026-08-30

## Active development

- Package baseline: `v0.2.0`; the next release version has not been assigned
- Branch: `codex/octoberline-phases-0-5`
- Active scope: roadmap Phases 0–5
- Product boundary: one stationary machine and writing desk; no walking or avatar
- Standalone build: one self-contained HTML file that opens directly from disk
- Hosting: GitHub Pages continues to deploy from `main`; this branch is not live until merged and deployed
- Legacy infrastructure: the actual GitHub remote and Pages address still use
  `meridian-no-88-typewriter`; no replacement remote has been created
- Approval gate: the Carbon Mark and Quiet Desk at Dusk homepage are approved;
  commit, push, merge, and publication remain separate release actions

The durable phase board and acceptance criteria live in [docs/ROADMAP.md](docs/ROADMAP.md).

## Integrated branch status

- Phase 0: brand metadata, roadmap, documentation, packaging, and the integrated
  verification gate are complete. Commit, push, merge, and deployment remain gated.
- Phase 1: the approved Carbon Mark and Quiet Desk at Dusk composition are live.
  Entry stays silent, previews one modeled key, offers the mechanics guide, and
  glides from the responsive desk/window composition into the stable Front view.
- Phase 2: Quiet Writing Mode, input state, compact mobile views and mechanics,
  atmosphere pause, coordinated layers, and first-sheet onboarding are implemented.
- Phase 3: draggable margins, configurable tab stops, and Light/Medium/Heavy
  calibrated touch are implemented and browser-tested.
- Phase 4: the thumbnail paper desk, multi-sheet selection, image formats,
  carbon-copy rendering, and native Print / Save PDF flow are implemented.
- Phase 5: authored seasonal presets and the multi-depth exterior are implemented;
  a real Philadelphia typist/repairer review and permissioned recordings remain open.
- Phases 6–7: detailed, responsive, non-functional coming-soon pages are packaged;
  accounts, cloud sync, publishing, privacy, and moderation remain deferred.

## Completed baseline work

- Replaced the collision-prone solid front apron with an open keyboard bay, low front rail, rear shoulders, and low side sills.
- Added the missing Backquote/tilde key and exhaustive mapping for all 47 printable US-QWERTY keys and 94 characters.
- Added deterministic swept-clearance checks for every key top and 52 immediate/edge neighbor pairs.
- Rebuilt input scheduling so key feedback is immediate while physical impacts remain ordered and only one typebar occupies the print point at a time.
- Replaced full paper-texture uploads per character with small dirty-region uploads.
- Added crash-safe, page-addressed paper storage plus visible release, filing, crumpling, discard, recovery, reinsertion, and fresh-feed rituals.
- Added a stationary Philadelphia room, early-evening lighting, live rain/snow, an original procedural PECO Building with animated Crown Lights, independent paper/room/weather audio, and optional unease.
- Added a one-draw-call room fallback so atmosphere does not steal the machine's timing budget.
- Constrained camera movement to writer, mechanism, ribbon, carriage, paper, and inspection views.
- Added reduced-motion propagation, mobile input, exact text/PNG exports, and direct-file recovery checks.
- Added a centered wide Front view, readable atmosphere controls, and coordinated Guide, Weather, Audio, Document, camera, and inspection states so interaction surfaces no longer stack or reappear unexpectedly.

## Current integrated verification

`npm run verify` passed on 2026-08-30 against the final approved working tree.
The evidence below covers the live homepage, integrated Phases 1–5
implementation, and the Phase 6–7 previews.

- `115` unit tests pass across brand metadata, document, machine, geometry,
  paper lifecycle/view/storage/export, mechanical audio, room state/view/backdrop,
  and atmosphere audio.
- A simulated 15/60/120-minute writing test completes with empty transient queues, bounded latency history, and exact action counts.
- A real-browser 44-key burst gated exact order and completion with an empty final
  queue. The current run measured `1.8 ms` p95 queue-to-feedback, `70.3 ms` p95
  physical impact, and a peak queue depth of `2` at an observed 28 FPS.
- Mechanics timing is gated independently at a deterministic 12 ms input cadence and 4 ms simulation step, including one typebar at the print point, exact impact order, an empty final queue, and p95 simulated impact at or below `125 ms`. Full-scene rendering is gated separately.
- Exhaustive unit checks cover every printable key/character; real browser input covers Backquote and all four rows plus Tab, Backspace, independent Shift, return, red ribbon, mobile input, and focus recovery.
- Minimum swept key-to-shell clearance measured `+0.0677`; the minimum across 52 neighboring pairs measured `+0.0350`; Equal/Backspace measured `+0.0450`.
- A 5 MiB quota test stored 25 completely full 65×46 pages at a `3,685,956`-byte transactional peak and wrote only one page blob on the final checkpoint.
- Stale-tab writes are rejected before mutation; quota, corruption, missing-page, journal recovery, and animation-abort/resync paths are covered.
- Partial paper uploads used `152,988` bytes across the typing sample versus a `3,053,568`-byte full texture.
- TXT and PNG downloads matched the live document; selected paper also downloaded
  as PNG, JPEG, WebP, and carbon-copy output, and the native print view opened.
- File-based offline loading, typing, persistence, zero external requests, and the WebGL-disabled fallback passed.
- Reloads during extraction and durable filing reconstructed the exact page decision;
  default-medium and high-quality atmosphere smoke checks passed.
- Quiet-mode timing, tutorial focus recovery, physical margin dragging and lost
  capture, mobile modal/no-paper guards, corrupt touch-preset fallback, and a
  41-sheet paper desk passed in Chromium: all cards became interactive in `820 ms`,
  all thumbnails subsequently painted, and the cache settled at its 32-item cap.
- The approved landing passed desktop/mobile/reduced-motion checks: background
  controls stay inert and visually absent, hover/focus previews a real key without
  ink or audio, the mechanics guide restores focus, and entry lands on Front view.
- Direct-file loading typed and restored text with zero external requests; the
  WebGL-disabled fallback remained readable.
- The standalone `dist/Octoberline-211-Typewriter.html` is `1,130,048` bytes with
  SHA-256 `f2eaef800871710e98d391b2e931869aa524cfd642b4f8ef8cd9a667248e7634`.
- The deterministic `dist/Octoberline-211-Web-Experience.zip` contains 20 entries,
  is `1,127,771` bytes, and has SHA-256
  `ae9e2478abf2315b1c1d64fbcfd17e7fb8f6501c0833773f2193f9022ec07578`.
- The complete 15-view simulator matrix and the desktop/mobile/reduced-motion
  checks for both Phase 6 and Phase 7 coming-soon pages passed.

## Intentional limits

- Octoberline 211 is a mechanically coherent fictional composite, not a licensed one-to-one replica of a specific historic brand.
- Machine and atmosphere sounds are procedural; an instrumented recording session with restored physical machines remains a future authenticity upgrade.
- Accounts, cloud sync, public posting, moderation, restoration workbench tasks,
  and additional machine models remain deliberately deferred. Coming-soon pages
  for Phases 6–7 are product previews, not working services.

## Release sequence

The identity and homepage approval gates are fulfilled. After the complete suite
passes on the final tree, the remaining release actions are commit, push, merge,
and publication; none is implied by local verification. A Philadelphia
typist/repairer review remains an open Phase 5 authenticity gate and must not be
claimed in advance.

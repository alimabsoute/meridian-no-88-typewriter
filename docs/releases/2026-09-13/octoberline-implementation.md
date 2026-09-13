# Octoberline 211 — living Philadelphia update

Implemented in an isolated development branch. The public website has not been replaced.

## What changed

- A wider, dimensional bay window and Philadelphia-inspired skyline with PECO, Liberty Place, Comcast forms, rowhouses, and street detail.
- The PECO crown retains its animated lettering, now mapped to two building faces. Its messages are authored animation, not a live PECO feed.
- Changing office lights, passing street traffic, pedestrians, wind-driven foliage, and falling leaves that settle and skid along the ground. The leaf pool remains bounded.
- Six compact toolbar sections—Paper, Machine, Room, View, Ink, Export—retain the existing controls in one panel at a time, with readable labels and mobile layouts.
- Richer enamel, metal, key surfaces, and ribbon texture; paper fibers, thin sheet edges, restrained curl, handling creases, and a damped response to typing and carriage movement.
- Revised Writer and Front framing keeps the skyline visible. Reduced-motion and atmosphere-pause behavior remain available.

The skyline is an artistic Philadelphia composition, not a geographically surveyed view. The implementation uses rendered 3D geometry; the earlier concept illustration is a separate art-direction image.

## Compatibility

The existing document model, archive storage keys, mechanical command scheduling, ribbon modes, and export formats remain in place. No new dependency, database, account, or storage migration is required.

## Review

Open `Octoberline-211-Typewriter.html` in Chrome or Edge for the standalone version. The web ZIP includes the application and the existing companion preview pages.

## Verification — September 12, 2026

- All 126 unit cases passed across the full run and an isolated rerun of one archive stress case. The initial run had 125 passes and one 30-second timeout; that unchanged stress case passed in 21.2 seconds when rerun alone.
- The final room suite passed all five cases after the graphics-buffer cleanup fix, including disposal, quality tiers, reduced motion, PECO lettering, and bounded falling leaves.
- Full browser interaction suite passed: keyboard mechanics, ink, text/image exports, sheet extraction, filing, reinsertion, fresh paper, crumpling, recovery, persistence, mobile typing, storage failure handling, and quality tiers.
- Release UI passed: physical margin dragging, keyboard focus, Quiet Mode, audio and weather controls, image formats, PDF opening, and mobile input guards.
- Workbench checks passed at 1280×800 and 390×844: all six panels, original control availability, one-panel behavior, screen bounds, and Escape focus return.
- A focused restore → reinsert → reopen → fresh sheet → typing regression passed. Earlier full-run automation timeouts did not recur in the isolated full rerun; no matching functional defect was reproduced.
- A 41-sheet archive panel rendered in 336 milliseconds, below the existing 1,500-millisecond limit.

- All 15 rendered-view scenarios passed their assertions, covering intro, reduced motion, Writer, Front, PECO, typed and handled paper, rain, snow, guide, and mobile. Manual screenshot review additionally caught a Paper panel obscuring the physical sheet; the desktop panel was moved to the right. The final workbench checks and five targeted visual rechecks passed after this fix and the key-finish adjustment. The released sheet is visibly unobscured and its controls remain accessible.
- The production build and release-package integrity checks passed.

- Performance checks passed: the room uses 109 visible drawable objects and three lights within the dimensional-scene budget. Room updates averaged 0.686 milliseconds over 600 iterations, within the unchanged 0.75-millisecond CPU limit. The headless browser measured 14 FPS with the snow scene and 16 FPS with the room hidden. These are measurements from this test environment, not a smooth-motion guarantee for every device; the noisy CPU-overhead comparison should not be interpreted as the city making rendering faster.

- Standalone offline checks passed: exact typed text survived reload, zero external requests were made, and disabling WebGL showed the expected fallback without starting the simulator.

The key finish was compared in actual rendered closeups and softened to reduce glare. Browser automation verifies input, document state, rendered images, and audio control/graph behavior; it does not establish subjective sound quality or performance on every device. The unchanged companion preview pages were included and checked for package integrity, but their separate browser suites were not rerun.

## Source and release

The source patch is based on commit `c473286` and contains the implementation and regression checks. The work is preserved on branch `codex/philadelphia-living-room`; the original checkout and production website were not replaced.

The standalone HTML SHA-256 is `996a69057c29b4eeaadab4e57282e134230f5bcb1b5fe0df40b6b490c8a06039`. The accompanying release manifest records both downloadable package hashes.

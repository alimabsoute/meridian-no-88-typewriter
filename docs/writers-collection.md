# Writers collection and room detail views

The supplied September 20 artwork is preserved under `public/media/room-art/` with original-file hashes in `SOURCES.md`. Four book faces share one image through UV cropping. The painting's existing ornamental frame is carried around a shallow 3D case. The console, LOVE sculpture, bottle and hollow faceted tumblers use static merged geometry.

Collection budget: 12 material batches, 4,566 triangles before shadow rendering, two image downloads totaling approximately 5.37 MB, no additional lights, no per-frame collection updates, and no transmission pass. This is a structural budget, not a measured frame-rate guarantee. The tumblers are opaque reflective approximations; they do not refract the scene.

## Controls

Use View → Front for a centered machine view; Room keeps the full composition. Scroll or pinch to move the camera closer. TV and Books & Art allow close zoom plus right-button/two-finger panning. Mechanism inspection still enables rotation. Camera navigation no longer requires opening the machine shell. The existing quality=low option remains explicitly DPR1; omit it to inspect at native display resolution, capped at2.

## Verification

Native camera tests cover zoom state, portrait framing, navigation reset and touch tap/pinch arbitration. Room geometry tests cover budgets, placement, shared image loading and disposal. Television projection tests cover eight viewport sizes and video controls. Existing black/red coverage shader and paper mipmap filtering remain unchanged.

Before release, render the full app in a working browser: compare Front near/macro to Writer, black and red ink, book/painting texture clarity and LOVE silhouette. Check real wheel and pinch input without accidental typing, TV alignment, volume/power and frame-time impact. The September22 environment could not complete this rendered check: browser connectors unavailable and standalone browser launch denied with spawn EPERM. A native unminified build is not evidence for the normal production minifier or GPU appearance.

## September 23 placement and loading correction

Painting and console now share right-wall center x=12.6 and fit within the 10.2..15 wall strip; the LOVE sculpture retains its desk position. TV grows to 8.1 units wide, centered x=-10.4 on the left wall. Wall extensions and an opaque floor close exposed skyline gaps. Basket base is [10.35,-1.15,-1.8], outside the desk; discard targets follow it.

Artwork uses root-relative URLs, retries failed requests twice, and reports loading status instead of silently swallowing errors. Both original PNGs rendered on two fresh browser loads and the Books & Art close-up on September23. This verifies current loading; the prior intermittent failure was not reproduced. Geometry budgets remain bounded; no new image assets, lights, transmission or per-frame collection processing.

## LOVE paperweight and balance pass

LOVE now uses the same beveled geometry at45% scale, with feet centered over the manuscript tray. PaperLifecycleView owns its pose; decor retains resource ownership. Keeping a page runs a1.8-second lift, slide and settle sequence. Stack restoration and failure recovery reset its resting height. Reduced motion completes in one update. An automatic filing camera frames the action responsively, and the panel closes to expose the scene.

The lamp is48% size and tucked back to[-6.5,.085,-3.4]. Painting and console share center x13.8, shifted1.2units right from the prior arrangement; the close-up camera follows. The original sculpture is not duplicated and no new rendering passes or downloaded assets are introduced.

## Marked screenshot placement

Painting now7.5 units wide, center[14.6,6.3,-5.79], preserving image aspect; console center14.6 directly beneath. Lamp moved to[-8,.085,-3.7]; basket[12,-1.15,-.6] clears desk and console. Art has its own transform so enlarging it does not distort furniture. Two additional static material batches, no new geometry complexity/assets/lights. Books & Art camera refitted for taller composition.

# Octoberline 211 — Active release contract

- Status: Phases 0–5 implemented and verified; Carbon Mark and homepage approved; publication pending
- Package baseline: `v0.2.0`; next release version not yet assigned
- Detailed board: [ROADMAP.md](ROADMAP.md)

## Product contract

Typewriter fidelity is the product. Atmosphere frames it. The writer remains
seated at one Philadelphia desk; there is no walking, avatar, exploration,
account system, cloud sync, or public posting in this release. Phases 6 and 7
may have clearly labeled coming-soon previews, but those previews do not collect
user data and are not working platform features.

The release contains:

- one beautiful, mechanically coherent Octoberline 211;
- a user-approved Octoberline 211 logo or wordmark and Quiet Desk at Dusk homepage;
- immediate physical-keyboard correspondence without a growing animation lag;
- corrected casing with no keys or key hardware protruding through the front;
- causal key, linkage, typebar, ribbon, impression, escapement, and carriage motion;
- authentic Backspace, Space, Shift, Shift Lock, margins, bell, return, and paper feed;
- a physical page lifecycle: extract, inspect, keep, crumple, discard, recover, and load;
- locally persistent manuscripts, desk state, and emergency text/image export;
- a stationary Philadelphia rowhouse writing room;
- authored clear dusk, autumn wind, steady rain, first snow, and nor'easter atmosphere;
- Quiet Writing Mode, persistent input state, atmosphere pause, accessible onboarding,
  and a compact mobile view selector;
- adjustable margin and tab stops plus Light, Medium, and Heavy touch calibration;
- a thumbnail-based paper desk and faithful text, image, PDF, and carbon-copy exports;
- clearly labeled, non-functional coming-soon pages for community profiles and the
  future public writing board;
- a self-contained HTML build that continues to open directly from disk.

## Approval gates

- The user approved the Carbon Mark on 2026-08-29.
- The user approved the Quiet Desk at Dusk composition and entry direction on 2026-08-29.
- Neither approval is inferred from implementation, test success, or a preview.
- Phase 5 human authenticity review is recorded only after Philadelphia typists
  or repairers actually provide feedback.

## Responsiveness gates

- A mapped key begins visible motion no later than the next rendered frame.
- Input bursts do not create a growing delay before key motion begins.
- Ink appears only at typebar impact, followed by escapement and carriage advance.
- Printable characters are never dropped, duplicated, or reordered.
- Environment quality scales down before typewriter timing is degraded.
- Fifteen-, sixty-, and 120-minute simulated sessions keep command queues,
  active mechanics, latency history, and transient state strictly bounded;
  rendering/resource cleanup and paper-motion failure paths are checked separately.

## Mechanical gates

- Every printable keyboard key maps to its matching physical key and typebar.
- The key lever, connecting link, typebar, ribbon vibrator, and escapement form a
  visibly causal chain.
- Space advances without printing; Backspace moves backward without erasing.
- Shift uses one coherent basket-shift design and each physical Shift key moves independently.
- The carriage stops at the margin; the bell warns before the stop; no automatic wrap occurs.
- Return moves the carriage and rotates the platen/paper by the selected line spacing.
- Ribbon travel, spool winding, color selection, and reversal remain mechanically legible.
- Paper stays constrained by the platen, feed rollers, bail rollers, and guides.
- Left and right margins and tab stops are adjustable through their physical controls.
- Touch calibration changes travel, timing, impression, and sound as one coherent
  setting without allowing an input backlog to grow.

## Visual gates

- No keycap, ring, stem, linkage, or control intersects the front apron in Writer view.
- Writer view keeps every key legend and the active print line legible.
- Inspection view reveals mechanisms without making the shell look unfinished.
- Materials read as restored enamel, steel, rubber, brass, fabric ribbon, wood, and paper.
- The Philadelphia room is visible but subordinate to the machine.
- Rain and snow read clearly through the sash window without obscuring the exterior.
- UI remains restrained, keyboard accessible, responsive, and usable with reduced motion.
- The homepage uses the live room, not stock video, and its decorative motion is
  irregular rather than a visibly synchronized loop.
- Reduced-motion mode replaces decorative environmental movement with a static
  composition and short crossfade.

## Paper gates

- A page can be removed early or at the bottom margin without losing marks.
- Keeping a page places it in a visible manuscript stack and durable local archive.
- Crumpling requires a deliberate hold and produces staged deformation.
- A discarded page remains recoverable until the wastebasket is permanently emptied.
- A fresh sheet visibly feeds around the platen before typing resumes.
- Closing during a paper animation cannot lose the page or manuscript decision.
- Exported text and paper images preserve the underlying writing and impression state.
- The paper desk exposes Loaded, Loose, Filed, and Discarded sheets as accessible,
  selectable thumbnails.
- Print-ready PDF and carbon-copy exports preserve overstrikes, margins, line spacing,
  and uneven impressions.
- Twenty-five fully marked pages remain below a 5 MiB storage budget, and an
  idle checkpoint writes only the active page plus its compact manifest.
- A stale second tab cannot overwrite a newer archive revision.

## Atmosphere gates

- Available authored presets: Clear Dusk, Autumn Wind, Steady Rain, First Snow,
  and Nor'easter.
- Unease is separate: Off, Subtle, and Unsettling.
- Weather, room, machine, and paper audio have independent controls.
- Atmosphere can be paused without stopping typewriter or paper mechanics.
- No jump scares, manuscript-content analysis, camera shake while typing, or forced story events.
- The home sequence uses the live room and settles directly into the stable Front view.

## Deferred platform boundary

- Community machine profiles remain a coming-soon concept until attribution,
  permissions, correction, reporting, accessibility, and deletion flows exist.
- Accounts and the public board remain a coming-soon concept until private-by-default
  storage, explicit publishing, moderation, abuse prevention, recovery, export,
  and deletion pass security and privacy review.
- Coming-soon pages must not imply that registration, uploading, posting, or cloud
  persistence currently works.

## Verification matrix

- Unit tests for brand metadata, document, manuscript, lifecycle, adjustable controls,
  touch calibration, weather helpers, and serialization.
- Browser tests for rapid typing, correspondence, focus recovery, special keys,
  page lifecycle, persistence, weather controls, reduced motion, and exports.
- Screenshot checks for the approved homepage, Writer, wide Front, Quiet Writing,
  first-sheet tutorial, typed page, Inspection, paper desk, page handling, kept
  manuscript, crumpled discard, each authored atmosphere, mobile, and both coming-soon pages.
- Instrumented renderer-isolated browser checks always enforce exact order, completion, an empty final queue, queue-to-feedback response, and ink impressions. Wall-clock start and impact limits apply only when the measured burst contains at least 20 frames with p95 frame time at or below `50 ms` and no frame above `100 ms`; transient peak queue depth is reported diagnostically because browser automation can batch timely key delivery. Deterministic kernel mechanics and full-scene rendering remain independent, unconditional gates.
- Desktop, narrow viewport, direct-file, WebGL-disabled, and quality-fallback checks.
- Clean production build and a final manual visual review at full resolution.

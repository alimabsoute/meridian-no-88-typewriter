# Meridian No. 88 — Next Meaningful Release

## Product contract

Typewriter fidelity is the product. Atmosphere frames it. The writer remains
seated at one Philadelphia desk; there is no walking, avatar, exploration,
account system, or public posting in this release.

The release contains:

- one beautiful, mechanically coherent Meridian No. 88;
- immediate physical-keyboard correspondence without a growing animation lag;
- corrected casing with no keys or key hardware protruding through the front;
- causal key, linkage, typebar, ribbon, impression, escapement, and carriage motion;
- authentic Backspace, Space, Shift, Shift Lock, margins, bell, return, and paper feed;
- a physical page lifecycle: extract, inspect, keep, crumple, discard, recover, and load;
- locally persistent manuscripts, desk state, and emergency text/image export;
- a stationary Philadelphia rowhouse writing room;
- quiet, rain, snow, and nor'easter atmosphere with independently adjustable unease;
- a self-contained HTML build that continues to open directly from disk.

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

## Visual gates

- No keycap, ring, stem, linkage, or control intersects the front apron in Writer view.
- Writer view keeps every key legend and the active print line legible.
- Inspection view reveals mechanisms without making the shell look unfinished.
- Materials read as restored enamel, steel, rubber, brass, fabric ribbon, wood, and paper.
- The Philadelphia room is visible but subordinate to the machine.
- Rain and snow read clearly through the sash window without obscuring the exterior.
- UI remains restrained, keyboard accessible, responsive, and usable with reduced motion.

## Paper gates

- A page can be removed early or at the bottom margin without losing marks.
- Keeping a page places it in a visible manuscript stack and durable local archive.
- Crumpling requires a deliberate hold and produces staged deformation.
- A discarded page remains recoverable until the wastebasket is permanently emptied.
- A fresh sheet visibly feeds around the platen before typing resumes.
- Closing during a paper animation cannot lose the page or manuscript decision.
- Exported text and paper images preserve the underlying writing and impression state.
- Twenty-five fully marked pages remain below a 5 MiB storage budget, and an
  idle checkpoint writes only the active page plus its compact manifest.
- A stale second tab cannot overwrite a newer archive revision.

## Atmosphere gates

- Available weather: Quiet, Rain, Snow, and Nor'easter.
- Unease is separate: Off, Subtle, and Unsettling.
- Weather, room, machine, and paper audio have independent controls.
- No jump scares, manuscript-content analysis, camera shake while typing, or forced story events.
- The home sequence uses the live room and settles directly into the stable Writer view.

## Verification matrix

- Unit tests for document, manuscript, lifecycle, weather helpers, and serialization.
- Browser tests for rapid typing, correspondence, focus recovery, special keys,
  page lifecycle, persistence, weather controls, reduced motion, and exports.
- Screenshot checks for intro, Writer, typed page, Inspection, page handling,
  kept manuscript, crumpled discard, rain, and snow.
- Instrumented latency and burst checks with timestamps from input through impact.
- Desktop, narrow viewport, direct-file, WebGL-disabled, and quality-fallback checks.
- Clean production build and a final manual visual review at full resolution.

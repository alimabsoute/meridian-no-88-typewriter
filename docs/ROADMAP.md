# Octoberline 211 roadmap

- Last reviewed: 2026-08-30
- Active branch: `codex/octoberline-phases-0-5`

This is the durable waiting board for Octoberline 211. It separates work that
is being built now from later platform ideas, and it keeps acceptance criteria
beside every phase. A phase moves to **Complete** only after its acceptance gate
has been exercised on the current branch; a visual preview or coming-soon page
does not count as implementation.

## Status at a glance

| Phase | Outcome | Status |
| --- | --- | --- |
| 0 | Safe baseline, consistent identity, and release discipline | Verified; commit/publish gate remains |
| 1 | “The Quiet Desk at Dusk” homepage and approved identity | Complete on active branch; explicitly approved |
| 2 | Writing-first, accessible controls and onboarding | Complete on active branch |
| 3 | Adjustable, responsive mechanical behavior | Complete on active branch |
| 4 | Visual paper desk and faithful exports | Complete on active branch |
| 5 | Authored atmosphere and typewriter-community authenticity | Technical/visual work complete; human authenticity review remains open |
| 6 | Community machine profiles | Coming-soon preview complete; platform deferred |
| 7 | Accounts and public writing board | Coming-soon preview complete; platform deferred |

## Current approval record

- **Identity — approved 2026-08-29:** Carbon Mark; cream title-case
  `Octoberline` in the typewriter face with an orange/ochre `211` and a subtly
  uneven ink impression.
- **Homepage — revision requested 2026-08-29:** retain The Quiet Desk at Dusk,
  but rebuild the exterior window with convincing depth, realism, parallax, and
  multi-plane movement before asking for final composition approval.
- **Homepage — review 02 ready 2026-08-29:** the rebuilt window and approved
  Carbon Mark were presented together in `design-review/`; at that review point,
  the composition had not replaced the active entry screen.
- **Homepage — approved 2026-08-29:** the user approved The Quiet Desk at Dusk.
  The composition now runs over the live 3D room and uses the Carbon Mark,
  responsive PECO window framing, silent modeled-key preview, mechanics guide,
  and direct Front-view entry.

## Phase 0 — Foundation and release safety

**Goal:** preserve the verified simulator before broadening it, and give every
subsequent phase one truthful source of product and release information.

### Work

- [x] Work on a dedicated `codex/octoberline-phases-0-5` branch.
- [x] Create this durable roadmap with explicit status and gates.
- [x] Establish `src/brand.js` as the canonical Octoberline 211 identity module.
- [x] Reuse brand metadata in release packaging and local preview detection.
- [x] Finish consuming the identity module from user-facing app copy, export
  names, and storage declarations without changing existing storage keys.
- [x] Reconcile active documentation with the integrated Phases 2–5 build.
- [x] Run the complete release verification on the integrated branch.
- [ ] Commit, push, and publish only after the user approves the logo and homepage.

### Acceptance gate

- A current checkout can be installed, tested, built, and packaged from the README.
- Existing local manuscripts survive the update without a storage migration.
- Active product copy says Octoberline 211; any remaining Meridian text is
  explicitly labeled as the still-current legacy GitHub repository/Page address.
- The packaged artifact has the canonical Octoberline filename and checksum.
- The full unit, interaction, offline, performance, and visual suites pass.

The integrated gate passed on 2026-08-30: 115 unit tests, release packaging,
mechanical interaction, Phase 1–5 UI, direct-file/offline, performance, the
15-view simulator visual matrix, and both coming-soon browser checks. The same
gate is rerun on the final approved Phase 1 integration before release.

## Phase 1 — The Quiet Desk at Dusk

**Goal:** introduce Octoberline 211 through the real 3D room: literary,
understated, recognizably Philadelphia, and still centered on the machine.

### Work

- [x] Retain the live Three.js writing room, early-evening light, sash window,
  Philadelphia rowhouses, and sound-after-entry behavior.
- [x] Present the approved Octoberline 211 Carbon Mark in the simulator brand system.
- [x] Use the opening message “A room for the next page” with clear primary and
  secondary actions.
- [x] Add **Sit at the Machine** and **See How It Works** journeys.
- [x] Layer an irregular 18–22 second landing-light cycle over independently
  timed live cloud drift, branch sway, and restrained autumn leaves.
- [x] Keep review-only curtain/page CSS out of production; those cues should be
  added later only as real scene objects if they materially improve the room.
- [x] Let pointer or keyboard focus on the primary action depress one modeled key.
- [x] Glide directly into the stable Front camera without delaying input capture.
- [x] Provide a genuinely static, crossfading reduced-motion composition.

### Acceptance gate

- The user explicitly approves the logo/wordmark and homepage composition.
- The intro uses the live room at normal quality and never downloads stock video.
- The scene reads as mostly still; individual ambient events do not loop in unison.
- Keyboard-only users can discover and activate both actions with visible focus.
- Sound starts only after a deliberate entry action.
- Reduced-motion mode freezes decorative environmental motion.

## Phase 2 — Writing-first interface

**Goal:** keep the interface available without letting it compete with the page.

### Work

- [x] Preserve coordinated panels, a centered Front view, mobile text input, and
  an accessible transcript foundation.
- [x] Add Quiet Writing Mode: controls fade during active typing and return on
  pointer movement, focus movement, touch, or `Escape`.
- [x] Add a persistent `READY TO TYPE` / `INPUT RELEASED` state indicator.
- [x] Replace the mobile camera stack with one compact, labeled view menu.
- [x] Add an Atmosphere Pause control independent of typewriter mechanics.
- [x] Turn the existing Field Guide into an optional first-sheet tutorial for
  typing, Shift, margin bell, carriage return, and paper release.

### Acceptance gate

- A first-time visitor can load a sheet, type, return the carriage, and file or
  discard the page without opening external instructions.
- Quiet Writing Mode never hides focused controls or traps keyboard focus.
- `Escape` returns to the stable writing surface from every temporary layer.
- Desktop, narrow mobile, touch, reduced-motion, and 200% zoom checks pass.
- The transcript exposes written content without announcing every animation.

## Phase 3 — Mechanical controls and touch

**Goal:** make adjustments on the physical machine meaningful while preserving
the immediate cause-and-effect that defines the simulator.

### Work

- [x] Preserve existing margin lock, bell, margin release, tab, ribbon selector,
  shift, escapement, carriage return, platen, and paper-feed mechanics.
- [x] Make left and right margin stops draggable on the carriage.
- [x] Add configurable physical tab stops instead of a fixed eight-column interval.
- [x] Add Light, Medium, and Heavy touch calibration.
- [x] Let touch alter key travel, strike timing, impression force, sound weight,
  and restrained machine-body impulse as one coherent setting.
- [x] Keep every modeled control operable with pointer, touch, and keyboard equivalents.

### Acceptance gate

- Visual controls and document state agree after adjustment, reload, and page change.
- No setting can produce dropped, duplicated, reordered, or indefinitely queued input.
- Ink still commits at typebar impact and carriage advance still follows escapement.
- Geometry clearance remains positive through full key travel and adjacent-key overlap.
- Long-session and rapid-input timing gates pass at every touch setting.

## Phase 4 — Paper desk and print-quality export

**Goal:** turn sheets into a small, tangible manuscript rather than anonymous saves.

### Work

- [x] Preserve release, inspection, reinsertion, filing, crumpling, discard,
  recovery, fresh-feed, local persistence, TXT, and exact paper-image export.
- [x] Add a visual paper desk with Loaded, Loose, Filed, and Discarded sections.
- [x] Generate accessible page thumbnails with sheet number, date, and first line.
- [x] Let the writer select any filed or discarded sheet, not only the latest one.
- [x] Add native browser Print / Save PDF and optional carbon-copy rendering.
- [x] Preserve uneven ink, overstrikes, margins, line spacing, and optional page
  metadata across every visual export.

### Acceptance gate

- Every page action is explicit, reversible where promised, and survives reload.
- Thumbnail ordering and counts match durable archive state.
- Keyboard and assistive-technology users can identify and act on every sheet.
- TXT preserves the logical transcript; PNG/PDF preserve the rendered paper.
- Storage quota, interrupted animation, stale-tab, and corrupted-journal tests pass.

## Phase 5 — Atmosphere and authenticity

**Goal:** give each writing session an authored emotional climate without turning
weather into distraction or weakening the mechanical simulation.

### Work

- [x] Preserve independent room, weather, machine, paper, and optional unease audio.
- [x] Preserve the existing quiet, rain, snow, and nor'easter foundations.
- [x] Present authored presets: Clear Dusk, Autumn Wind, Steady Rain, First Snow,
  and Nor'easter.
- [x] Give each preset distinct exterior movement, lighting, window treatment,
  sound balance, and restrained event timing.
- [x] Keep unease optional and independent, with no jump scares, forced story
  events, content analysis, or camera shake while typing.
- [ ] Conduct a documented authenticity review with Philadelphia typists and repairers.
- [ ] Plan a permissioned recording session with restored physical machines.

### Acceptance gate

- Each preset is distinguishable with sound muted as well as with audio enabled.
- Atmosphere Pause freezes decorative motion without stopping machine or paper actions.
- Reduced motion and reduced audio are respected independently.
- Default and high-quality scenes remain inside the release performance budget.
- Human review notes are recorded as evidence, not represented as approval in advance.

## Phase 6 — Community machine profiles

**Status:** coming-soon preview targeted for the active release; account-backed
functionality is deliberately deferred.

The preview should explain how Philadelphia owners and restorers could eventually
contribute a machine history, photographs, model details, restoration notes, and
permissioned recordings. It must credit contributors and distinguish historical
facts from owner stories.

### Future acceptance gate

- A contributor controls attribution and media permissions.
- Moderators can correct metadata without rewriting an owner’s personal history.
- Profiles remain a separate archive experience and never interrupt the private desk.
- Accessibility, privacy, reporting, and deletion paths exist before public launch.

## Phase 7 — Accounts and public writing board

**Status:** coming-soon preview targeted for the active release; authentication,
cloud sync, publishing, and moderation are deliberately deferred.

The preview should set the expectation that writing remains private by default.
Future publishing must be explicit and support pseudonyms, categories, editing,
unpublishing, export, account deletion, reporting, and moderation.

### Future acceptance gate

- Drafts are private by default and never published through an ambiguous action.
- The private desk and public board are separate in navigation, data flow, and tone.
- Account recovery, data export/deletion, abuse reporting, spam prevention, and
  moderation are complete before public launch.
- A threat model and privacy review pass before any real user data is accepted.

## Release order

Phases 0–5 are the active integrated release. Phase 0 closes last because its
final gate packages and verifies the combined result. Phase 1 closed after the
user approved the logo and homepage. Phases 6 and 7 may be represented by
honest coming-soon pages, but their platform gates remain future work.

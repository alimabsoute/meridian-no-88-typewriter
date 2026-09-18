# Immediate landing, optional assembly and deferred writing room

## Current implementation direction — September 18, 2026

This revision restores the application's charcoal, aged-brass, Bebas Neue and
Special Elite identity and the original headline, “A room for the next page.”
The readable entry action remains “Start typing on the typewriter now,” with
“No sign-in. No credit cards. Completely free.” The guide remains available
without starting the full simulator. This describes the working revision;
publication and final passing checks must be established by its release record.

The flat machine image and animated-paper composition from the earlier
September 18 release are replaced by an optional preview of the actual modeled
typewriter. Twenty-one groups coalesce over 4.6 seconds. Entry does not require
waiting for the assembly to finish.

## Startup boundary

- `src/landing.css` supplies critical styling so the headline and controls paint
  before the full application is ready. Font fallbacks retain readable content
  while the intended Bebas Neue/Special Elite faces become available.
- `src/landing-bootstrap.js` runs before the large simulator payload. It opens
  the independent guide, queues early entry, reports progress/errors, and primes
  silent audio contexts inside the explicit entry gesture.
- `scripts/landing-shell-plugin.mjs` inlines the small shell and places the large
  single-file runtime after visible content. Callback replacement preserves
  literal JavaScript replacement tokens; LF normalization keeps HTML builds
  comparable across platforms.
- `src/landing-assembly.js` can create an isolated renderer and real typewriter
  model for the optional assembly. This is pre-entry WebGL, not a full room or
  a static image. It does not restore archives or initialize audio/full-room
  state. A preview failure must leave the readable entry path available.
- Before constructing the live room, the preview is disposed so its graphics
  resources and animation loop do not remain alongside the writing experience.
- `src/main.js` waits for explicit entry before restoring archives and creating
  the full room and live mechanics. Staged initialization lets progress paint;
  audio engines adopt the contexts primed by that user gesture.
- The room prepares its Front view before the landing crossfade. The earlier
  silent one-key preview is not a required step in entry.

The full simulator remains in the standalone HTML. Optional preview rendering
means the earlier claim of zero pre-entry WebGL no longer applies. The archive,
audio and full room still remain behind explicit entry. Earlier CSS-only landing
cadence measurements are historical and must not be reused as assembly FPS.

## Philadelphia wall decor and media

`src/room-decor.js` adds a slim television on the left wall and Philadelphia
paintings on the right, with media deferred until the room is entered. The TV
loops a silent local edit of circa-1955 Philadelphia footage from the specific
public-domain Prelinger item *Miracle on the Delaware*. It is archival footage,
not a current broadcast. Source attribution, segments, rights and checksums are
in [the media provenance note](philly-media-sources.md).

The television can be switched off, and `tvPlaying` preserves that preference.
Room pause and reduced-motion handling govern playback. The original generated
oil-painting diptych depicts the Rocky statue/Museum steps and Boathouse Row;
its adjacent source note retains prompt provenance. These additions do not
replace the existing skyline, PECO/Cira animation, mechanical or paper systems.

## Offline and packaging boundary

The core simulator remains usable from an ordinary double-clicked HTML file.
Under `file://`, decor deterministically makes no video, poster or painting
requests: the television is dark and artwork uses linen fallbacks. Placing the
media folder beside the HTML does not enable media in that mode, and special
browser file-access flags are not required or recommended for ordinary use.

For optional media without internet access, serve the extracted web ZIP over
HTTP on localhost, keeping its `media/` folder intact. The video, poster and
paintings are separate local assets, not embedded in the standalone HTML. HTTP
room entry may request those local assets; direct-file core behavior and HTTP
media playback are separate validation paths.
## Accessibility and recovery

The entry actions are native keyboard-accessible buttons with visible focus.
Reduced motion suppresses decorative motion, including the assembly treatment,
and the room's decor observes its pause/reduced-motion settings. The guide is
independent of full simulator readiness. Entry loading and retry controls retain
readable progress/error feedback. Failure of the optional preview or media must
not be confused with failure of the core writing interface.

## Verification boundary

The landing checks exercise the real built HTML and early streamed shell,
readable controls/guide, queued entry, desktop/mobile bounds, motion preferences,
actual typing and recoverable failures. Assembly tests additionally need to
cover model transforms, completion, disposal and entry handoff. Pre-entry checks
must distinguish the allowed optional preview renderer from prohibited early
archive/audio/full-room initialization.

Room/decor checks cover playback controls, persisted preference, pause/reduced
motion and disposal. Packaging/offline checks distinguish the core single-file
simulator from optional adjacent media. The normal interaction, release UI,
workbench, visual and performance checks continue to use the actual simulator
API. Test descriptions are requirements and available coverage, not a claim
that the current revision has passed its full release checks or is published.

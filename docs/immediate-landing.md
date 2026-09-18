# Immediate landing, optional assembly and deferred writing room

## Current implementation direction — September 18, 2026

This revision restores the application's charcoal, aged-brass, Bebas Neue and
Special Elite identity and the original headline, “A room for the next page.”
The readable entry action remains “Start typing on the typewriter now,” with
“No sign-in. No credit cards. Completely free.” The guide remains available
without starting the full simulator. This describes the startup architecture;
release records identify the verified source and deployment.

The flat machine illustration and one-key teaser from earlier September 18
iterations are historical. The current page pairs an immediate paper welcome
with an optional preview of the actual modeled typewriter. Twenty-one groups
coalesce over 4.6 seconds. Entry does not require waiting for assembly to finish.

The initial composition is an HTML/CSS paper-and-ink overture. An ivory sheet
gently lifts through warm lamplight while four four-line stanzas type in turn:
“Welcome, writer,” the room a page makes for a day, the distance words cross,
and permission to begin without a perfect first line. Each stanza occupies a
nine-second window; the complete welcome repeats on a 36-second CSS loop, so
a slow load does not leave the paper frozen after a few words.

This composition has no image, JavaScript or WebGL dependency and can paint
with the initial HTML. After the model's first successful render, the visible
ink stops typing and drifts away with twelve small, clipped paper fragments.
The handoff finishes in approximately 760 ms while the actual model fades in;
it adds no wait for the poem to finish and no additional WebGL particle system.
Reduced motion shows one readable, static stanza and switches directly to the
model. Entry stops the decorative motion; a graphics failure leaves the welcome
and entry action usable. The approved page typography, colors, layout and real
twenty-one-group assembly remain.

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
- The plugin emits the welcome and twelve fragment surfaces directly in the
  model area. No decorative asset request or decoding is needed, including in
  the standalone HTML. The earlier less-than-3-KB markup measurement belonged
  to the superseded two-line overture and does not describe this longer version.
- `src/landing-assembly.js` can create an isolated renderer and real typewriter
  model for the optional assembly. This is pre-entry WebGL, not a full room or
  a static image. It does not restore archives or initialize audio/full-room
  state. A preview failure must leave the readable entry path available.
- Initialization yields a task after animation frames so the prelude can paint
  before expensive work. A 128 px cube-face environment retains the broad room
  reflections at one quarter of the previous environment raster pixel count.
  Cancellable `KHR_parallel_shader_compile` completion polling avoids blocking
  on shader links and does not access disposed materials after early entry.
  Startup telemetry records renderer, authored model, assembly, environment,
  shader dispatch/readiness and first-render timings; the live model is still
  dependent on the device's CPU and GPU.
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

`src/room-decor.js` adds a larger television on the left wall and Philadelphia
paintings on the right. The TV has a wall mount, vented rear housing, beveled
frame, inset screen and standby LED. The Front overview now fits the room and
television around the signup/header and workbench rather than relying on one
fixed camera framing.

The current app enables `nativeVideo` and reuses the decor's single native
`<video>` element. `src/television-surface.js` projects that element onto the
four corners of the modeled TV glass with a CSS perspective matrix. It follows
the existing camera/render loop and creates no second decoder or playback
controller. Native playback avoids the cross-origin pixel-upload requirement
that made the earlier WebGL video-texture path fail; it does not read or copy
the source's pixels. The optional texture implementation remains for other
callers and fixtures, but is not the app's current news display path. Older
4:3 broadcasts are contained within the screen instead of stretched.

A compact power/mute/volume panel follows the television. It appears when a
fine pointer approaches the screen or remote, and when its controls receive
keyboard focus; touch devices retain visible controls. Placement prefers the
right, then left, then clear space below or above the picture. If no safe area
fits between the header and toolbar, it hides instead of covering the picture.
Equivalent controls and the dated source link remain in Room.

The current playlist references three WPVI/6abc Archive broadcasts (1993, 1998,
2024), cycling through bounded 90-second excerpts. The 1993 excerpt begins at
38 seconds on the Philadelphia skyline news opening; the 1998 excerpt begins
at 15 seconds on Jim Gardner's studio shot, past the tape slate and stock ticker.
Exact ranges and remaining editorial vetting are recorded in the media source
note. Playback still needs Internet access and a browser that can decode the
source. Later browser checks observed native-video playback of all three files
and exercised the in-room TV power off/on, mute and volume slider; the control
settings were restored afterward. Sound was not independently heard, and these
observations do not establish cross-browser or mobile playback. The player
retains the archive standby card, source-failure handling and retry controls.
See [media provenance](philly-media-sources.md) for the exact source files.

Fresh visits now start with television power on and sound muted; saved volume
does not enable sound automatically. Power, mute and volume remain controllable
in the room. A previous saved power-off state no longer keeps a fresh visit's
TV off. Room pause, tab visibility and reduced motion still govern playback.

The deferred-start gate is implemented on disk: `src/main.js` passes
`deferTVPlayback: true`, decor's `_shouldPlay()` checks `deferPlayback`, and
`enterStudio()` calls `room.decor.beginPlayback()` immediately after removing
`landing-active`. This prevents news loading/playback during the final room
preparation behind the landing. `scripts/television-playback-check.mjs` passed
10 native lifecycle checks, including this gate; these use Node event doubles
and do not constitute browser decoding or audio verification.

The original generated oil-painting diptych depicts the Rocky statue/Museum
steps and Boathouse Row; its adjacent source note retains prompt provenance.
These additions do not
replace the existing skyline, PECO/Cira animation, mechanical or paper systems.

### Earlier September 18 media evidence

The earlier in-app attempt reported all three news sources unavailable while
using the CORS-dependent video-texture path. That result remains historical
evidence and motivated the native-video change; it is not a current claim that
these sources cannot play. The original local silent film remains
a separate fixture and was never evidence of successful WPVI news playback.

## Offline and packaging boundary

The core simulator remains usable from an ordinary double-clicked HTML file.
Under `file://`, decor deterministically makes no video, poster or painting
requests: the television is dark and artwork uses linen fallbacks. Placing the
media folder beside the HTML does not enable media in that mode, and special
browser file-access flags are not required or recommended for ordinary use.

Serve the extracted web ZIP over HTTP on localhost, keeping its `media/` folder
intact, to display local artwork and the standby card. The news playlist still
requires Internet access. The older local silent film remains a test fixture;
it is not the default TV program. Direct-file core behavior, local artwork and
remote news playback are separate validation paths.

## Updates signup

The shared signup rail is emitted with initial HTML on the landing, studio,
Community and Writing Board pages. Its controller is independent of the 3D
payload. A successful server-confirmed save opens a paper receipt with a brief
confetti animation; failures retain the address and show a readable error.
Reduced motion suppresses confetti. The server supports the default signed
collector and an explicit Pulse-compatible adapter. The local preview now loads
private configuration from ignored `.env.local`; its real browser form showed
the thank-you receipt and a Google connector verified the reserved test row in
the live sheet. The Octoberline Vercel dashboard now verifies the URL Secret
and `pulse` format Config in both Production and Preview. Redeployment and a
production-form test remain pending. See
[setup and verification boundaries](updates-signup.md).

## Accessibility and recovery

The entry actions are native keyboard-accessible buttons with visible focus.
Reduced motion suppresses decorative motion, including the assembly treatment,
and the room's decor observes its pause/reduced-motion settings. The guide is
independent of full simulator readiness. Entry loading and retry controls retain
readable progress/error feedback. Failure of the optional preview or media must
not be confused with failure of the core writing interface.

The larger visual first-sheet guide explains the machine and paper workflow;
the detailed field guide remains available from the room. These guides and the
initial landing help are separate from the optional model's readiness.
The actual browser showed the first tutorial step and the Enter-key tip, with
the larger readable arrow and keyboard illustration. This is evidence for those
observed steps, not a claim that every tutorial branch was exercised.

## Verification boundary

The landing checks exercise the real built HTML and early streamed shell,
readable controls/guide, queued entry, desktop/mobile bounds, motion preferences,
actual typing and recoverable failures. Assembly tests additionally need to
cover model transforms, completion, disposal and entry handoff. Pre-entry checks
must distinguish the allowed optional preview renderer from prohibited early
archive/audio/full-room initialization.

The streamed-shell scenario withholds the entire simulator runtime and checks
that the paper is visible and actually changes its transform
before releasing the runtime. Reduced-motion checks suppress prelude motion as
well as WebGL motion. Cancellation tests cover native shader handles during
entry and devices without the parallel compilation extension. These tests do
not assert that a complex model can compile instantly on every device.

Room/decor checks cover playback controls, saved volume, pause/reduced
motion and disposal. Packaging/offline checks distinguish the core single-file
simulator from optional adjacent media. The normal interaction, release UI,
workbench, visual and performance checks continue to use the actual simulator
API. Test descriptions are requirements and available coverage, not a claim
that the current revision has passed its full release checks or is published.

### Current local validation checkpoint — September 18, 2026

Focused native checks passed for the signup handler, Pulse request adapter,
television controls/projection math, and first-sheet guide behavior. These use
generated markup, real Three.js math and local mocks; they do not establish
rendered appearance or live signup delivery. The TV-control report contains
13 passing scenarios at `2026-09-18T15:52:31.235Z`. Separate browser checks then
observed all three native news videos, TV power/mute/volume interactions, and
the first tutorial/Enter-key steps. No audible verification was performed.

The local browser signup also reached the live private Sheet: a Google connector
verified the retained reserved-address test row 5 at
`2026-09-18T16:13:21.391Z`, Source `Octoberline 211 /studio`, after the thank-you
dialog appeared. No real subscriber records were read. The Vercel dashboard
subsequently verified the URL Secret and `pulse` format Config for both
Production and Preview; no redeployment or production-form test has occurred.
Local `.env.local` settings alone do not publish the integration. No
mobile-browser pass is claimed because the attempted viewport override was
ineffective.

The deferred-playback lifecycle fixture passed all 10 native checks. Vite/Vitest
execution remained blocked by `spawn EPERM`, and the Vercel CLI encountered
proxy `ECONNREFUSED`/process restrictions. The GitHub API write was blocked
because approval was required while the approval policy was `never`. No new
blob, commit, push or deployment was created. The verified Production/Preview
settings await updated source publication; full release checks and a fresh
production-browser pass must not be described as complete.

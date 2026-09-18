# Immediate landing and deferred writing room

The September 2026 opening replaces the previous full-scene camera/key preview.
The headline and controls no longer wait for a GPU frame. The visitor sees a
paper animation, an actual 42.9 KB render of the machine, and a clear start action:
“Start typing on the typewriter now.” The supporting promise is “No sign-in.
No credit cards. Completely free.”

## Startup boundary

- `src/landing.css` supplies critical styles with system fonts. Headline and
  controls are visible without JavaScript, images, custom fonts, or WebGL.
- `src/landing-bootstrap.js` runs before the large simulator payload. It opens
  the lightweight guide, queues early entry, reports progress/errors, and unlocks
  silent audio contexts inside the real user gesture.
- `scripts/landing-shell-plugin.mjs` inlines that small shell and moves the large
  single-file runtime after visible content. Callback replacements preserve
  literal JavaScript replacement tokens such as `$&`.
- `src/main.js` awaits the explicit entry request before restoring archives or
  constructing the renderer, room, reflection map, or typewriter. Initialization
  yields between stages so the progress message can paint. The existing audio
  engines adopt the gesture-unlocked contexts.
- The room compiles shaders and renders its Front view before the opening fades.
  There is no mandatory camera movie or silent one-key preview to wait through.

The standalone HTML still contains the entire simulator. This change improves
first visibility and eliminates idle 3D work; it does not claim that the complete
room is a smaller download or that full-scene frame rate is fixed on every device.
The detailed city, PECO/Cira animation, document lifecycle, mechanical behavior,
and exports remain in their existing modules.

## Failure and accessibility behavior

Reduced motion disables paper, typing, and shimmer animation. Both entry actions
are native keyboard-accessible buttons with visible focus treatment. The guide
is available before initialization. Loading disables repeat entry and guide
reopening; errors restore a readable retry and keep the page visible. Failed
decorative images do not prevent entry. WebGL failure is explained within the
landing rather than replacing it with an empty canvas.

## Verification

`npm run test:landing` serves the actual built HTML in two chunks, withholding
everything after the first 30 KB. It checks visible content, zero WebGL/audio
construction before entry, guide operation, and a queued early click. It also
checks desktop/mobile/short-screen layout, real CSS movement, reduced motion,
entry and typing, no-JavaScript readability, and recoverable startup errors.

The normal interaction, release UI, workbench, visual, performance, and offline
checks use an entry-first helper and wait for the real simulator API. They do
not use a mock readiness object. The landing check is part of `npm run verify`.

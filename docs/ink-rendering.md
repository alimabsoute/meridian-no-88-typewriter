# Paper and ink rendering

The page RGB texture contains warm stock and ribbon impressions. Its alpha
channel stores **ink coverage**, not page transparency. Textures carrying
`userData.inkCoverage` must use `createPaperMaterial()`, including loose,
filed and discarded pages. That material keeps the sheet physically lit but
applies pigment after exposure, fog and output conversion. Black stroke cores
are sRGB (5,5,5); red cores are (170,8,18). Blank paper remains warm.

The previous high-resolution texture used only linear filtering without
mipmaps. Front-view minification sampled holes in the distressed typeface,
turning small letters into fragments. Mipmaps alone averaged warm stock into
the glyphs and allowed the bright room lighting to wash them out. The fix uses
trilinear minification, a modest 0.5px ribbon spread, and coverage-based pigment
composition with neutral black antialiased edges. Active sheets remain 2x;
small archive textures remain 1x. Keystrokes upload only dirty rows; WebGL
regenerates the mip chain. Exports retain their separate opaque canvas.

Screen resolution stays at native DPR (capped at 2), or DPR 1 when low quality
is explicitly selected. The scene no longer silently drops writing detail
after slow frames. No forced supersampling is required for coherent ink.

## Repeatable checks

From the project root:

```powershell
node node_modules/vitest/vitest.mjs run --config scripts/vitest-native.config.mjs --configLoader native
node scripts/paper-ink-check.mjs
node scripts/paper-material-check.mjs
node scripts/typewriter-legibility-check.mjs
```

The native Vitest configuration avoids the esbuild subprocess and Windows
realpath helper that failed with EPERM in the restricted environment. It uses
the same source tests and assertions with a single thread. It does not disable
functional checks or change existing test timeouts.

The local diagnostic harness in `work/ink-lab*` uses actual production model,
paper, lighting and shader modules, without the expensive animated city. It
has four angles and four zoom levels, a DPR 1 comparison, source/GPU parity,
incremental typing, and a fixed-path evidence save endpoint. It is a diagnostic
artifact, not a shipped app route. Its event-driven rendering avoids a second
continuous 3D loop. The final lab matrix used DPR 1.5, with an additional
DPR 1 front-near visual inspection; the app uses native DPR up to 2.

GPU readback of packed alpha requires `transparent: true` with
`NoBlending`. An opaque MeshBasicMaterial forcibly writes alpha 1, producing
a false alpha mismatch. RGB and alpha are compared separately. Measurement
records retain the initial invalid-reader result and its correction.

## Evidence and limitations (2026-09-18)

- Actual GPU initial texture and 28 incremental impressions: zero RGB or alpha
  channel difference against CPU source/mask.
- All 16 view/zoom cases passed the black-core assertion: every visible pixel
  with at least 85% ink coverage has RGB maximum <=12 and channel spread <=3.
  Median black cores were (5,5,5); measurable red cores were (170,8,18).
- Front-near/macro and left/right views were visually inspected and saved under
  `work/ink-evidence/`, including a DPR 1 front-near image. These are actual
  rendered model images, not generated illustrations.
- The source unit suite had 174/178 pass on its broad run. The signup size
  regression was fixed without raising the 18KB limit; all 13 signup/shell
  checks then passed. Paper-flex and landmark timeout cases passed separately.
  The unrelated full-room mount still exceeded its existing 15-second watchdog.
- Native-config Vite build succeeded with minification disabled. This proves
  bundling, not production-minifier parity. After the user closed the frozen
  preview, the complete built app passed actual keyboard input, carriage return,
  black/red ribbon selection, sheet release, and reinsertion with all 47
  impressions preserved. The transcript contained the typed black/red words;
  the loose page and front view were visually inspected. This integration run
  used explicit low quality. The 16-angle/zoom rendering matrix is from the
  separate production-module diagnostic harness, not the complete city scene.
- Finite sampled views do not establish legibility at arbitrarily tiny screen
  sizes or smooth frame pacing on every device. Very faint red edge pigment
  identification uses coverage-adjusted stock chroma; measured red cores passed.

No publication or Git push is implied by these checks.

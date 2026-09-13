# Octoberline 211 — animated Philadelphia exterior

The local preview and downloadable build now contain the rebuilt exterior. The interior, typewriter, paper system, and compact workbench retain their existing design. Production has not been deployed.

## What changed

- PECO remains at its existing size and placement. Its two-face scrolling crown uses the existing message animation. The body now has finer curtainwall ribs, floor reveals, corner caps, and crown metalwork.
- Cira Centre has a faceted, inclined body and sloping roof, with animated colored LEDs across multiple faces. Its position is composed to keep the lights visible through the window.
- One and Two Liberty Place have unequal crossed-gable crowns and silver trim. Comcast Center, Comcast Technology Center, Mellon, Three Logan Square, and FMC have differentiated silhouettes, setbacks, and façade details.
- Eleven Philadelphia houses replace the repeated low-detail foreground. Recessed windows, projecting bays, iron stoops, masonry, dormers, mixed mansards and Italianate cornices create actual depth. Distant mid-rises fill out the city at several distances.
- Trees have denser curved leaf surfaces, branch movement, and individual flutter. Loose leaves fall, settle, skid, and recycle from the relocated canopies. Block cars and primitive pedestrians have been removed.
- Glass reflections and moving cloud detail enrich the exterior. New roofs retain snow behavior, including sloped roofs.

This is a working procedural 3D scene. The twelve generated stills remain architectural direction studies, not screenshots or baked backgrounds in the app. Geography is deliberately composed; PECO's existing placement takes priority over a surveyed view.

## Verification

- Full unit run: 129 cases passed across 14 files. The added roof regression also passed, bringing distinct covered cases to 130.
- After the roof changes, all eight room regressions passed. The new roof test exceeded its default five-second timeout during concurrent browser load, then passed in isolation in 0.73 seconds without changing the timeout.
- Interaction suite passed: typing, document lifecycle, paper operations, exports, restoration, controls, and weather.
- Workbench passed at 1280×800 and 390×844: six panels, exports, audio, focus, bounds, and IDs.
- Final rebuilt exterior check passed with no browser/shader errors: Cira clock and rendered colors changed; leaf matrices and tree poses moved; PECO advanced its scrolling message; houses and landmark roofs responded to snow.
- Pixel comparison at two Cira animation times found 2,794 pixels changing by more than eight channel levels within the inspected façade region. These are rendered captures, not just internal animation state.
- Final package integrity and offline checks passed. Offline typing and restoration succeeded with zero external requests; the no-WebGL fallback remained functional.
- Final performance resource and CPU budgets passed: 109 visible room drawables, three room lights, and approximately 0.416 ms per room update. Headless measurements were 18 fps for the full snow scene and 37 fps with the room hidden. These measurements do not establish smooth 60 fps on the user's display.

The interaction/workbench suites ran before the final roof and distant-window refinements. Those refinements were followed by the targeted scene checks, final browser exterior/snow check, package test, offline test, and performance test.

## Files

- `Octoberline-211-Web-Experience.zip`: updated web package.
- `Octoberline-211-Typewriter.html`: updated standalone experience.
- `octoberline-philly-window.png`: actual final exterior capture.
- `philly-window-concepts/index.html`: all twelve stills, full-size viewer, favorites, research links, and animation notes.
- `Philadelphia-12-Window-Concepts.zip`: complete concept gallery and images.
- `Octoberline-211-Exterior-Test-Evidence.zip`: final captures and verification records.

Architectural reference links and the distinction between real building features and proposed motion are included in the concept gallery and its research guide.

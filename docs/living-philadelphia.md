# Living Philadelphia studio

The studio retains the existing document model, paper archive keys, mechanical
command scheduler, ribbon modes, and export formats. No dependency, service,
database, or storage migration is required.

## Scene

`living-philadelphia.js` builds a composed Philadelphia-inspired skyline with
dimensional PECO, Liberty Place and Comcast forms, rowhouses, trees and street
actors. This is an artistic composition, not a surveyed view from a real address.
The bay is part of the room geometry. The existing PECO glyph renderer supplies
both visible crown faces; its authored words, update timing, and static alternative
remain in `philadelphia-writing-room.js`.

Foliage, vehicles and facade details are instanced or batched. Falling and settled
leaves use a fixed pool; invisible recycling prevents unbounded accumulation.
Weather changes affect the street and roof snow. Quality tiers retain the city's
geometry while the existing precipitation budgets remain adaptive. Pause and
reduced motion stop the atmospheric simulation.

## Workbench

`workbench-ui.js` coordinates the existing controls through six labeled toolbar
buttons. The original control IDs and their event handlers remain intact. Paper
and Export share the document tray. Native panel state guards typing synchronously;
View and Ink use the workbench state. Escape returns focus to the triggering
toolbar button. Selecting a view or ink closes that panel before resuming typing.

## Machine and paper

Small procedural surface maps supply metal grain and ribbon weave. A generated
studio reflection environment supplies broad highlights without network assets.
Key inserts sit above their supporting cap while retaining a shallow dish.

`paper-response.js` adds a bounded damped response to the free region of the loaded
sheet, leaving the platen path and texture coordinates fixed. `paper-flex.js`
supports restrained handling curl. Lifecycle sheets retain the existing texture,
archive and recovery callbacks while adding thin edges and progressive creases.
Fiber patterns remain deterministic across export resolutions.

## Verification

Run `npm test` for document, archive, mechanical, geometry, export, weather,
reduced-motion and paper-response invariants. Browser checks use the existing
local preview helper and an installed Chrome/Edge executable:

- `npm run test:interaction`: keyboard, mechanics, paper lifecycle, exports and recovery.
- `npm run test:release-ui`: keyboard focus, responsive controls and production UI flows.
- `npm run test:workbench`: every panel, one-panel rule, Escape focus, mobile bounds and control availability.
- `npm run test:offline`: standalone file operation and persistence.
- `npm run test:performance`: bounded scene resources and measured CPU/frame behavior.
- `npm run test:visual`: rendered camera, paper and atmosphere scenarios.

`npm run verify` retains the previous full verification pipeline and adds the
workbench check. `npm run build:release` produces the existing standalone and web
release packages. The cinematic concept illustration is not a rendered runtime
baseline; inspect the application screenshots and motion when reviewing changes.

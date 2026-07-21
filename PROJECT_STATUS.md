# Project status

## Checkpoint

- Release: `v0.1.0-alpha`
- Status: functional, tested, and ready for continued visual refinement
- Standalone build: self-contained HTML that opens directly from disk
- Hosting: GitHub Pages, rebuilt automatically from `main`

## Verified behavior

- Seven document-model tests pass.
- A direct-file browser run produced the exact two-line sample, including rapid character order, carriage return, red ribbon, Backspace overstrike and the five-space margin bell.
- Independent left and right Shift motion, control-focus recovery, new-sheet loading and mobile input were exercised successfully.
- The final browser runs completed without console or page errors.

## Known issue: front-apron intersection

In the closed **Writer** view, several round keycap rings intersect the solid front apron and appear as small silver-and-brass crescents on the front face. This is a genuine modeling defect, not intentional trim.

The correct next revision is to replace the single solid front-skirt volume with a recessed keyboard well and a thin lower front lip. The keys should not simply be moved upward or backward, because their alignment with the key levers and typebar linkage is already mechanically coherent.

## Suggested next checkpoint

1. Remodel the front apron as left/right shoulders, an open keyboard bay and a thin curved lower lip.
2. Verify all four keyboard rows and the space bar from Writer, Action and Inspection views.
3. Add a browser regression screenshot focused on the front casing.
4. Rebuild, rerun interaction tests and publish `v0.2.0-alpha`.

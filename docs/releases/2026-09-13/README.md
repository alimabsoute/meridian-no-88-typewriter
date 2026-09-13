# Living Philadelphia, mechanical audio, and cinematic arrival

This source checkpoint contains the approved bay-window, compact workbench and paper improvements; the rebuilt Philadelphia exterior; louder mechanical key strikes; and a cinematic landing.

The key audio combines impact, body resonance and a delayed typebar-return clack. A browser OfflineAudioContext comparison at the same volume measured a 9.58 dB RMS increase over the prior version. Eight simultaneous maximum-force strikes remained below digital clipping (peak 0.740). Muted and zero-volume renders were silent; paper audio was unchanged. These are waveform measurements, not a claim that the synthesized sound is a recording of a real machine.

The landing camera eases into place over 5.5 seconds, responds subtly to the pointer, and previews key travel without queueing text. Staged text, a brass highlight and a clearer city view complement the motion. Entry remains immediately available. Reduced motion disables the animated introduction.

Architectural concepts in `design-review/philadelphia-window-concepts` are generated direction studies. The app uses procedural 3D buildings and animated foliage, not those still images as its background.

Prior implementation and exterior verification are dated in the accompanying documents. Current publication, exact commit/deployment IDs, final test outcomes and rollback deployment are recorded in the project's dated Obsidian checkpoint. No credentials are included in this release folder.

Reproduce the focused checks with `node scripts/audio-impact-check.mjs` and `node scripts/landing-motion-check.mjs`. The normal `npm run verify` remains the broad release gate. Live Vercel publication requires an explicit deployment: the existing Vercel project was not Git-connected at the September 13 audit.

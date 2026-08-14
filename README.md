# Meridian No. 88

An enthusiast-grade, browser-based simulation of a late-1930s manual typewriter at a stationary Philadelphia rowhouse desk. A physical keyboard drives the modeled keys, levers, typebars, ribbon, ink impression, escapement, carriage, platen, and paper.

[Open the live simulator](https://alimabsoute.github.io/meridian-no-88-typewriter/) · [Release downloads](https://github.com/alimabsoute/meridian-no-88-typewriter/releases)

![Meridian No. 88 with a typed sheet](media/meridian-no-88-preview.png)

## Current status

Version `0.2.0` is the next-meaningful-release candidate. The machine, paper archive, weather room, persistence, export, keyboard correspondence, and standalone build are implemented and covered by automated browser and geometry checks. See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the verification record.

## What works

- Immediate physical-keyboard correspondence across the complete US QWERTY layout
- Overlapping key, lever, typebar, ribbon-vibrator, escapement, and carriage motion without a serialized animation backlog
- A collision-tested open keyboard bay with no key tops protruding through the shell
- Black, red, and stencil ribbon positions, incremental spool travel, reversal, and imperfect ink impressions
- Authentic Space, Backspace overstriking, Tab, independent Shift keys, Shift Lock, margin stop, bell, carriage return, platen rotation, and line feed
- Curved paper constrained around the platen, feed rollers, guides, and bail rollers
- Physical paper rituals: release, inspect, reinsert, file beside the machine, deliberately crumple, discard, recover, and load a fresh sheet
- Page-addressed local manuscript and wastebasket storage with journal/primary/backup recovery, integrity checks, and stale-tab protection
- Exact text and full-resolution PNG export
- A fixed Philadelphia writing room with quiet, rain, snow, and nor'easter presets
- Independent machine, paper, room, weather, and optional unease audio controls
- Constrained inspection views, reduced motion, mobile text input, and a built-in mechanical field guide

## Use it

The easiest option is the [live GitHub Pages version](https://alimabsoute.github.io/meridian-no-88-typewriter/).

After `v0.2.0` is published, download `Meridian-No-88-Typewriter.html` from [Releases](https://github.com/alimabsoute/meridian-no-88-typewriter/releases), double-click it, and choose **Sit at the Machine**. The standalone file makes no network requests and needs a current WebGL 2 browser with graphics acceleration.

### Controls

- Type normally to operate the matching modeled keys.
- `Enter` returns the carriage and feeds the paper.
- `Backspace` moves one pitch backward without erasing, allowing an overstrike.
- `Tab`, `Shift`, `Caps Lock`, `Space`, and both physical Shift keys operate their corresponding mechanisms.
- `F6` briefly releases the margin.
- Open **Document** to export or decide a sheet's physical fate.
- Enable **Inspection Mode** before using the pointer to lean, tilt, or inspect mechanisms.

## Develop locally

Requirements:

- Node.js `22.12` or newer is recommended; Node.js `20.19` or newer is also supported.
- A current Chrome, Chromium, or Microsoft Edge installation for browser verification.
- If the browser is installed in a nonstandard location, set `CHROME_PATH` to its executable.

```bash
npm ci
npm run dev
```

Complete release validation is one command:

```bash
npm run verify
```

`verify` runs the complete unit suite, builds and packages the standalone file, exercises interaction and persistence, proves direct-file/offline behavior, checks default and high quality, measures the room's structural and CPU budgets, and regenerates the 11-view visual matrix. Browser checks reuse a Meridian preview already running on port `4177`; otherwise they start an isolated preview and stop only the process they created.

The Pages build is `dist/index.html`. The identically self-contained release asset is generated at `dist/Meridian-No-88-Typewriter.html` by:

```bash
npm run build:release
```

Individual browser checks may also target an existing deployment by setting `TARGET_URL`. Their default local preview is managed automatically.

Third-party software and font licenses are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Research basis

The fictional Meridian combines documented manual-typewriter mechanisms with Philadelphia's living repair and writing culture:

- [IBM Typewriter Service Manual (1939)](https://site.xavier.edu/polt/typewriters/IBMservice1939.pdf)
- [U.S. Army TM 37-305: Typewriter Maintenance](https://www.maritime.org/doc/typewriter/index.php)
- [Escapement mechanism patent US2212435A](https://patents.google.com/patent/US2212435A/en)
- [Ribbon vibrator patent US1417908A](https://patents.google.com/patent/US1417908A/en)
- [Line-spacing mechanism patent US2021195A](https://patents.google.com/patent/US2021195A/en)
- [Richard Polt's ribbon FAQ](https://site.xavier.edu/polt/typewriters/tw-faq.html)
- [Philly Typewriter community and public-machine program](https://www.phillytypewriter.com/community.html)
- [Philly Typewriter restoration process](https://www.phillytypewriter.com/restorations.html)

## Publishing

Every push to `main` runs the complete release verification with the hosted runner's Chrome installation, rebuilds the single-file simulator and named release asset, and deploys `dist/` to GitHub Pages through `.github/workflows/pages.yml`.

Copyright © 2026 alimabsoute. All rights reserved.

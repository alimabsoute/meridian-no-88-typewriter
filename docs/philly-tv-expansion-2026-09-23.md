# Philadelphia TV expansion research — September 23, 2026

## Result and current state

There is ample source material for a much longer rotation. A sensible first editorial target is **30–45 minutes of curated local news, weather, station promos, and Philadelphia-area commercials**, expanded later to an hour. This is a proposed edit length, not a verified ready-to-play package.

The current `src/philadelphia-news.js` has three excerpts totaling **240 seconds**: 1993 (90s), 1998 (90s), and 2024 (60s). The 2024 entry falls outside the newly requested 1985–2010 period. No playlist code or current playback was changed by this research pass.

## Evidence boundary

- Read the existing implementation, media provenance note, and playlist tests.
- The fifteen source pages below were found through web search/opened page metadata. Their titles and described contents are verified against those pages; their video playback, audio, exact excerpt boundaries, and current embed behavior were **not** verified.
- Internet Archive details, metadata, and search pages were inaccessible through the web tool. A bounded PowerShell Archive search request failed with connection refused. These failures do not establish that the recordings themselves are missing.
- Some uploader pages credit Archive contributors (DavisMix, VHS Deck, Scribbledips), but provide no exact Archive item identifier. Do not invent download URLs from titles.
- Broadcast Pioneers is a particularly useful primary archival source. Its library warns that much video is RealVideo or Windows Media; these are not drop-in sources for the app's HTML video player.
- Archive uploads and archival availability do not establish redistribution permission. Existing source-hosted playback is separate from downloading and bundling a compilation. The sources below remain candidates.

## Fifteen concrete candidates

Dates refer to recordings according to their source pages, not upload dates. All rows remain **metadata inspected / playback pending**.

| Recorded | Source | What makes it useful | Next verification |
| --- | --- | --- | --- |
| 1985-11-30 | [WPVI commercials and Action News opening](https://www.youtube.com/watch?v=WJYwI9vIZ88) | Page lists Philadelphia Electric Company, Bell Atlantic, local station promos and the 11pm news open. Credits DavisMix at Archive. | Resolve original Archive item; isolate the PECO spot and clean news opening. |
| 1987-10 | [WPVI commercial breaks](https://www.dailymotion.com/video/x98tam2) | Breaks from a Philadelphia broadcast of The Disney Sunday Movie; credits VHS Deck at Archive. | Inspect for genuinely local ads rather than assuming every network ad is Philadelphia-specific. |
| 1988 | [Krass Brothers spot](https://www.broadcastpioneers.com/krass.html) | Distinctive South Street retailer; archive explicitly links a 1988 spot. | Inspect linked media format and permissible delivery route. |
| 1988 / 1990 | [WSNI Sunny 104.5 commercials](https://www.broadcastpioneers.com/wsnispot.html) | Local radio advertising, with Don Cannon in the 1988 example. | Separate the dated versions and check source video. |
| 1989 | [Eagle 106 commercial](https://www.broadcastpioneers.com/eagle89.html) | Local WEGX radio branding and period personalities. | Source offers RealVideo/Windows Media; browser-compatible source needed. |
| 1989-05-08 | [KYW Channel 3 commercial compilation](https://www.dailymotion.com/video/x96m2no) | Philadelphia NBC-era station breaks and regional advertising. | Inspect local excerpts and native embed playback. |
| 1990 | [Monica Malpass Action News break-in](https://www.broadcastpioneers.com/monicamalpass90.html) | Archive identifies the five-minute local insert during Good Morning America. | Check full segment, media format, and playback. |
| 1997-06-15 | [WPVI Million Dollar Movie breaks](https://www.dailymotion.com/video/x7ltx7o) | Franklin Mills, AM Live, local bumpers and a Children First promo are listed. | Mark complete local ad boundaries; avoid movie fragments. |
| 1998-09-14 | [WPVI afternoon breaks and news opening](https://www.dailymotion.com/video/x7u37x2) | Art Institute of Philadelphia, Philadelphia Inquirer, ThriftWay, South Jersey Gas, Action News open. | Strong priority for a local-ad mini-block; resolve Archive original. |
| 1998-11-13 | [WPVI commercials, part 1](https://www.dailymotion.com/video/x7726l2) | Chopper 6 ID, South Jersey Online, Upland Mortgage and regional promos. | Identify local clips within a long mixed national/local reel. |
| 1999-07-25 | [WPVI evening commercials](https://www.dailymotion.com/video/x6hv5xp) | Pennsylvania Lottery, Action News AccuWeather promo, and 6abc station ID. | Inspect clean weather promo and station identity transitions. |
| 2002-11-05 | [WPVI afternoon commercials](https://www.dailymotion.com/video/x98uyas) | Commerce Bank time/temperature, A.C. Moore/6abc segment promo and Action News tease. | Resolve Archive original credited to VHS Deck. |
| 2005-05-18 | [WPVI evening lineup, part 1](https://www.dailymotion.com/video/x96nu0q) | Action News closing, Strawbridge's, Pocono Raceway, Philadelphia Saturn, Pennsylvania Lottery. Listed duration 1:00:54. | Strong 2000s candidate; inspect transcript landmarks against actual video. |
| 2009-03-22–23 | [WCAU/NBC10 commercial compilation](https://www.dailymotion.com/video/x96p986) | Wawa, B-101, Comcast, Cooper University Hospital and NBC10 weather/news promos. Listed duration 1:40:38. | Resolve Archive original credited to Scribbledips; select regional material. |
| 2010-09-10 | [MyPHL17 commercial compilation](https://www.dailymotion.com/video/x96m21a) | Forman Mills, Phillies station IDs, Eagles promo, Cherry Hill dealer and 10pm news opening. Listed duration 39:39. | Resolve Archive original; use complete local segments, not arbitrary timestamps. |

The last three long compilations alone have **3:21:11 of listed source runtime**. This is metadata runtime, not 3:21:11 of reviewed or usable local-only footage. Dailymotion's [2002 source page](https://www.dailymotion.com/video/x98uyas) lists these durations in related-source links. The distinction matters: national ads, duplicates, programs, slates and unrelated fragments still need removal from any curated rotation.

Further primary reference: [Broadcast Pioneers video library](https://www.broadcastpioneers.com/photos1.html). The [Dave Roberts weather promo](https://www.broadcastpioneers.com/daveroberts94.html) dates to January 22, 1993 despite its URL suffix and is a strong additional small candidate.

## Proposed rotation

Aim for a few longer news/weather windows interspersed with short local commercial blocks: roughly 60% news/weather, 25% local advertising, 15% station promos/IDs. These are editorial targets. Start on a clean 6abc broadcast opening; do not start with a VHS slate. Rotate the other entries without immediately repeating the last one. Retain dates and a link to the source, mute/volume, power, and a skip action.

Keep 6abc/Action News dominant, as previously requested. WCAU, KYW and MyPHL17 are optional Philadelphia variety; the first expansion can stay entirely WPVI if desired. Do not silently substitute national network news for local Philadelphia news. Replace the out-of-period 2024 excerpt only when the replacement is actually playable and inspected.

## Implementation and performance

The room already uses one native video element projected onto the TV instead of fetching frames into WebGL, which avoids the previously observed cross-origin texture failure. Preserve that design. More playlist metadata does not require more video elements or larger initial scene assets.

1. Resolve exact stable source-hosted MP4 URLs or a supported hosted player. YouTube/Dailymotion watch-page URLs cannot be passed to the current `video.src`.
2. For each admitted entry record station, broadcast date, content type, source page, exact media file, inspected start/end, and verification date.
3. Use the existing single-player sequential loading; do not preload dozens of clips. Keep loading deferred until room entry/TV on.
4. Test initial seek, decoded video frame, audible playback with volume changes, ending and advancing, wraparound, timeout recovery, and power-off fetch behavior. Test one 4:3 and one 16:9 source in the actual TV frame.
5. Inspect excerpt transitions to avoid mid-sentence cuts and timestamp mismatches between derivative encodes. Normalize audio only if producing an authorized local compilation; source-hosted loudness may vary.

Existing `src/room-decor.test.js` uses an injected fixture playlist and already covers advancing, wraparound, sound retention, aspect handling, error progression, power-off behavior, and callback cleanup. It does not verify remote availability or editorial suitability. This research-only pass did not run those tests or alter executable code.

## Next concrete step

Resolve and inspect the 1985 WPVI, 1998 afternoon WPVI, 2005 WPVI, 2009 NBC10, and 2010 MyPHL17 originals first. Those five have the best documented mix of recognizable Philadelphia material across the requested range. Do not claim the additional clips are live until actual in-room playback and transitions pass.

## Internet Archive-only follow-up — September 23, 2026

User confirmed Internet Archive as the source for expansion. Attempted Archive advancedsearch for WPVI movies with a bounded request: connection refused at the managed network proxy (127.0.0.1:9). The web tool could not access that Archive endpoint; a fresh in-app Archive search tab also timed out and reset the browser kernel. Existing source manifests were read; the two in-period recordings already used are 1993-03-25 and 1998-03-24. Those dated prior verification records are not fresh playback validation. No new clips, invented media URLs, arbitrary longer windows, or downloads were added. Expansion remains blocked on functioning Archive access and video inspection. Preserve the current loop until additional source files and excerpts are verified.

## Network diagnosis — September 23, 2026

Retry isolated two independent environment blockers. CODEX_SANDBOX_NETWORK_DISABLED=1; HTTP_PROXY, HTTPS_PROXY, ALL_PROXY and Git proxy variables point at http://127.0.0.1:9. Bounded HEAD requests to both Archive metadata and example.com failed identically with connection refused at that address. This establishes managed shell network restriction rather than an Archive-specific download failure. Did not remove/override proxy settings or bypass the sandbox. Approval policy currently never, so this task cannot self-escalate the download.

Browser getState timed out without navigating, independently establishing that the browser connector is unavailable. Web tool opened Archive's root JavaScript shell but could not retrieve the exact known item's metadata endpoint; root-page access is not media availability proof. No app code change or additional playlist entries made. Recovery requires an environment with authorized network access and a functioning browser connector; restart Codex to try restoring the latter, then verify status before opening a heavy 3D preview. Existing tests cannot validate remote media while these blockers remain.

## Browser recovery and implemented Archive expansion — September 23, 2026

This checkpoint supersedes the earlier browser blocker, not the shell network restriction. Browser inventory and Archive search recovered on retry. Used normal Archive web UI, exact directory links and native video playback; did not bypass the managed shell proxy, download/rehost footage, or change permissions.

Local playlist now has 14 entries / 1656.429 seconds (27m36s), replacing the prior 3 entries / 240 seconds. Retains 1993 and 1998 news openings; replaces the 2024 weather entry with May 2005 Sky 6 plus its commercial break; adds eleven entire uploaded commercial blocks. New material is concentrated in 2001/2005, not comprehensive coverage of every year 1985–2010. Regional and national commercials and local station promos are mixed in the original blocks. No claim that every advertisement is Philadelphia-specific.

Exact Archive sources:
- https://archive.org/details/wpvi-commercials-7sept2001 — Buffy-tape-ad-block-22 through -31.mp4, in its /download/ directory. Recorded date as supplied by uploader. Durations decoded: 151.601, 70.149, 150.890, 120.499, 120.941, 74.556, 130.814, 121.605, 121.160, 22.265 seconds respectively.
- https://archive.org/details/wpvi-commercials-27sept2001 — Buffy-tape-ad-block-15.mp4; decoded duration 211.949 seconds.
- https://archive.org/details/vhs-tape-discovery-channel-life-of-grime-whyy-unknown-2005.05.02-wpvi-action-new — exact H.264 link preserved in src/philadelphia-news.js. Full tape duration 7358.015 seconds. Excerpt 5400–5580. Tape mixes May 2 and 3, so UI deliberately labels May 2005. Sampled 5402 showed Sky 6 Philadelphia skyline; 5512 showed an advertisement. 5674 (excluded) showed a later crime story. This is a sampled ambient excerpt, not a frame-by-frame reviewed complete weather segment.

All twelve new sources decoded at readyState 4, 720x480, in the browser. Inspected a frame from each commercial file; did not watch every second or independently hear the audio. In-room browser verification at http://127.0.0.1:5202/studio?quality=low showed actual 2001 video and the 2005 Sky 6 skyline on the TV. Verified Next clip changes sources, unmuted state survives transition, panel and remote volume synchronize at 0.36, power-off pauses the video, power-on resumes, and 2005 initial seek reaches 5400. Existing native video path, single player, lazy source loading and dated source links preserved. No preload of all files and no media added to the app bundle.

14 room-decor tests passed, including playlist advance/wrap, errors and playback controls. Native unminified build passed (47 modules; 4.59 seconds); output 2557.50kB / gzip712.03kB. This is not production minifier validation. Source is local, uncommitted, unpushed and undeployed. Historical statements above remain dated; current manifest is authoritative for the new selection.
Final browser check: let the last 22.265-second promo finish naturally. The app automatically returned to the 1993 opening, readyState 4 and playing, with unmuted state retained. Left the preview playing muted and closed the Archive research tab. Automatic wraparound is now browser-observed, not only unit-tested.

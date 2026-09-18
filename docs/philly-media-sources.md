# Philadelphia TV archival media

## Current news playlist — September 18, 2026 (not published)

The WPVI/6abc playlist in `src/philadelphia-news.js` streams these exact Internet
Archive files. The excerpts below replace the provisional 0–90 second windows
after inspection of settled video frames. No news media was downloaded or
rehosted as a project asset, and no local news compilation was produced.

| Date | Item | Exact MP4 | Current excerpt |
| --- | --- | --- | --- |
| 1993-03-25 | [11pm Action News](https://archive.org/details/wpvi-tv-11pm-news-march-25-1993) | [Source file](https://archive.org/download/wpvi-tv-11pm-news-march-25-1993/WPVI-TV%2011pm%20News-%20March%2025-%201993.mp4) | 00:38–02:08 (38–128 seconds): Philadelphia opening and studio |
| 1998-03-24 | [Action News / World News Now](https://archive.org/details/6_Action_News_WPVI_TV_WOC_And_World_News_Now_1998-03-24) | [Source file](https://archive.org/download/6_Action_News_WPVI_TV_WOC_And_World_News_Now_1998-03-24/6_Action_News_WPVI_TV_WOC_And_World_News_Now_1998-03-24.mp4) | 00:15–01:45 (15–105 seconds): studio excerpt |
| 2024-09-10 | [Action News weather, from the 11pm broadcast](https://archive.org/details/wpvi-tv-11pm-news-september-10-2024) | [Source file](https://archive.org/download/wpvi-tv-11pm-news-september-10-2024/WPVI-TV%2011pm%20News%20%28September%2010%2C%202024%29.mp4) | 20:00–21:00 (1200–1260 seconds): local weather excerpt |

The exact files appeared in the Archive download lists. Subsequent checks in the
Codex in-app browser confirmed all three decoding in a normal native video player
with `readyState: 4`. The same files requested with `crossorigin="anonymous"`
failed with media error code 4. The room now uses a source-hosted native DOM video
projected onto the 3D TV screen, without sampling remote frames into WebGL.
Actual in-room playback was observed for the 1993 recording at 480×360 and the
1998 recording at 720×480. The texture path remains available for explicit local
fixtures; fixture success is separate from this remote playback evidence.

Settled frames inspected to choose the current windows:

- **1993:** 0 seconds showed VHS material; 20 seconds a car advertisement;
  35 seconds a station movie promo; 38 seconds the Philadelphia skyline opening;
  40 seconds the staff montage; 45 seconds a helicopter; and 65 seconds Jim
  Gardner in the studio. A fresh visit starts with this recording at 38 seconds.
- **1998:** 0 seconds showed VHS material; 8 seconds a stocks graphic; and
  15 seconds Jim Gardner in the studio with a lower-third graphic.
- **2024:** 0 and 180 seconds showed debate coverage. At 1140, 1200, and
  1260 seconds the recording showed local 6abc weather. The playlist labels this
  selection as weather.

These are excerpt windows, not claims of complete segment boundaries. In
particular, the 1998 studio and 2024 weather excerpts have not been verified as
complete editorial segments. News loading waits until the visitor enters the
room. Browser UI checks exercised TV power, mute, and volume; audible sound was
not independently heard.

Verification remains limited: no full browser performance assessment or
production deployment was completed in this checkpoint. A manual viewport
override left the browser's actual `innerWidth` at 1598, so it did not establish
mobile visual behavior. Thirteen native/projective camera tests passed, but
those checks are not a substitute for a real mobile browser inspection. No claim
of current or live news is made, and these three recordings do not provide full
1990-to-present editorial coverage.

News rights remain with their original holders. Archive availability is not a
reuse license. The prior public-domain film's status below does not apply to
these television broadcasts. Source links and dates remain available in Room.

## Historical local loop, retained as a test fixture

`public/media/philly-tv.mp4` is a 42.958-second silent loop assembled from three short Philadelphia segments in the public-domain Internet Archive item *Miracle on the Delaware*. The edit is intentionally labeled archival in the room metadata/fallback copy; it is not current television news.

- Video: H.264 Baseline, 640x360, 24 fps, `yuv420p`, no audio, 2,300,512 bytes.
- Poster: `public/media/philly-tv-poster.jpg`, 640x360 JPEG, 24,748 bytes.
- SHA-256 video: `1E5EB91EE3064829515620757F7096928AE1CFA8D47CDA302EC5049E5A1F45EA`.
- SHA-256 poster: `E60297C7A553A63E45403C8003A1842523893215F8A96B2E0F845AECA356F663`.
- Audio was removed during the local edit so the small wall TV can loop without adding sound to the room.

## Source and rights

Primary item: [Miracle on the Delaware](https://archive.org/details/Miracleo1955), Internet Archive identifier `Miracleo1955`, creator credited as WPTZ Motion Picture Unit, publication date `ca. 1955`, collection Prelinger Archives. The item page identifies the topic as Philadelphia, Pennsylvania, describes mid-century Philadelphia downtown/neighborhood/Mummers footage, and marks the usage **Public Domain**.

- Source record: https://archive.org/details/Miracleo1955
- Source metadata API: https://archive.org/metadata/Miracleo1955
- Downloaded source asset: https://archive.org/download/Miracleo1955/Miracleo1955.mp4
- Item usage mark: https://creativecommons.org/publicdomain/mark/1.0/
- Prelinger reuse guidance: https://archivesupport.zendesk.com/hc/en-us/articles/360004715031-Prelinger-Archive
- Suggested credit from the archive: “Archival footage supplied by Internet Archive (at archive.org) in association with Prelinger Archives.”

The rights decision is tied to this specific item page and its Public Domain mark. The Prelinger guidance says reuse follows the Creative Commons license shown on each film's detail page and that derivative works may be published, reproduced, sold, or distributed without limitation. The archive requests attribution when possible; this note and the in-app archival label preserve that provenance. The item description and shotlist metadata are cited for source identification only; the local video contains the source footage, with no copied narration or metadata text burned into it.

## Extracted segments

All time ranges below are source-file timestamps in `Miracleo1955.mp4`; they are joined in this order and center-cropped from 640x480 to 640x360 for the wall TV.

1. `06:04–06:14` — 1950s cars moving along a broad, tree-lined Philadelphia street.
2. `06:29–06:54` — Philadelphia Mummers parade costumes, musicians, floats, and spectators.
3. `07:19–07:27` — Philadelphia skyline/rooftop television-antenna views and an architectural exterior.

The combined output is a local derivative of the one licensed/public-domain source above. No arbitrary YouTube television-news download or paid media service was used.

## Reproducible local transform

The source was downloaded to a temporary directory outside the repository. `ffmpeg` was already available on the machine. The final edit uses three `trim` ranges, `crop=640:360:0:60`, Lanczos scaling, 24 fps, H.264 CRF 30, Baseline 3.0, `yuv420p`, `-an`, and `+faststart`; the poster is a frame extracted from the Mummers segment with the same crop/scale.

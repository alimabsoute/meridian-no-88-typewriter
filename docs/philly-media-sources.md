# Philadelphia TV archival media

## Delivered local loop

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

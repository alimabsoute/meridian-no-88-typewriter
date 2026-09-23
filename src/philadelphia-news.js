/** Source-hosted archival broadcasts. Nothing is copied into the app bundle.
 * Dates identify the recorded broadcast, not current news. Playback uses short
 * windows and HTTP range requests instead of downloading complete newscasts. */
// Exact derivative filenames and durations inspected in Archive's directory
// listings and decoded in Chromium on 2026-09-23. These are complete uploaded
// ad blocks (regional and national spots), not newly invented excerpt cuts.
function commercial(date, item, block, duration) {
  return Object.freeze({
    id: `wpvi-${date}-ads-${block}`,
    title: `WPVI commercials · ${date} · Reel ${block}`,
    date,
    source: `https://archive.org/details/${item}`,
    src: `https://archive.org/download/${item}/Buffy-tape-ad-block-${block}.mp4`,
    start: 0,
    end: duration,
  });
}
const september7 = (block, duration) => commercial('2001-09-07', 'wpvi-commercials-7sept2001', block, duration);
export const PHILADELPHIA_NEWS_CLIPS = Object.freeze([
  Object.freeze({
    id: 'wpvi-1993-03-25',
    title: 'Action News · March 25, 1993',
    date: '1993-03-25',
    source: 'https://archive.org/details/wpvi-tv-11pm-news-march-25-1993',
    src: 'https://archive.org/download/wpvi-tv-11pm-news-march-25-1993/WPVI-TV%2011pm%20News-%20March%2025-%201993.mp4',
    // The source opens with a VHS slate and commercials. The broadcast's
    // Philadelphia skyline opening starts here (visually checked 2026-09-18).
    start: 38,
    end: 128,
  }),
  september7(22, 151.601),
  september7(23, 70.149),
  september7(24, 150.890),
  Object.freeze({
    id: 'wpvi-1998-03-24',
    title: 'Action News · March 24, 1998',
    date: '1998-03-24',
    source: 'https://archive.org/details/6_Action_News_WPVI_TV_WOC_And_World_News_Now_1998-03-24',
    src: 'https://archive.org/download/6_Action_News_WPVI_TV_WOC_And_World_News_Now_1998-03-24/6_Action_News_WPVI_TV_WOC_And_World_News_Now_1998-03-24.mp4',
    // Skip the tape slate and stock ticker; enter on Jim Gardner's studio shot.
    start: 15,
    end: 105,
  }),
  Object.freeze({
    id: 'wpvi-2005-may-sky6',
    title: 'Action News · Sky 6 and commercial break · May 2005',
    date: '2005-05',
    source: 'https://archive.org/details/vhs-tape-discovery-channel-life-of-grime-whyy-unknown-2005.05.02-wpvi-action-new',
    src: 'https://archive.org/download/vhs-tape-discovery-channel-life-of-grime-whyy-unknown-2005.05.02-wpvi-action-new/VHS%20Tape%20-%20Discovery%20Channel%20-%20Life%20of%20Grime%20-%20WHYY%20-%20Unknown%20-%202005.05.02%20-%20WPVI%20-%20Action%20News%20-%202005.05.03%20-%20WPVI%20-%20Action%20News.mp4',
    // Tape contains May 2 and 3 broadcasts. Preserve month precision rather
    // than inventing the exact date of this excerpt. Sampled skyline at 5400
    // and an ad at 5510; not a claim of a complete editorial weather segment.
    start: 5400,
    end: 5580,
  }),
  september7(25, 120.499),
  september7(26, 120.941),
  september7(27, 74.556),
  commercial('2001-09-27', 'wpvi-commercials-27sept2001', 15, 211.949),
  september7(28, 130.814),
  september7(29, 121.605),
  september7(30, 121.160),
  september7(31, 22.265),
]);

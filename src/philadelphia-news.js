/** Source-hosted archival broadcasts. Nothing is copied into the app bundle.
 * Dates identify the recorded broadcast, not current news. Playback uses short
 * windows and HTTP range requests instead of downloading complete newscasts. */
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
    id: 'wpvi-2024-09-10',
    title: 'Action News weather · September 10, 2024',
    date: '2024-09-10',
    source: 'https://archive.org/details/wpvi-tv-11pm-news-september-10-2024',
    src: 'https://archive.org/download/wpvi-tv-11pm-news-september-10-2024/WPVI-TV%2011pm%20News%20%28September%2010%2C%202024%29.mp4',
    // Local weather with the Philadelphia skyline, after the debate footage.
    start: 1200,
    end: 1260,
  }),
]);

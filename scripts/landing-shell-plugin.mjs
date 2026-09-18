import { readFileSync } from 'node:fs';

// The downloadable edition stays self-contained. Put its critical landing
// before the large inlined simulator so streamed HTML can paint immediately.
export function landingShellPlugin() {
  return {
    name: 'octoberline-immediate-landing',
    enforce: 'post',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const css = readFileSync(new URL('../src/landing.css', import.meta.url), 'utf8');
        const controller = readFileSync(new URL('../src/landing-bootstrap.js', import.meta.url), 'utf8');
        // A small paper-and-ink overture paints with the streamed shell. It has
        // no image, font-download, JavaScript or graphics-driver dependency.
        const welcome = [
          ['Welcome, writer.', 'Set one word down.', 'Then another.', 'See where they lead.'],
          ['A page can hold', 'what a day cannot:', 'a question, a memory,', 'a small beginning.'],
          ['Words cross distance.', 'They make room', 'for another life.', 'Yours belongs here.'],
          ['No perfect first line.', 'No permission needed.', 'Just a little courage,', 'and the next word.'],
        ];
        const ink = welcome.map((lines, stanza) => {
          let offset = 0;
          const typedLines = lines.map((sentence) => {
            const letters = [...sentence].map((letter, index) => `<span style="--letter:${index + offset}">${letter}</span>`).join('');
            offset += sentence.length + 3; // A brief carriage-return breath.
            return `<span class="prelude-ink-line">${letters}</span>`;
          }).join('');
          return `<p class="prelude-stanza" style="--stanza-delay:${stanza * 9}s">${typedLines}</p>`;
        }).join('');
        // Twelve small CSS surfaces share the paper's texture. They are inert
        // until the actual renderer submits its first frame; no copied model,
        // bitmap, particle engine or per-frame JavaScript is needed.
        const fragments = Array.from({ length: 12 }, (_, index) => {
          const column = index % 3, row = Math.floor(index / 3);
          return `<i style="--tile-x:${column * 100 / 3}%;--tile-y:${row * 25}%;--grain-x:${column * 50}%;--grain-y:${row * 100 / 3}%;--flight-x:${(column - 1) * 19 + (row % 2 ? 4 : -4)}px;--flight-y:${-37 + row * 5}px;--flight-turn:${(index % 5 - 2) * 2.5}deg;--release-delay:${index % 4 * 18}ms"></i>`;
        }).join('');
        const prelude = `<div class="landing-prelude" aria-hidden="true"><span class="prelude-paper-shadow"></span><div class="prelude-paper-frame"><div class="prelude-paper"><span class="prelude-paper-imprint">OCTOBERLINE · NO. 211</span><div class="prelude-ink">${ink}</div><span class="prelude-paper-folio">YOUR WORDS BELONG HERE</span><span class="prelude-paper-curl"></span><span class="prelude-paper-fragments">${fragments}</span></div></div><span class="landing-prelude-light"></span></div>`;
        return html.replace('<!-- LANDING_STYLE -->', () => `<style id="landing-critical">${css}</style>`)
          .replace('<!-- LANDING_BOOTSTRAP -->', () => `<script>${controller}</script>`)
          .replace('<div id="landing-assembly" aria-hidden="true"></div>', () => `<div id="landing-assembly" aria-hidden="true">${prelude}</div>`)
          .replace(/\r\n?/g, '\n');
      },
    },
    generateBundle(_, bundle) {
      const page = bundle['index.html'];
      if (!page) return;
      const deferred = [];
      page.source = String(page.source).replace(/<head>([\s\S]*?)<\/head>/, (_, head) => {
        const criticalHead = head.replace(/<script\b[^>]*type="module"[^>]*>[\s\S]*?<\/script>|<style\b(?![^>]*id="(?:landing-critical|updates-signup-critical)")[^>]*>[\s\S]*?<\/style>/g, tag => {
          deferred.push(tag);
          return '';
        });
        return `<head>${criticalHead}</head>`;
      });
      page.source = page.source.replace('</body>', () => `${deferred.join('\n')}\n</body>`);
    },
  };
}

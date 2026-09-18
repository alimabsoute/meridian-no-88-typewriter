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
        return html.replace('<!-- LANDING_STYLE -->', () => `<style id="landing-critical">${css}</style>`)
          .replace('<!-- LANDING_BOOTSTRAP -->', () => `<script>${controller}</script>`)
          .replace(/\r\n?/g, '\n');
      },
    },
    generateBundle(_, bundle) {
      const page = bundle['index.html'];
      if (!page) return;
      const deferred = [];
      page.source = String(page.source).replace(/<head>([\s\S]*?)<\/head>/, (_, head) => {
        const criticalHead = head.replace(/<script\b[^>]*type="module"[^>]*>[\s\S]*?<\/script>|<style\b(?![^>]*id="landing-critical")[^>]*>[\s\S]*?<\/style>/g, tag => {
          deferred.push(tag);
          return '';
        });
        return `<head>${criticalHead}</head>`;
      });
      page.source = page.source.replace('</body>', () => `${deferred.join('\n')}\n</body>`);
    },
  };
}

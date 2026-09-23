import { describe, it, expect } from 'vitest';
import { landingShellPlugin } from './landing-shell-plugin.mjs';
import { readFileSync } from 'node:fs';

describe('streamable standalone landing', () => {
  it('places a small paper-and-ink overture before the simulator without any image dependency', () => {
    const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const html = landingShellPlugin().transformIndexHtml.handler(source);
    const overture = html.slice(html.indexOf('<div class="landing-prelude"'), html.indexOf('<div class="landing-stage-caption"'));
    expect(overture.length).toBeLessThan(30000);
    expect(overture).toContain('class="prelude-paper"');
    expect(overture).toContain('class="prelude-ink-line"');
    const words = overture.replace(/<[^>]*>/g, '');
    expect(words).toContain('Welcome, writer.');
    expect(words).toContain('Words cross distance.');
    expect(words).toContain('No permission needed.');
    expect(overture.match(/class="prelude-stanza"/g)).toHaveLength(4);
    expect(overture).not.toContain('--release-delay:');
    expect(overture).not.toContain('prelude-smoke');
    expect(overture).not.toMatch(/<img|<canvas|<video|data:image|src=/);
    expect(html.indexOf('class="landing-prelude"')).toBeLessThan(html.indexOf('src="/src/main.js"'));
    expect(html).toContain('paper-overture-feed');
    expect(html).toContain('prefers-reduced-motion: reduce');
  });

  it('produces the same shell from Windows and Unix checkouts', () => {
    const html = '<html>\n<!-- LANDING_STYLE -->\n<body>\n<!-- LANDING_BOOTSTRAP -->\n</body></html>';
    const transform = landingShellPlugin().transformIndexHtml.handler;
    expect(transform(html.replaceAll('\n', '\r\n'))).toBe(transform(html));
    expect(transform(html)).not.toContain('\r');
  });

  it('moves the simulator after the visible shell without interpolating its JavaScript', () => {
    const script = '<script type="module">const template = "$& $` $\' $$";</script>';
    const critical = '<style id="landing-critical">.intro{color:gold}</style>';
    const signup = '<style id="updates-signup-critical">.updates{color:gold}</style>';
    const roomCss = '<style>.room{color:black}</style>';
    const bundle = { 'index.html': { source: `<html><head>${critical}${signup}${script}${roomCss}</head><body><h1>Write now</h1></body></html>` } };
    landingShellPlugin().generateBundle({}, bundle);
    const html = bundle['index.html'].source;
    expect(html.slice(0, html.indexOf('</head>'))).toContain(critical);
    expect(html.slice(0, html.indexOf('</head>'))).toContain(signup);
    expect(html.indexOf(script)).toBeGreaterThan(html.indexOf('<h1>'));
    expect(html).toContain(script);
    expect(html).toContain(roomCss);
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html.match(/<\/body>/g)).toHaveLength(1);
  });
});

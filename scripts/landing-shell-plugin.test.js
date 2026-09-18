import { describe, it, expect } from 'vitest';
import { landingShellPlugin } from './landing-shell-plugin.mjs';

describe('streamable standalone landing', () => {
  it('moves the simulator after the visible shell without interpolating its JavaScript', () => {
    const script = '<script type="module">const template = "$& $` $\' $$";</script>';
    const critical = '<style id="landing-critical">.intro{color:gold}</style>';
    const roomCss = '<style>.room{color:black}</style>';
    const bundle = { 'index.html': { source: `<html><head>${critical}${script}${roomCss}</head><body><h1>Write now</h1></body></html>` } };
    landingShellPlugin().generateBundle({}, bundle);
    const html = bundle['index.html'].source;
    expect(html.slice(0, html.indexOf('</head>'))).toContain(critical);
    expect(html.indexOf(script)).toBeGreaterThan(html.indexOf('<h1>'));
    expect(html).toContain(script);
    expect(html).toContain(roomCss);
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html.match(/<\/body>/g)).toHaveLength(1);
  });
});

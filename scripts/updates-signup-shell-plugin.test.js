import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { renderUpdatesSignup } from './updates-signup-shell-plugin.mjs';

describe('shared updates signup shell', () => {
  it('puts a complete independently bootable signup on every shipped page', async () => {
    for (const route of ['index.html', 'coming-soon/community/index.html', 'coming-soon/writing-board/index.html']) {
      const source = await readFile(new URL(`../${route}`, import.meta.url), 'utf8');
      const html = await renderUpdatesSignup(source);
      expect(html.match(/id="updates-rail"/g)).toHaveLength(1);
      expect(html.match(/id="updates-receipt"/g)).toHaveLength(1);
      expect(html).not.toContain('<!-- UPDATES_SIGNUP');
      expect(html.indexOf('id="updates-signup-critical"')).toBeLessThan(html.indexOf('</head>'));
      const scriptStart = html.indexOf('<script>(function () {');
      const controller = html.slice(scriptStart + 8, html.indexOf('</script>', scriptStart));
      expect(controller).toContain('/api/updates-signup');
      expect(controller).not.toMatch(/^\s*(?:import|export)\s/m);
      expect(() => new Function(controller)).not.toThrow();
      expect(scriptStart).toBeLessThan(html.indexOf('<main'));
    }
  });

  it('keeps the shell small and unchanged on a second transform', async () => {
    const source = '<html><head><!-- UPDATES_SIGNUP_STYLE --></head><body><!-- UPDATES_SIGNUP --></body></html>';
    const html = await renderUpdatesSignup(source);
    expect(Buffer.byteLength(html)).toBeLessThan(18000);
    expect(await renderUpdatesSignup(html)).toBe(html);
    expect(html).toContain('prefers-reduced-motion: reduce');
    expect(html).toContain('Enable JavaScript to sign up');
  });
});

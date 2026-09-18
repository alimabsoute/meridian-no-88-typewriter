import { readFile } from 'node:fs/promises';

let compiledShell;
async function loadShell() {
  if (!compiledShell) compiledShell = Promise.all([
    readFile(new URL('../src/updates-signup.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/updates-signup.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/updates-signup.js', import.meta.url), 'utf8'),
  ]).then(([markup, css, controller]) => {
    // This controller is dependency-free browser JavaScript. Its named
    // function exports exist for unit tests; the early HTML shell runs the
    // same source in a classic-script closure, without a compiler process.
    const classic = controller.replace(/^export (?=(?:async )?function )/gm, '');
    if (/^\s*(?:import|export)\s/m.test(classic)) throw new Error('The signup shell must stay dependency-free.');
    return { markup, css, controller: `(function () {\n${classic}\n})();` };
  });
  return compiledShell;
}

export async function renderUpdatesSignup(html) {
  if (!html.includes('<!-- UPDATES_SIGNUP -->')) return html;
  const shell = await loadShell();
  return html
    .replace('<!-- UPDATES_SIGNUP_STYLE -->', () => `<style id="updates-signup-critical">${shell.css}</style>`)
    .replace('<!-- UPDATES_SIGNUP -->', () => `${shell.markup}\n<script>${shell.controller}</script>`);
}

export function updatesSignupShellPlugin() {
  return {
    name: 'octoberline-updates-signup',
    transformIndexHtml: { order: 'pre', handler: renderUpdatesSignup },
    handleHotUpdate({ file, server }) {
      if (/updates-signup\.(?:html|css|js)$/.test(file)) {
        compiledShell = null;
        server.ws.send({ type: 'full-reload' });
      }
    },
  };
}

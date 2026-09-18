import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Run the real, isolated guide controller without WebGL or a browser process.
// Browser inspection still verifies layout and the CSS demonstrations.
const root = new URL('../', import.meta.url);
const html = await fs.readFile(new URL('index.html', root), 'utf8');
const main = await fs.readFile(new URL('src/main.js', root), 'utf8');
const coachMarkup = html.match(/<aside class="first-sheet-coach[\s\S]*?<\/aside>/)?.[0];
assert.ok(coachMarkup, 'First-sheet guide markup exists.');
const steps = [...coachMarkup.matchAll(/<li[^>]*data-coach-action="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map(([, action, content]) => ({
  action,
  content,
  instruction: content.match(/<p class="coach-instruction">([\s\S]*?)<\/p>/)?.[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
  attributes: new Map(),
  active: false,
  classList: { toggle(name, active) { assert.equal(name, 'active'); this.owner.active = active; } },
  setAttribute(name, value) { this.attributes.set(name, value); },
  removeAttribute(name) { this.attributes.delete(name); },
}));
steps.forEach((step) => { step.classList.owner = step; });
const events = new Map();
const refs = Object.fromEntries(['coach-progress', 'coach-next', 'coach-skip', 'coach-dismiss', 'coach-open'].map((id) => [id, {
  textContent: '',
  addEventListener(type, listener) { events.set(`${id}:${type}`, listener); },
}]));
refs['first-sheet-coach'] = {
  hidden: true,
  querySelectorAll(selector) { assert.equal(selector, '[data-coach-action]'); return steps; },
  querySelector(selector) {
    assert.equal(selector, '[aria-current="step"] .coach-instruction');
    return { textContent: steps.find((step) => step.attributes.get('aria-current') === 'step')?.instruction };
  },
};
let guideClosed = false;
refs['field-guide'] = { close(reason) { assert.equal(reason, 'coach'); guideClosed = true; } };
let focuses = 0;
const announcements = [];
const storage = new Map();
const context = vm.createContext({
  refs,
  FIRST_SHEET_TUTORIAL_KEY: 'first-sheet-test',
  localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  announce: (text) => announcements.push(text),
  showToast: () => {},
  focusMachine: () => { focuses += 1; },
  setTimeout: (fn) => fn(),
});
const start = main.indexOf('const FIRST_SHEET_ACTIONS =');
const end = main.indexOf('function archiveWarningMessage(', start);
assert.ok(start >= 0 && end > start, 'Guide controller boundaries are present.');
vm.runInContext(main.slice(start, end), context);
const run = (code) => vm.runInContext(code, context);
const results = [];
const check = (name, test) => { test(); results.push({ name, passed: true }); };

check('Five existing actions retain their order', () => assert.deepEqual(steps.map((step) => step.action), ['type', 'shift', 'return', 'bell', 'release']));
check('Every step has a readable instruction and a decorative-only demonstration', () => steps.forEach((step) => {
  assert.ok(step.instruction?.length > 35);
  assert.match(step.content, /class="coach-demo[^\"]*" aria-hidden="true"/);
  assert.doesNotMatch(step.content, /<(?:button|input|textarea)\b/);
}));
check('Enter is named in its instruction and highlighted on the miniature keyboard', () => {
  assert.match(steps[2].instruction, /press Enter/);
  assert.match(steps[2].content, /class="coach-key-wide coach-key-active">Enter ↵<\/kbd>/);
});
check('First visit shows step one and marks only that step current', () => {
  assert.equal(run('showFirstSheetCoach()'), true);
  assert.equal(refs['first-sheet-coach'].hidden, false);
  assert.equal(refs['coach-progress'].textContent, '01 / 05');
  assert.equal(steps.filter((step) => step.active).length, 1);
  assert.equal(steps[0].attributes.get('aria-current'), 'step');
});
check('Announcements describe the instruction without reading decorative keyboard letters', () => {
  assert.ok(announcements[0].includes(steps[0].instruction));
  assert.doesNotMatch(announcements[0], /QWERTY|KEY → INK/);
});
check('An unrelated machine action cannot skip a step', () => {
  assert.equal(run("advanceFirstSheetCoach('return')"), false);
  assert.equal(refs['coach-progress'].textContent, '01 / 05');
});
for (const [index, action] of ['type', 'shift', 'return', 'bell'].entries()) {
  check(`Real ${action} action advances to step ${index + 2}`, () => {
    assert.equal(run(`advanceFirstSheetCoach('${action}')`), true);
    assert.equal(refs['coach-progress'].textContent, `0${index + 2} / 05`);
    assert.equal(steps.filter((step) => step.active).length, 1);
    assert.equal(steps[index + 1].attributes.get('aria-current'), 'step');
  });
}
check('Last step provides the ready-to-write action', () => assert.equal(refs['coach-next'].textContent, 'READY TO WRITE'));
check('Release completes and persists the guide', () => {
  assert.equal(run("advanceFirstSheetCoach('release')"), true);
  assert.equal(refs['first-sheet-coach'].hidden, true);
  assert.equal(storage.get('first-sheet-test'), 'complete');
});
check('A completed guide does not automatically reopen', () => assert.equal(run('showFirstSheetCoach()'), false));
check('Replay closes the manual and resets progress without modifying a document', () => {
  events.get('coach-open:click')();
  assert.equal(guideClosed, true);
  assert.equal(refs['coach-progress'].textContent, '01 / 05');
  assert.equal(refs['first-sheet-coach'].hidden, false);
  assert.equal(focuses, 1);
});
check('Next advances explicitly and restores machine focus', () => {
  events.get('coach-next:click')();
  assert.equal(refs['coach-progress'].textContent, '02 / 05');
  assert.equal(focuses, 2);
});
check('Skip dismisses and persists without another step', () => {
  events.get('coach-skip:click')();
  assert.equal(refs['first-sheet-coach'].hidden, true);
  assert.equal(storage.get('first-sheet-test'), 'dismissed');
  assert.equal(focuses, 3);
});
check('Close button independently dismisses and restores focus', () => {
  run('showFirstSheetCoach({ reset: true })');
  events.get('coach-dismiss:click')();
  assert.equal(refs['first-sheet-coach'].hidden, true);
  assert.equal(focuses, 4);
});
check('Unavailable storage does not break the guide', () => {
  context.localStorage.getItem = () => { throw new Error('blocked storage'); };
  context.localStorage.setItem = () => { throw new Error('blocked storage'); };
  assert.equal(run('showFirstSheetCoach({ reset: true })'), true);
  run("finishFirstSheetCoach('dismissed')");
  assert.equal(refs['first-sheet-coach'].hidden, true);
});
const report = { mode: 'native controller and source checks; no browser or rendered-motion claims', passed: results.length, results };
await fs.mkdir(new URL('visual-checks/', root), { recursive: true });
await fs.writeFile(new URL('visual-checks/first-sheet-guide-native.json', root), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

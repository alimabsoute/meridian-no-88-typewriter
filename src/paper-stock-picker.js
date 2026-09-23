import { PAPER_STOCKS, drawPaperStock, normalizePaperStock } from './paper-stock.js';

export const PAPER_PREVIEW_DETAILS = Object.freeze({
  bond: 'Smooth, bright, and crisp',
  cotton: 'Warm ivory with fine fibers',
  onionskin: 'Pale, delicate, softly creased',
  laid: 'Cream with fine laid lines',
});

export function paintPaperPreview(canvas, id) {
  const context = canvas.getContext('2d');
  if (!context) return;
  canvas.width = 440;
  canvas.height = 560;
  let seed = 211;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  drawPaperStock(context, canvas.width, canvas.height, id, random, 0.8);
  context.fillStyle = '#171717';
  context.font = '20px "Courier New", monospace';
  ['Every story begins', 'with a single word.', '', 'Make room for yours.'].forEach((line, i) => {
    context.fillText(line, 36, 145 + i * 34);
  });
}

/** Keep the existing select/change path as the single source of paper preference. */
export function initPaperStockPicker({ select, documentRef = document }) {
  if (!select) return null;
  const original = select.closest('.paper-stock-field');
  const field = documentRef.createElement('div');
  field.className = 'paper-stock-field';
  if (original) original.replaceWith(field);
  else select.before(field);
  field.append(select);
  select.hidden = true;
  select.tabIndex = -1;
  select.removeAttribute('aria-describedby');

  const button = documentRef.createElement('button');
  button.type = 'button';
  button.className = 'paper-picker-trigger';
  button.setAttribute('aria-haspopup', 'dialog');
  field.append(button);
  const dialog = documentRef.createElement('dialog');
  dialog.className = 'paper-picker-dialog ui-layer';
  dialog.id = 'paper-stock-gallery';
  dialog.setAttribute('aria-labelledby', 'paper-picker-title');
  button.setAttribute('aria-controls', dialog.id);
  const header = documentRef.createElement('header');
  const title = documentRef.createElement('h2');
  title.id = 'paper-picker-title';
  title.textContent = 'Choose your next sheet';
  const close = documentRef.createElement('button');
  close.type = 'button';
  close.className = 'paper-picker-close';
  close.textContent = 'Close';
  close.setAttribute('aria-label', 'Close paper chooser');
  header.append(title, close);
  const intro = documentRef.createElement('p');
  intro.className = 'paper-picker-intro';
  intro.textContent = 'Pick a finish for fresh sheets. Your current page stays as it is.';
  const grid = documentRef.createElement('div');
  grid.className = 'paper-picker-grid';
  const choices = new Map();
  let painted = false;
  for (const [id, stock] of Object.entries(PAPER_STOCKS)) {
    const choice = documentRef.createElement('button');
    choice.type = 'button';
    choice.className = `paper-picker-choice paper-picker-${id}`;
    choice.dataset.stock = id;
    choice.setAttribute('aria-label', `${stock.name}. ${PAPER_PREVIEW_DETAILS[id]}`);
    const canvas = documentRef.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const name = documentRef.createElement('strong');
    name.textContent = stock.name;
    const description = documentRef.createElement('span');
    description.textContent = PAPER_PREVIEW_DETAILS[id];
    const selected = documentRef.createElement('small');
    selected.className = 'paper-picker-selected';
    selected.textContent = 'Selected';
    choice.append(canvas, name, description, selected);
    choice.addEventListener('click', () => {
      select.value = id;
      select.dispatchEvent(new documentRef.defaultView.Event('change', { bubbles: true }));
      sync();
      dialog.close();
    });
    choices.set(id, { choice, canvas });
    grid.append(choice);
  }
  dialog.append(header, intro, grid);
  (documentRef.getElementById('app') ?? documentRef.body).append(dialog);
  function sync() {
    const id = normalizePaperStock(select.value);
    button.textContent = `Paper · ${PAPER_STOCKS[id].name}  ›`;
    button.setAttribute('aria-label', `Choose paper. Current selection: ${PAPER_STOCKS[id].name}`);
    choices.forEach(({ choice }, key) => choice.setAttribute('aria-pressed', String(key === id)));
  }
  const open = () => {
    sync();
    if (!painted) {
      choices.forEach(({ canvas }, id) => paintPaperPreview(canvas, id));
      painted = true;
    }
    if (!dialog.open) dialog.showModal();
    choices.get(normalizePaperStock(select.value)).choice.focus();
  };
  button.addEventListener('click', open);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('pointerdown', event => event.stopPropagation());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => button.focus());
  select.addEventListener('change', sync);
  sync();
  return { button, dialog, open, destroy() {
    select.removeEventListener('change', sync);
    button.removeEventListener('click', open);
    dialog.remove();
    button.remove();
    select.hidden = false;
    select.removeAttribute('tabindex');
  } };
}

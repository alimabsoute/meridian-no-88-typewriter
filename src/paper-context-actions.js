/** Reuse the real buttons so keyboard, hold-to-discard and persistence stay intact. */
export function paperActionState(overview, busy = false) {
  const loose = Boolean(overview.looseSheet?.page);
  const empty = !overview.insertedSheet && !loose;
  return { visible: !busy && (loose || empty), chooseStock: empty,
    label: loose ? 'What would you like to do with this page?' : 'Ready for your next page?' };
}

export function initPaperContextActions(documentRef = document) {
  const tray = documentRef.createElement('section');
  tray.className = 'paper-context-actions ui-layer';
  tray.setAttribute('aria-label', 'Paper actions');
  tray.hidden = true;
  const heading = documentRef.createElement('span');
  heading.className = 'paper-context-heading';
  tray.append(heading);
  const stock = documentRef.getElementById('paper-stock')?.closest('.paper-stock-field');
  if (stock) tray.append(stock);
  for (const id of ['keep-sheet', 'reinsert-sheet', 'crumple-sheet', 'load-sheet']) {
    const button = documentRef.getElementById(id);
    if (button) tray.append(button);
  }
  documentRef.getElementById('app').append(tray);
  return {
    update(overview, busy) {
      const state = paperActionState(overview, busy);
      tray.hidden = !state.visible;
      documentRef.getElementById('app').classList.toggle('paper-context-active', state.visible);
      heading.textContent = state.label;
      if (stock) stock.hidden = !state.chooseStock;
    },
  };
}

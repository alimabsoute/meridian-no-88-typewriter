/** Compact workbench. Existing controls retain their original event handlers. */
export function initWorkbench({ onOpen = () => {}, onClose = () => {} } = {}) {
  const app = document.querySelector('#app');
  const toolbar = document.querySelector('.workbench-toolbar');
  if (!app || !toolbar || app.classList.contains('workbench-ready')) return;
  const paper = document.querySelector('.document-tray');
  const room = document.querySelector('.environment-card');
  const machine = document.querySelector('.mechanism-card');
  const view = document.querySelector('.view-dial');
  const ink = document.querySelector('.ink-selector');
  const buttons = [...toolbar.querySelectorAll('[data-workbench]')];
  const more = document.querySelector('#workbench-more');
  const moreMenu = document.querySelector('#workbench-more-menu');
  function setMore(open, focus = false) {
    if (!moreMenu || !more) return;
    moreMenu.hidden = !open;
    more.setAttribute('aria-expanded', String(open));
    if (focus) (open ? moreMenu.querySelector('button') : more).focus({ preventScroll: true });
  }
  more?.addEventListener('click', () => {
    const open = moreMenu.hidden;
    if (current) setPanel('', { focus: false });
    setMore(open, true);
  });
  const panels = { paper, export: paper, machine, room, view, ink };
  document.querySelector('#document-toggle').tabIndex = -1;
  room.querySelector('summary').tabIndex = -1;
  let current = '';
  let changing = false;
  app.classList.add('workbench-ready');
  for (const [name, panel] of Object.entries(panels)) {
    if (name === 'export') continue;
    panel.id ||= `workbench-${name}-panel`;
    panel.classList.add('workbench-panel');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'workbench-close';
    close.setAttribute('aria-label', `Close ${name === 'paper' ? 'paper and export' : name} controls`);
    close.textContent = '×';
    close.addEventListener('click', () => setPanel(''));
    panel.append(close);
  }
  buttons.forEach((button) => button.setAttribute('aria-controls', panels[button.dataset.workbench].id));
  // Preserve the ink selectors and give their swatches readable names.
  ink.querySelectorAll('[data-ink]').forEach((button) => {
    const label = document.createElement('span');
    label.textContent = { black: 'Black', red: 'Red', stencil: 'Stencil' }[button.dataset.ink];
    button.append(label);
  });
  function render() {
    app.dataset.workbenchPanel = current;
    paper.querySelector('.tray-handle b').textContent = current === 'export' ? 'EXPORT' : 'PAPER';
    buttons.forEach((button) => button.setAttribute('aria-expanded', String(button.dataset.workbench === current)));
    new Set(Object.values(panels)).forEach((panel) => { panel.inert = panel !== panels[current]; });
  }
  function setPanel(name, { focus = true, native = false } = {}) {
    if (changing || name === current) return;
    changing = true;
    const previous = current;
    current = name;
    setMore(false);
    if (!native) {
      // Route through the original actions to preserve desk refresh and input release.
      if (paper.classList.contains('open') && !['paper', 'export'].includes(name)) document.querySelector('#document-toggle').click();
      if (room.open && name !== 'room') room.open = false;
      if (machine.classList.contains('mobile-open') && name !== 'machine') document.querySelector('#mobile-mechanics-close').click();
      if (['paper', 'export'].includes(name) && !paper.classList.contains('open')) document.querySelector('#document-toggle').click();
      if (name === 'room') room.open = true;
      if (name === 'machine' && !machine.classList.contains('mobile-open')) document.querySelector('#mobile-mechanics-toggle').click();
    }
    render();
    changing = false;
    if (name) {
      onOpen(name);
      if (focus) panels[name].querySelector('.workbench-close').focus({ preventScroll: true });
    } else {
      onClose(previous);
      if (focus) {
        const previousButton = buttons.find((button) => button.dataset.workbench === previous);
        (moreMenu?.contains(previousButton) ? more : previousButton)?.focus({ preventScroll: true });
      }
    }
  }
  buttons.forEach((button) => button.addEventListener('click', () => setPanel(current === button.dataset.workbench ? '' : button.dataset.workbench)));
  for (const panel of [view, ink]) panel.addEventListener('click', (event) => {
    if (event.target.closest('[data-view], [data-ink]')) setPanel('', { focus: false });
  }, true);
  // The original outside-dismiss handler must not close a panel before its toggle fires.
  toolbar.addEventListener('pointerdown', (event) => event.stopPropagation());
  document.addEventListener('pointerdown', (event) => {
    if (!toolbar.contains(event.target)) setMore(false);
    if (current && !panels[current].contains(event.target) && !toolbar.contains(event.target)) setPanel('', { focus: false });
  });
  document.addEventListener('keydown', (event) => {
    if (document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape' && moreMenu && !moreMenu.hidden) {
      event.preventDefault(); event.stopPropagation(); setMore(false, true); return;
    }
    if (event.key !== 'Escape' || !current || document.querySelector('#field-guide').open) return;
    event.preventDefault();
    event.stopPropagation();
    setPanel('');
  }, true);
  // Keep scene-driven paper actions and legacy controls in sync with the toolbar.
  const observer = new MutationObserver(() => {
    if (changing) return;
    if (paper.classList.contains('open')) {
      if (!['paper', 'export'].includes(current)) setPanel('paper', { native: true, focus: false });
    } else if (room.open) {
      if (current !== 'room') setPanel('room', { native: true, focus: false });
    } else if (machine.classList.contains('mobile-open')) {
      if (current !== 'machine') setPanel('machine', { native: true, focus: false });
    } else if (['paper', 'export', 'room', 'machine'].includes(current)) setPanel('', { native: true, focus: false });
  });
  observer.observe(paper, { attributes: true, attributeFilter: ['class'] });
  observer.observe(room, { attributes: true, attributeFilter: ['open'] });
  observer.observe(machine, { attributes: true, attributeFilter: ['class'] });
  render();
  return { close: () => setPanel(''), open: (name) => { if (panels[name]) setPanel(name); }, destroy: () => observer.disconnect() };
}

const filterButtons = [...document.querySelectorAll('.category-button')];
const writingCards = [...document.querySelectorAll('.writing-card')];
const emptyState = document.querySelector('.empty-state');

function setFilter(filter) {
  let visible = 0;

  for (const button of filterButtons) {
    const active = button.dataset.filter === filter;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }

  for (const card of writingCards) {
    const categories = card.dataset.category.split(' ');
    const matches = filter === 'all' || categories.includes(filter);
    card.hidden = !matches;
    if (matches) visible += 1;
  }

  emptyState.hidden = visible > 0;
  document.querySelector('#sample-grid').setAttribute(
    'aria-label',
    `${visible} fictional sample ${visible === 1 ? 'page' : 'pages'} shown`,
  );
}

for (const button of filterButtons) {
  button.addEventListener('click', () => setFilter(button.dataset.filter));
}

const flowSteps = [...document.querySelectorAll('.flow-step')];
const flowPanels = [...document.querySelectorAll('.flow-detail')];

function setFlowStep(step) {
  for (const item of flowSteps) {
    const active = item.dataset.step === step;
    item.classList.toggle('is-current', active);
    item.querySelector('button').setAttribute('aria-expanded', String(active));
  }

  for (const panel of flowPanels) {
    const active = panel.dataset.panel === step;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  }
}

for (const item of flowSteps) {
  item.querySelector('button').addEventListener('click', () => setFlowStep(item.dataset.step));
}

document.documentElement.dataset.enhanced = 'true';

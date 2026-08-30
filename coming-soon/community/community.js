const sampleProfiles = {
  olympia: {
    code: 'PHL–211–0042',
    place: 'GERMANTOWN · FICTIONAL SAMPLE',
    title: 'Olympia SM3',
    facts: [
      ['YEAR RANGE', '1954 · sample estimate'],
      ['FORMAT', 'Basket-shift portable'],
      ['TYPEFACE', 'Elite · 12 characters per inch'],
      ['CONDITION', 'Writing; carriage and escapement serviced'],
      ['SERIAL', 'Hidden by contributor setting'],
    ],
    story: '“The fictional keeper learned on this machine at a neighborhood writing table. Its carriage return is deliberately left a little firm—the sound that says the line is finished.”',
  },
  smith: {
    code: 'PHL–211–0068',
    place: 'SOUTH PHILADELPHIA · FICTIONAL SAMPLE',
    title: 'Smith-Corona Silent-Super',
    facts: [
      ['YEAR RANGE', '1956 · sample estimate'],
      ['FORMAT', 'Segment-shift portable'],
      ['TYPEFACE', 'Pica · 10 characters per inch'],
      ['CONDITION', 'Writing; platen and feet replaced'],
      ['SERIAL', 'Private; moderator-verifiable only'],
    ],
    story: '“A made-up flea-market find, carried home in its case and cleaned one careful evening at a time. The bell is brighter than the bodywork suggests.”',
  },
  underwood: {
    code: 'PHL–211–0103',
    place: 'WEST PHILADELPHIA · FICTIONAL SAMPLE',
    title: 'Underwood No. 6',
    facts: [
      ['YEAR RANGE', '1937 · sample estimate'],
      ['FORMAT', 'Desktop standard'],
      ['TYPEFACE', 'Pica · 10 characters per inch'],
      ['CONDITION', 'Working shared machine; repair log kept'],
      ['SERIAL', 'Last four digits visible by choice'],
    ],
    story: '“In this sample history, the Underwood stays on a shared desk. New writers sign the maintenance card after their first full page, adding one more line to its provenance.”',
  },
};

const filterButtons = [...document.querySelectorAll('.filter-button')];
const machineCards = [...document.querySelectorAll('.machine-card')];
const count = document.querySelector('#registry-count');

function setFilter(filter) {
  let visible = 0;
  machineCards.forEach((card) => {
    const show = filter === 'all' || card.dataset.kind === filter;
    card.hidden = !show;
    if (show) visible += 1;
  });

  filterButtons.forEach((button) => {
    const selected = button.dataset.filter === filter;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });

  count.textContent = `${visible} fictional sample record${visible === 1 ? '' : 's'}`;
}

filterButtons.forEach((button) => {
  button.addEventListener('click', () => setFilter(button.dataset.filter));
});

const dialog = document.querySelector('#profile-dialog');
const profileCode = document.querySelector('#profile-code');
const profilePlace = document.querySelector('#profile-place');
const profileTitle = document.querySelector('#profile-title');
const profileDetails = document.querySelector('#profile-details');
const profileStory = document.querySelector('#profile-story');

function populateProfile(profile) {
  profileCode.textContent = profile.code;
  profilePlace.textContent = profile.place;
  profileTitle.textContent = profile.title;
  profileDetails.replaceChildren(
    ...profile.facts.map(([term, description]) => {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = term;
      dd.textContent = description;
      row.append(dt, dd);
      return row;
    }),
  );
  profileStory.textContent = profile.story;
}

document.querySelectorAll('[data-profile]').forEach((button) => {
  button.addEventListener('click', () => {
    const profile = sampleProfiles[button.dataset.profile];
    if (!profile) return;
    populateProfile(profile);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });
});

dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  const withinDialog = event.clientX >= bounds.left
    && event.clientX <= bounds.right
    && event.clientY >= bounds.top
    && event.clientY <= bounds.bottom;
  if (!withinDialog) dialog.close();
});

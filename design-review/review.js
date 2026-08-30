import '@fontsource/bebas-neue/400.css';
import '@fontsource/special-elite/400.css';
import './review.css';

const options = [...document.querySelectorAll('.identity-option')];
const homeBrand = document.querySelector('.home-brand');

function selectLogo(name) {
  for (const option of options) {
    const selected = option.dataset.logo === name;
    option.classList.toggle('selected', selected);
    option.setAttribute('aria-checked', String(selected));
  }
  homeBrand.dataset.selectedLogo = name;
}

for (const option of options) {
  option.addEventListener('click', () => selectLogo(option.dataset.logo));
}

document.querySelector('.home-primary').addEventListener('pointerenter', () => {
  document.querySelector('.homepage-frame').classList.add('key-preview');
});

document.querySelector('.home-primary').addEventListener('pointerleave', () => {
  document.querySelector('.homepage-frame').classList.remove('key-preview');
});

document.querySelector('.home-primary').addEventListener('focus', () => {
  document.querySelector('.homepage-frame').classList.add('key-preview');
});

document.querySelector('.home-primary').addEventListener('blur', () => {
  document.querySelector('.homepage-frame').classList.remove('key-preview');
});

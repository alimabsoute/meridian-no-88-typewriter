export function validateUpdatesEmail(value) {
  const email = String(value ?? '').trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function requestUpdatesSignup({ email, source, website = '', fetchImpl = globalThis.fetch, timeoutMs = 15000, signal: parentSignal } = {}) {
  const normalizedEmail = String(email ?? '').trim();
  if (!validateUpdatesEmail(normalizedEmail)) throw new Error('Please enter a valid email address.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, timeoutMs);
  try {
    const response = await fetchImpl('/api/updates-signup', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, source: String(source || '/').slice(0, 300), website: String(website).slice(0, 200), consent: 'updates-v1' }),
      signal: controller.signal,
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('We couldn’t confirm your signup. Please try again.'); }
    if (!response.ok || result?.ok !== true) {
      const message = typeof result?.error === 'string' ? result.error.trim().slice(0, 200) : '';
      throw new Error(message || 'We couldn’t save your email. Please try again.');
    }
    return { ok: true };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('That took too long. Please try again.');
    if (error instanceof TypeError) throw new Error('We couldn’t connect. Check your connection and try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', abort);
  }
}

export function mountUpdatesSignup(documentRef = document, windowRef = window) {
  const rail = documentRef.getElementById('updates-rail');
  const form = documentRef.getElementById('updates-form');
  if (!rail || !form || form.dataset.signupReady) return;
  form.dataset.signupReady = 'true';
  const email = documentRef.getElementById('updates-email');
  const website = documentRef.getElementById('updates-website');
  const submit = documentRef.getElementById('updates-submit');
  const label = submit.querySelector('span');
  const status = documentRef.getElementById('updates-status');
  const toggle = documentRef.getElementById('updates-toggle');
  const content = documentRef.getElementById('updates-content');
  const receipt = documentRef.getElementById('updates-receipt');
  const confetti = receipt.querySelector('.updates-confetti');
  let pending = false;
  let confettiTimer;
  let restoreFocus;
  const updateInset = () => documentRef.documentElement.style.setProperty('--updates-height', `${Math.ceil(rail.getBoundingClientRect().height)}px`);
  // Keep the form mounted: collapsing must never discard a draft or cancel a save.
  function setCollapsed(collapsed) {
    content.hidden = collapsed;
    rail.dataset.collapsed = String(collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Show updates signup' : 'Hide updates signup');
    toggle.textContent = collapsed ? 'Updates ↓' : 'Hide ↑';
    updateInset();
  }
  if (toggle && content) {
    toggle.hidden = false;
    setCollapsed(false);
    toggle.addEventListener('click', () => {
      const collapsing = !content.hidden;
      setCollapsed(collapsing);
      (collapsing ? toggle : email).focus({ preventScroll: true });
    });
  }
  if (documentRef.getElementById('app')) documentRef.body.classList.add('updates-app');
  updateInset();
  const resizeObserver = typeof windowRef.ResizeObserver === 'function' ? new windowRef.ResizeObserver(updateInset) : null;
  resizeObserver?.observe(rail);
  if (!resizeObserver) windowRef.addEventListener('resize', updateInset, { passive: true });

  function clearCelebration() {
    clearTimeout(confettiTimer);
    confetti.replaceChildren();
  }
  function closeReceipt() {
    if (typeof receipt.close === 'function') receipt.close();
    else receipt.removeAttribute('open');
    clearCelebration();
    (content?.hidden ? toggle : restoreFocus)?.focus({ preventScroll: true });
  }
  function celebrate() {
    restoreFocus = documentRef.activeElement;
    if (typeof receipt.showModal === 'function') receipt.showModal();
    else receipt.setAttribute('open', '');
    receipt.querySelector('.updates-receipt-done').focus({ preventScroll: true });
    if (!windowRef.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      const colors = ['#aa703c', '#b69756', '#657458', '#947857'];
      for (let index = 0; index < 26; index++) {
        const piece = documentRef.createElement('i');
        piece.style.setProperty('--confetti-x', `${3 + (index * 37) % 94}%`);
        piece.style.setProperty('--confetti-color', colors[index % colors.length]);
        piece.style.setProperty('--confetti-delay', `${(index % 7) * 35}ms`);
        piece.style.setProperty('--confetti-drift', `${(index % 2 ? 1 : -1) * (20 + index % 5 * 12)}px`);
        piece.style.setProperty('--confetti-rotation', `${(index % 2 ? 1 : -1) * (90 + index * 21)}deg`);
        confetti.append(piece);
      }
      confettiTimer = setTimeout(clearCelebration, 2000);
    }
  }
  receipt.querySelectorAll('button').forEach(button => button.addEventListener('click', closeReceipt));
  receipt.addEventListener('close', clearCelebration);
  receipt.addEventListener('cancel', () => { clearCelebration(); (content?.hidden ? toggle : restoreFocus)?.focus({ preventScroll: true }); });
  // Typing into the signup or dismissing its receipt must never strike a key.
  rail.addEventListener('keydown', event => event.stopPropagation());
  receipt.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape' && typeof receipt.close !== 'function') closeReceipt();
  });
  email.addEventListener('input', () => { email.removeAttribute('aria-invalid'); });

  if (!/^https?:$/.test(windowRef.location.protocol)) {
    status.textContent = 'Open octoberline211.com to sign up for updates.';
    submit.disabled = true;
    updateInset();
    return;
  }
  submit.disabled = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    email.value = email.value.trim();
    if (!validateUpdatesEmail(email.value) || !form.reportValidity()) {
      email.setAttribute('aria-invalid', 'true');
      status.dataset.error = 'true';
      status.textContent = 'Please enter a valid email address.';
      email.focus();
      return;
    }
    pending = true;
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    label.textContent = 'Saving…';
    status.textContent = '';
    delete status.dataset.error;
    try {
      await requestUpdatesSignup({ email: email.value, source: windowRef.location.pathname, website: website.value, fetchImpl: windowRef.fetch.bind(windowRef) });
      form.reset();
      status.textContent = 'You’re on the list. Thank you.';
      celebrate();
    } catch (error) {
      if (content?.hidden) setCollapsed(false);
      status.dataset.error = 'true';
      status.textContent = error?.message || 'We couldn’t save your email. Please try again.';
    } finally {
      pending = false;
      submit.disabled = false;
      label.textContent = 'Keep me posted';
      form.removeAttribute('aria-busy');
      updateInset();
    }
  });
}

if (typeof document !== 'undefined') mountUpdatesSignup();

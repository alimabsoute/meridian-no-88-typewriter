// This small, dependency-free controller is inlined before the simulator bundle.
// The page remains readable and its buttons work while that bundle downloads.
(() => {
  let releaseEntry;
  const entry = new Promise(resolve => { releaseEntry = resolve; });
  const get = id => document.getElementById(id);
  const contexts = {};
  const landing = window.__OCTOBERLINE_LANDING__ = {
    entry, contexts, started: false, status: 'idle',
    progress(message) { get('intro-load-status').textContent = message; },
    finish() { this.status = 'ready'; get('enter-studio').removeAttribute('aria-busy'); },
    fail(message) {
      const intro = get('intro-overlay'), button = get('enter-studio'), status = get('intro-load-status');
      this.status = 'error';
      intro.classList.remove('loading');
      button.disabled = false;
      get('intro-guide').disabled = false;
      button.removeAttribute('aria-busy');
      button.querySelector('.enter-label').textContent = 'Try opening the typewriter again';
      status.textContent = message || 'The room could not open. Please try again.';
      status.setAttribute('role', 'alert');
      for (const context of Object.values(contexts)) context?.close().catch(() => {});
    },
    start() {
      if (this.status === 'error') { location.reload(); return; }
      if (this.started) return;
      if (this.bootError) { this.fail('The typewriter could not finish loading. Please try again.'); return; }
      this.started = true;
      this.status = 'loading';
      const intro = get('intro-overlay'), button = get('enter-studio');
      get('landing-guide').close();
      intro.classList.add('loading');
      button.disabled = true;
      get('intro-guide').disabled = true;
      button.setAttribute('aria-busy', 'true');
      this.progress('Opening your writing room…');
      // Unlock silent contexts inside the actual gesture, even if the large
      // simulator bundle has not arrived yet. Its audio engines adopt them.
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) for (const name of ['machine', 'room']) {
        try {
          contexts[name] = new AudioContext();
          contexts[name].resume().catch(() => {});
        } catch { /* Writing remains available without sound. */ }
      }
      requestAnimationFrame(() => setTimeout(releaseEntry, 0));
    },
  };
  // Delegation lets these controls work before the rest of the HTML arrives.
  document.addEventListener('click', event => {
    if (event.target.closest('#enter-studio, #landing-guide-start')) landing.start();
    if (event.target.closest('#intro-guide')) get('landing-guide').showModal();
    if (event.target === get('landing-guide')) get('landing-guide').close();
  });
  function startupFailed(event) {
    // A failed decorative image is harmless. A failed simulator script must
    // still produce a usable retry even when it failed before the first click.
    if (event.type === 'error' && !(event instanceof ErrorEvent) && !(event.target instanceof HTMLScriptElement)) return;
    if (landing.status === 'idle') landing.bootError = true;
    if (landing.status === 'loading') landing.fail();
  }
  window.addEventListener('error', startupFailed, true);
  window.addEventListener('unhandledrejection', startupFailed);
})();

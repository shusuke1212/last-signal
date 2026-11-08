(() => {
  const endpoint = window.LSConfig?.sharedLearningUrl?.trim();
  if (!endpoint) return;

  const dialog = document.querySelector('#missionTransition');
  const title = document.querySelector('#missionTransitionTitle');
  const pendingKey = 'lastSignal.shared.pending:' + endpoint;
  let busy = false;
  let pending = false;
  try { pending = localStorage.getItem(pendingKey) === '1'; } catch {}

  dialog.addEventListener('cancel', (event) => event.preventDefault());
  for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'click']) {
    window.addEventListener(type, (event) => {
      if (!busy) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  async function duringTransition(message, operation) {
    busy = true;
    try {
      title.textContent = message;
      dialog.showModal();
      await operation();
    } catch (error) {
      console.warn('LAST SIGNAL data request failed', error);
    } finally {
      dialog.close();
      busy = false;
    }
  }

  function markPending(value) {
    pending = value;
    try {
      if (value) localStorage.setItem(pendingKey, '1');
      else localStorage.removeItem(pendingKey);
    } catch {}
  }

  function load() {
    if (pending) return;
    return duringTransition('降下地点へ移動中', async () => {
      const response = await fetch(endpoint, {
        cache: 'no-store',
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error('Read failed: HTTP ' + response.status);
      window.LSLearning.importData(await response.json());
    });
  }

  function publish() {
    markPending(true);
    return duringTransition('区域から離脱中', async () => {
      const snapshot = JSON.stringify(JSON.parse(window.LSLearning.exportData()));
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: snapshot,
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error('Write failed: HTTP ' + response.status);
      markPending(false);
    });
  }

  window.LSSharedLearning = { get busy() { return busy; }, load, publish };
})();

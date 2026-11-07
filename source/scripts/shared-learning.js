(() => {
  const endpoint = window.LSConfig?.sharedLearningUrl?.trim();
  if (!endpoint) return;
  function showStatus(message) {
    for (const id of ['sharedLearningStatus','sharedLearningResult']) {
      document.getElementById(id).textContent = message;
    }
  }
  const pendingKey = 'lastSignal.shared.pending:' + endpoint;
  let queued = Promise.resolve();
  let loading = false;
  let pending = false;
  try { pending = localStorage.getItem(pendingKey) === '1'; } catch {}

  function markPending(value) {
    pending = value;
    try {
      if (value) localStorage.setItem(pendingKey, '1');
      else localStorage.removeItem(pendingKey);
    } catch {}
  }

  async function load() {
    loading = true;
    showStatus('共有学習データを確認中…');
    try {
      await queued;
      if (pending) {
        showStatus('未同期の学習から再開します');
        return;
      }
      const response = await fetch(endpoint, {cache:'no-store', signal:AbortSignal.timeout(12000)});
      if (!response.ok) throw Error('共有データを取得できません');
      const result = window.LSLearning.importData(await response.json());
      showStatus('共有学習を読み込みました · ' + result.matches + '戦');
    } catch {
      showStatus('共有に接続できません。この端末の学習で再開します');
    } finally {
      loading = false;
    }
  }

  function publish() {
    const snapshot = JSON.stringify(JSON.parse(window.LSLearning.exportData()));
    markPending(true);
    showStatus('共有学習を保存中…');
    const job = queued.then(async () => {
      try {
        const response = await fetch(endpoint, {
          method:'POST', headers:{'Content-Type':'application/json'}, body:snapshot,
          signal:AbortSignal.timeout(20000)
        });
        if (!response.ok) throw Error('共有データを保存できません');
        if (queued === job) {
          markPending(false);
          showStatus('共有学習を保存しました');
        }
      } catch {
        if (queued === job) showStatus('共有保存に失敗しました。この端末に学習を保持しています');
      }
    });
    queued = job;
    return job;
  }

  window.LSSharedLearning = {enabled:true, get loading(){return loading}, load, publish};
})();

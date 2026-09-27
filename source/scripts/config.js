/* LAST SIGNAL - shared runtime configuration */
window.LSConfig = Object.freeze({
  version: '1.8.4',
  worldSize: 1000,
  normalDrawDistance: 95,
  scopedDrawDistance: 120,
  targetFps: 60,
  enemyCount: 10,
  palette: Object.freeze({
    fog: '#687873', ground: '#303c36', amber: '#ffb24a', red: '#ff5a47',
    concrete: '#67685e', metal: '#4d5c56', rust: '#83543e', cloth: '#56665a'
  })
});

addEventListener('DOMContentLoaded', () => {
  const splash = document.querySelector('#bootSplash');
  requestAnimationFrame(() => requestAnimationFrame(() => splash?.classList.add('ready')));
  setTimeout(() => splash?.remove(), 1150);
});

(() => {
  'use strict';
  const $ = (s) => document.querySelector(s),
    TAU = Math.PI * 2,
    WORLD = window.LSConfig?.worldSize || 1000,
    HALF = WORLD / 2,
    FAR = window.LSConfig?.normalDrawDistance || 95,
    SCOPE_FAR = window.LSConfig?.scopedDrawDistance || 120;
  const GAME_SCRIPT_URL = document.currentScript?.src || location.href,
    WEAPON_ASSET_ROOT = new URL('../assets/weapons/', GAME_SCRIPT_URL).href;
  const weaponSpriteUrl = (id) => WEAPON_ASSET_ROOT + id + '.webp';
  const ADS_WEAPON_IDS = new Set([
    'p9',
    'r45',
    'm10',
    'hush',
    'hc12',
    'viper',
    'mp7',
    'ar4',
    'akm',
    'burst',
    'carbine',
    'dmr',
    'rail',
    'sg8',
    'auto12',
    'lmg',
    'crossbow',
    'flame'
  ]);
  const weaponAdsSpriteUrl = (id) => WEAPON_ASSET_ROOT + id + '_ads.webp';
  const hasDedicatedAdsSprite = (g) => !!g && ADS_WEAPON_IDS.has(g.id);
  const { weapons, utilities, ballisticDropLabel, projectileVisualLabel } =
    window.LSData;
  const W = Object.fromEntries(weapons.map((w) => [w.id, w]));
  const G = Object.fromEntries(
    [...weapons, ...utilities].map((g) => [g.id, g])
  );
  const LEARN = window.LSLearning;
  let gl,
    prog,
    buf,
    posLoc,
    normalLoc,
    mvpLoc,
    colorLoc,
    fogLoc,
    fogFarLoc,
    canvas = $('#game'),
    mini = $('#minimap'),
    mctx = mini.getContext('2d'),
    oriCanvas = $('#orientationHud'),
    oriCtx = oriCanvas.getContext('2d');
  let state = 'menu',
    gameMode = 'survival',
    player,
    enemies = [],
    obstacles = [],
    pickups = [],
    settlements = [],
    traps = [],
    ammo = {},
    keys = {},
    mouseDown = false,
    last = 0,
    remaining = 1200,
    totalTime = 1200,
    revealUntil = 0,
    lastPulse = -1,
    lastNpcLiveSignalAt = 0,
    feed = [],
    shots = 0,
    hits = 0,
    kills = 0,
    pickupNear = null,
    hitTimer = 0,
    damageTimer = 0,
    touchMove = { x: 0, y: 0 },
    lastTouchX = 0,
    lastTouchY = 0,
    mapTrail = [],
    mapSampleAt = 0,
    soundEvents = [],
    projectiles = [],
    actionType = '',
    actionLabel = '',
    trainingDowns = 0,
    trainingWeaponIndex = 0,
    burstToken = 0;
  let fastSimClock = null,
    fastSimActive = false,
    fastSimToken = 0;
  let batchRun = null;
  let touchCrouch = false;
  function gameNow() {
    return fastSimClock === null ? performance.now() / 1000 : fastSimClock;
  }
  let lastInputType = 'unknown',
    pauseOpenedAt = 0,
    ignoreLockedMoves = 0,
    rightMousePhysicalDown = false,
    lastRightMouseToggleAt = 0;
  let pickupSpriteEls = [],
    lastWeaponSpriteId = '',
    lastViewShotAt = -10,
    lastViewKick = 1;

  // 操作設定と入力方式
  const INPUT_SETTINGS_KEY = 'lastSignalInputV2';
  const defaultInputSettings = {
    lookMode: 'auto',
    touchUI: 'auto',
    touchAdsTracking: true,
    sensX: 100,
    sensY: 100,
    edgeAssist: true,
    edgeStart: 92,
    edgeSpeed: 100,
    invertY: false,
    fullscreen: true
  };
  let inputSettings = { ...defaultInputSettings },
    settingsReturnState = 'menu',
    pointerEventMouseX = null,
    pointerEventMouseY = null,
    lastMouseTestAt = 0,
    testPointerX = null,
    testPointerY = null,
    edgeTurn = 0,
    touchAimAssistLockedOut = false,
    touchAimInputSeen = false,
    touchAimTarget = null,
    touchAimCandidate = null,
    touchAimCandidateTime = 0,
    touchAimTrackRamp = 0,
    touchAimAssistNoticeShown = false,
    touchAdsTemporarilyOff = false;
  function loadInputSettings() {
    try {
      let saved = JSON.parse(
        localStorage.getItem(INPUT_SETTINGS_KEY) || 'null'
      );
      if (saved && typeof saved === 'object')
        inputSettings = { ...defaultInputSettings, ...saved };
    } catch (e) {
      inputSettings = { ...defaultInputSettings };
    }
  }
  function saveInputSettings() {
    try {
      localStorage.setItem(INPUT_SETTINGS_KEY, JSON.stringify(inputSettings));
    } catch (e) {}
  }
  function hasCoarsePointer() {
    return (
      matchMedia?.('(pointer: coarse)')?.matches || navigator.maxTouchPoints > 0
    );
  }
  function isAndroid() {
    return /Android/i.test(navigator.userAgent || '');
  }
  function resolvedLookMode() {
    if (inputSettings.lookMode !== 'auto') return inputSettings.lookMode;
    if (isAndroid() && navigator.maxTouchPoints > 0) return 'pointerevents';
    if (matchMedia?.('(pointer: fine)')?.matches) return 'pointerlock';
    return 'touch';
  }
  function shouldShowTouchUI() {
    if (inputSettings.touchUI === 'show') return true;
    if (inputSettings.touchUI === 'hide') return false;
    return resolvedLookMode() === 'touch' || hasCoarsePointer();
  }
  function applyTouchUIVisibility() {
    if (!$('#mobileControls')) return;
    let on = state === 'play' && shouldShowTouchUI();
    $('#mobileControls').classList.toggle('gameOn', on);
    if (typeof updateActionButton === 'function') updateActionButton();
    updateTemporaryAssistButton();
    updateTouchCrouchButton();
  }
  function updateTouchCrouchButton() {
    const el = $('#touchCrouch');
    if (!el) return;
    const active = !!(state === 'play' && player?.crouched);
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
    el.textContent = active ? 'STAND' : 'CROUCH';
  }
  function toggleTouchCrouch() {
    if (state !== 'play' || !player) return;
    touchCrouch = !touchCrouch;
    if (touchCrouch && player.grapple) touchCrouch = false;
    updateTouchCrouchButton();
  }
  function resetTouchAimAssistSession() {
    touchAdsTemporarilyOff = false;
    touchAimAssistLockedOut = false;
    touchAimInputSeen = false;
    touchAimTarget = null;
    touchAimCandidate = null;
    touchAimCandidateTime = 0;
    touchAimTrackRamp = 0;
    touchAimAssistNoticeShown = false;
  }
  function markTouchMatchInput() {
    if (state === 'play' && !touchAimAssistLockedOut) touchAimInputSeen = true;
  }
  function lockTouchAimAssistForMatch() {
    if (state !== 'play' || touchAimAssistLockedOut) return;
    touchAimAssistLockedOut = true;
    touchAimTarget = null;
    if (inputSettings.touchAdsTracking && !touchAimAssistNoticeShown) {
      touchAimAssistNoticeShown = true;
      msg('タッチADS追尾補助 OFF：マウス／キーボード入力を検出');
    }
  }
  function updateTemporaryAssistButton() {
    let el = $('#touchAssistToggle');
    if (!el) return;
    let show =
      state === 'play' &&
      shouldShowTouchUI() &&
      !!player?.aiming &&
      current()?.id === 'longshot' &&
      !!inputSettings.touchAdsTracking &&
      !touchAimAssistLockedOut;
    el.classList.toggle('visible', show);
    el.classList.toggle('suspended', touchAdsTemporarilyOff);
    el.textContent = touchAdsTemporarilyOff ? '補助 ON' : '補助 OFF';
    el.setAttribute('aria-pressed', String(touchAdsTemporarilyOff));
    el.setAttribute(
      'aria-label',
      touchAdsTemporarilyOff ? 'ADS照準補助を元に戻す' : 'ADS照準補助を一時解除'
    );
  }
  function toggleTemporaryAssist() {
    if (
      state !== 'play' ||
      !player?.aiming ||
      current()?.id !== 'longshot' ||
      !inputSettings.touchAdsTracking ||
      touchAimAssistLockedOut
    )
      return;
    touchAdsTemporarilyOff = !touchAdsTemporarilyOff;
    touchAimTarget = null;
    updateTemporaryAssistButton();
  }
  function touchAimAssistActive() {
    return !!(
      !touchAdsTemporarilyOff &&
      inputSettings.touchAdsTracking &&
      touchAimInputSeen &&
      !touchAimAssistLockedOut &&
      state === 'play' &&
      player?.aiming &&
      canAim()
    );
  }
  function updateInputTest(device, eventType, dx = 0, dy = 0) {
    let now = performance.now();
    if (now - lastMouseTestAt < 10) return;
    lastMouseTestAt = now;
    $('#testDevice') && ($('#testDevice').textContent = device || '-');
    $('#testEvent') && ($('#testEvent').textContent = eventType || '-');
    $('#testDX') && ($('#testDX').textContent = Number(dx).toFixed(1));
    $('#testDY') && ($('#testDY').textContent = Number(dy).toFixed(1));
    $('#testLock') &&
      ($('#testLock').textContent =
        document.pointerLockElement === canvas ? 'ON' : 'OFF');
    $('#testMode') &&
      ($('#testMode').textContent = resolvedLookMode().toUpperCase());
    $('#testEdge') &&
      ($('#testEdge').textContent =
        Math.abs(edgeTurn) > 0.01
          ? edgeTurn < 0
            ? 'LEFT ' + Math.round(Math.abs(edgeTurn) * 100) + '%'
            : 'RIGHT ' + Math.round(edgeTurn * 100) + '%'
          : 'OFF');
  }
  loadInputSettings();
  addEventListener(
    'pointerdown',
    (e) => {
      lastInputType = e.pointerType;
      if (state === 'play') {
        if (e.pointerType === 'touch') markTouchMatchInput();
        else if (e.pointerType === 'mouse') lockTouchAimAssistForMatch();
      }
      updateInputTest(e.pointerType, 'pointerdown', 0, 0);
    },
    { capture: true, passive: true }
  );
  addEventListener(
    'pointermove',
    (e) => {
      if (state === 'play' && e.pointerType === 'mouse')
        lockTouchAimAssistForMatch();
      if ($('#settings')?.classList.contains('hidden')) return;
      let dx = testPointerX === null ? 0 : e.clientX - testPointerX,
        dy = testPointerY === null ? 0 : e.clientY - testPointerY;
      testPointerX = e.clientX;
      testPointerY = e.clientY;
      updateInputTest(e.pointerType, 'pointermove', dx, dy);
    },
    { capture: true, passive: true }
  );
  function rand(a, b) {
    return a + Math.random() * (b - a);
  }
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }
  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }
  function weaponNoiseRadius(w) {
    if (!w || w.kind === 'melee') return 0;
    if (w.id === 'crossbow') return 8;
    if (w.id === 'hush') return 18;
    if (w.id === 'flame') return 42;
    if (w.id === 'viper' || w.id === 'mp7') return 68;
    if (w.id === 'p9' || w.id === 'r45' || w.id === 'm10') return 58;
    if (w.id === 'hc12') return 88;
    if (w.id === 'sg8' || w.id === 'auto12') return 96;
    if (w.id === 'dmr') return 108;
    if (w.id === 'lmg') return 122;
    if (w.id === 'longshot') return 155;
    if (w.id === 'rail') return 165;
    return 92;
  }
  function weaponNoiseLabel(w) {
    let r = weaponNoiseRadius(w);
    if (r <= 0) return '無音';
    if (r <= 12) return '極小';
    if (r <= 25) return '静音';
    if (r <= 55) return '小';
    if (r <= 80) return '中';
    if (r <= 115) return '大';
    return '特大';
  }

  // 敵の知覚と警戒
  const NPC_SIGHT_RANGE = 78,
    NPC_FOV_CALM = 1.05,
    NPC_FOV_ALERT = 1.48,
    NPC_TRAFFIC_SPEED = 1.72,
    NPC_LOCAL_SPEED = 1.38;
  const EVIDENCE_WEIGHT = {
    damage: 1.2,
    direct: 1.1,
    signal: 1,
    lastSeen: 0.9,
    tripwire: 0.86,
    sound: 0.72,
    pickup: 0.58,
    proximity: 0.42
  };
  function evidenceScore(e, b, now) {
    if (!b || now >= b.expiresAt) return -9;
    let age = now - b.at,
      life = Math.max(0.01, b.expiresAt - b.at),
      fresh = clamp(1 - age / life, 0, 1),
      d = Math.hypot(e.x - b.x, e.z - b.z),
      interest = LEARN?.evidenceInterest?.(e, b.target) || 0,
      bias = LEARN?.investigationBias?.(e, b.source) || 0;
    return (
      (EVIDENCE_WEIGHT[b.source] || 0.5) *
        b.confidence *
        (0.35 + 0.65 * fresh) -
      d / 260 -
      b.uncertainty / 90 +
      interest * 0.12 +
      bias * 0.14
    );
  }
  function rememberEvidence(e, x, z, source, now, options = {}) {
    if (!e?.alive) return;
    let uncertainty = Math.max(0.5, options.uncertainty ?? 3),
      duration = Math.max(1, options.duration ?? 7),
      b = {
        x: clamp(x, -480, 480),
        z: clamp(z, -480, 480),
        source,
        at: now,
        expiresAt: now + duration,
        confidence: clamp(options.confidence ?? 0.65, 0.05, 1),
        uncertainty,
        target: options.target || null
      };
    if (
      e.belief &&
      evidenceScore(e, b, now) < evidenceScore(e, e.belief, now) - 0.08
    )
      return;
    e.belief = b;
    e.tx = b.x;
    e.tz = b.z;
    e.investigateUntil = b.expiresAt;
    e.awareness = source === 'direct' ? 'confirmed' : 'suspicious';
    e.searchX = b.x;
    e.searchZ = b.z;
    e.nextSearchAt = now;
    e.think = Math.max(e.think || 0, 0.28);
  }
  function reportPickupDisappearance(p, taker, now = gameNow()) {
    for (const e of enemies) {
      if (!e.alive || e === taker) continue;
      let d = dist(e, p),
        confidence = clamp(0.68 - d / 620, 0.18, 0.68);
      rememberEvidence(e, p.x, p.z, 'pickup', now, {
        confidence,
        uncertainty: 6 + d * 0.028,
        duration: 11,
        target: null
      });
    }
  }
  function broadcastSignalEvidence(now, live = false) {
    let actors = [player, ...enemies].filter((a) => a?.alive);
    for (const e of enemies) {
      if (!e.alive) continue;
      for (const t of actors) {
        if (t === e) continue;
        let confidence = live ? 0.98 : 0.9;
        rememberEvidence(e, t.x, t.z, 'signal', now, {
          confidence,
          uncertainty: live ? 1.5 : 3.5,
          duration: live ? 1.4 : 8.5,
          target: t
        });
      }
    }
  }
  function emitGunshot(source, w, now = gameNow()) {
    if (gameMode === 'training') return;
    let radius = weaponNoiseRadius(w);
    if (!source || radius <= 0) return;
    for (const e of enemies) {
      if (!e.alive || e === source) continue;
      let d = dist(source, e);
      if (d > radius) continue;
      let error = 3 + (d / radius) * 18,
        ang = Math.atan2(source.x - e.x, -(source.z - e.z)) + rand(-0.1, 0.1),
        guess = Math.max(5, d + rand(-error, error));
      rememberEvidence(
        e,
        e.x + Math.sin(ang) * guess,
        e.z - Math.cos(ang) * guess,
        'sound',
        now,
        {
          confidence: clamp(0.86 - (d / radius) * 0.42, 0.32, 0.86),
          uncertainty: error,
          duration: 5.5 + Math.min(2.5, radius / 90),
          target: source
        }
      );
    }
    if (source !== player && player?.alive) {
      let d = dist(player, source);
      if (d > radius) return;
      let key = 'enemy-' + source.id,
        bearing = Math.atan2(source.z - player.z, source.x - player.x),
        ev = soundEvents.find((q) => q.key === key && q.life > 0);
      if (ev) {
        ev.bearing = bearing;
        ev.life = 2.5;
        ev.shots++;
        ev.spread = Math.max(0.14, ev.spread * 0.82);
      } else {
        soundEvents.push({ key, bearing, life: 2.5, shots: 1, spread: 0.58 });
      }
      soundEvents = soundEvents.slice(-8);
      notifyPlayerGunshot(source);
    }
  }
  // Player-only directional sound cue. Cosmetic: never enters AI learning or evidence.
  let lastSoundFlashAt = -Infinity,
    soundFlashHandle = 0;
  function notifyPlayerGunshot(source) {
    if (!source || !player?.alive || state !== 'play' || fastSimActive) return;
    const now = performance.now();
    if (now - lastSoundFlashAt < 320) return;
    lastSoundFlashAt = now;
    const dx = source.x - player.x,
      dz = source.z - player.z;
    const side =
      dx * Math.cos(player.yaw) + dz * Math.sin(player.yaw) >= 0
        ? 'right'
        : 'left';
    const edge = document.getElementById(
      'gunshotEdge' + (side === 'right' ? 'Right' : 'Left')
    );
    if (!edge) return;
    edge.classList.remove('active');
    void edge.offsetWidth;
    edge.classList.add('active');
    clearTimeout(soundFlashHandle);
    soundFlashHandle = setTimeout(() => edge.classList.remove('active'), 300);
  }
  function drawSoundBearings(px, py) {
    if (!player || !soundEvents.length) return;
    for (const ev of soundEvents) {
      if (ev.life <= 0) continue;
      let a = ev.bearing,
        sp = ev.spread,
        inner = 15,
        outer = 25,
        alpha = clamp(ev.life / 2.5, 0.18, 0.88);
      mctx.beginPath();
      mctx.moveTo(px + Math.cos(a - sp) * inner, py + Math.sin(a - sp) * inner);
      mctx.arc(px, py, outer, a - sp, a + sp);
      mctx.lineTo(px + Math.cos(a + sp) * inner, py + Math.sin(a + sp) * inner);
      mctx.arc(px, py, inner, a + sp, a - sp, true);
      mctx.closePath();
      mctx.fillStyle = `rgba(255,178,74,${alpha})`;
      mctx.fill();
      mctx.strokeStyle = `rgba(255,220,160,${Math.min(1, alpha + 0.12)})`;
      mctx.lineWidth = 1.5;
      mctx.stroke();
    }
  }
  function weaponOptions(kind) {
    return weapons
      .filter((w) => w.kind === kind)
      .map((w) => `<option value="${w.id}">${w.name}</option>`)
      .join('');
  }
  function secondaryOptions() {
    return `<optgroup label="拳銃">${weaponOptions('sidearm')}</optgroup><optgroup label="副装備（拳銃を手放す）">${utilities.map((u) => `<option value="${u.id}">${u.name}</option>`).join('')}</optgroup>`;
  }
  $('#sidearmSelect').innerHTML = secondaryOptions();
  $('#sidearmSelect').value = 'p9';
  const trainingWeapons = weapons.filter((w) => w.kind !== 'melee');
  $('#trainingWeaponSelect').innerHTML = trainingWeapons
    .map((w) => `<option value="${w.id}">${w.name}</option>`)
    .join('');
  $('#trainingWeaponSelect').value = 'ar4';
  trainingWeaponIndex = Math.max(
    0,
    trainingWeapons.findIndex((w) => w.id === 'ar4')
  );
  function recoilLabel(g) {
    let r = g.recoil || 0;
    if (!r) return '—';
    if (r < 0.0035) return '極小';
    if (r < 0.0055) return '小';
    if (r < 0.009) return '中';
    if (r < 0.016) return '大';
    return '特大';
  }
  function fireModeLabel(g) {
    return g.burst ? `${g.burst}-BURST` : g.auto ? 'AUTO' : 'SEMI';
  }
  function aimTimeLabel(g) {
    return Number.isFinite(g.aimTime) ? g.aimTime.toFixed(2) + 's' : '—';
  }
  function buildCards() {
    let all = [...weapons, ...utilities];
    $('#weaponGrid').innerHTML = all
      .map((g) =>
        g.kind === 'utility'
          ? `<div class="weaponCard" data-id="${g.id}"><h3 style="color:${g.color}">${g.name}</h3><div class="stats"><span><b>副武器枠</b></span><span>所持 <b>${g.charges === Infinity ? '∞' : g.charges}</b></span><span style="grid-column:1/-1">${g.description}</span></div></div>`
          : `<div class="weaponCard" data-id="${g.id}"><h3 style="color:${g.color}">${g.name}</h3><div class="stats"><span>威力 <b>${g.dmg}${g.pellets ? '×' + g.pellets : ''}</b></span><span>装弾 <b>${g.mag === Infinity ? '∞' : g.mag}</b></span><span>射程 <b>${g.range}m</b></span><span>装填 <b>${g.reload ? g.reload.toFixed(1) + 's' : '不要'}</b></span><span>連射 <b>${g.rof}/s</b></span><span>精度 <b>${Math.round((1 - g.spread / 0.13) * 100)}</b></span><span>反動 <b>${recoilLabel(g)}</b></span><span>機動 <b>${Math.round((g.moveMul || 1) * 100)}%</b></span><span>構え <b>${aimTimeLabel(g)}</b></span><span>初動 <b>${g.lead.toFixed(2)}s</b></span><span>弾速 <b>${g.kind === 'melee' ? '—' : g.speed + 'm/s'}</b></span><span>弾道落下 <b>${ballisticDropLabel(g)}</b></span><span>弾道表示 <b>${projectileVisualLabel(g)}</b></span><span>発砲音 <b>${weaponNoiseLabel(g)}</b></span><span><b>${fireModeLabel(g)}</b></span></div></div>`
      )
      .join('');
  }
  buildCards();
  for (const card of document.querySelectorAll('.weaponCard')) {
    let img = document.createElement('img');
    img.className = 'arsenalWeapon';
    img.alt = '';
    img.src = weaponSpriteUrl(card.dataset.id);
    card.prepend(img);
  }

  // WebGLと描画の基本処理
  function initGL() {
    gl = canvas.getContext('webgl', {
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance'
    });
    if (!gl) {
      alert('このブラウザではWebGLを利用できません');
      return false;
    }
    const vs =
      'attribute vec3 p;attribute vec3 n;uniform mat4 mvp;uniform float fogFar;varying float d;varying float light;void main(){vec4 q=mvp*vec4(p,1.0);gl_Position=q;d=clamp(q.w/fogFar,0.0,1.0);light=.38+.62*max(dot(normalize(n),normalize(vec3(-.45,.86,.28))),0.0);}';
    const fs =
      'precision mediump float;uniform vec4 col;uniform vec3 fog;varying float d;varying float light;void main(){float f=smoothstep(.58,1.0,d);vec3 lit=col.rgb*light+col.rgb*col.rgb*.08;gl_FragColor=vec4(mix(lit,fog,f),col.a);}';
    const sh = (t, src) => {
      let shader = gl.createShader(t);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    posLoc = gl.getAttribLocation(prog, 'p');
    normalLoc = gl.getAttribLocation(prog, 'n');
    mvpLoc = gl.getUniformLocation(prog, 'mvp');
    colorLoc = gl.getUniformLocation(prog, 'col');
    fogLoc = gl.getUniformLocation(prog, 'fog');
    fogFarLoc = gl.getUniformLocation(prog, 'fogFar');
    gl.uniform3f(fogLoc, 0.36, 0.43, 0.41);
    gl.uniform1f(fogFarLoc, FAR);
    const positions = [
      -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, 0.5,
      0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5,
      0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, -0.5,
      -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5,
      0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5,
      0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
      -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, -0.5,
      0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, 0.5,
      -0.5, 0.5
    ];
    const faces = [
        [0, 0, -1],
        [0, 0, 1],
        [-1, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, -1, 0]
      ],
      v = new Float32Array(36 * 6);
    for (let i = 0; i < 36; i++) {
      let o = i * 6,
        f = faces[Math.floor(i / 6)];
      v[o] = positions[i * 3];
      v[o + 1] = positions[i * 3 + 1];
      v[o + 2] = positions[i * 3 + 2];
      v[o + 3] = f[0];
      v[o + 4] = f[1];
      v[o + 5] = f[2];
    }
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(normalLoc);
    gl.vertexAttribPointer(normalLoc, 3, gl.FLOAT, false, 24, 12);
    gl.enable(gl.DEPTH_TEST);
    return true;
  }
  const M = {
    mul(a, b) {
      let o = new Float32Array(16);
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 4; c++)
          o[c * 4 + r] =
            a[r] * b[c * 4] +
            a[4 + r] * b[c * 4 + 1] +
            a[8 + r] * b[c * 4 + 2] +
            a[12 + r] * b[c * 4 + 3];
      return o;
    },
    persp(f, a, n, fa) {
      let t = 1 / Math.tan(f / 2),
        o = new Float32Array(16);
      o[0] = t / a;
      o[5] = t;
      o[10] = (fa + n) / (n - fa);
      o[11] = -1;
      o[14] = (2 * fa * n) / (n - fa);
      return o;
    },
    view(x, y, z, yaw, pitch) {
      let cy = Math.cos(yaw),
        sy = Math.sin(yaw),
        cp = Math.cos(pitch),
        sp = Math.sin(pitch),
        fx = sy * cp,
        fy = sp,
        fz = -cy * cp,
        rx = cy,
        rz = sy,
        ux = -sy * sp,
        uy = cp,
        uz = cy * sp;
      return new Float32Array([
        rx,
        ux,
        -fx,
        0,
        0,
        uy,
        -fy,
        0,
        rz,
        uz,
        -fz,
        0,
        -(rx * x + rz * z),
        -(ux * x + uy * y + uz * z),
        fx * x + fy * y + fz * z,
        1
      ]);
    },
    model(x, y, z, sx, sy, sz) {
      return new Float32Array([
        sx,
        0,
        0,
        0,
        0,
        sy,
        0,
        0,
        0,
        0,
        sz,
        0,
        x,
        y,
        z,
        1
      ]);
    },
    modelYaw(x, y, z, sx, sy, sz, yaw) {
      let c = Math.cos(yaw),
        n = Math.sin(yaw);
      return new Float32Array([
        c * sx,
        0,
        -n * sx,
        0,
        0,
        sy,
        0,
        0,
        n * sz,
        0,
        c * sz,
        0,
        x,
        y,
        z,
        1
      ]);
    }
  };
  function hex(h, a = 1) {
    let n = parseInt(h.slice(1), 16);
    return [
      ((n >> 16) & 255) / 255,
      ((n >> 8) & 255) / 255,
      (n & 255) / 255,
      a
    ];
  }
  function cube(vp, x, y, z, sx, sy, sz, c) {
    let m = M.mul(vp, M.model(x, y, z, sx, sy, sz)),
      q = hex(c);
    gl.uniformMatrix4fv(mvpLoc, false, m);
    gl.uniform4f(colorLoc, ...q);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
  }
  function cubeR(vp, x, y, z, sx, sy, sz, yaw, c) {
    let m = M.mul(vp, M.modelYaw(x, y, z, sx, sy, sz, yaw)),
      q = hex(c);
    gl.uniformMatrix4fv(mvpLoc, false, m);
    gl.uniform4f(colorLoc, ...q);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
  }
  function shadeColor(h, amount) {
    let q = hex(h),
      f = (v) =>
        Math.round(clamp((v + amount) * 255, 0, 255))
          .toString(16)
          .padStart(2, '0');
    return '#' + f(q[0]) + f(q[1]) + f(q[2]);
  }
  let viewportWidth = 1;
  let viewportHeight = 1;
  function resize() {
    viewportWidth = Math.max(1, canvas.clientWidth);
    viewportHeight = Math.max(1, canvas.clientHeight);
    let d = Math.min(devicePixelRatio || 1, 1.35),
      w = Math.floor(viewportWidth * d),
      h = Math.floor(viewportHeight * d);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl && gl.viewport(0, 0, w, h);
    }
  }
  addEventListener('resize', resize);

  // フィールドと出現位置
  const TRAP_DATA = [
    { id: 'mine', name: 'MINE', damage: 72 },
    { id: 'wire', name: 'WIRE', damage: 8 },
    { id: 'bear', name: 'BEAR', damage: 26 }
  ];
  function pointOpen(p, pad = 2) {
    return !obstacles.some((raw) => {
      let o = solidShape(raw);
      return (
        Math.abs(p.x - o.x) < o.w / 2 + pad &&
        Math.abs(p.z - o.z) < o.d / 2 + pad
      );
    });
  }
  function freePoint(minPlayer = 0) {
    for (let n = 0; n < 160; n++) {
      let p = { x: rand(-470, 470), z: rand(-470, 470) };
      if (player && dist(p, player) < minPlayer) continue;
      if (pointOpen(p)) return p;
    }
    return { x: 0, z: 0 };
  }
  function sharedSpawnPoints(count = 11, minSeparation = 95) {
    const result = [];
    // Every participant uses the same candidate distribution and collision conditions.
    for (let i = 0; i < count; i++) {
      let best = null,
        bestDistance = -1;
      for (let attempt = 0; attempt < 520; attempt++) {
        const p = { x: rand(-460, 460), z: rand(-460, 460) };
        if (!pointOpen(p, 3.2)) continue;
        const d = result.length
          ? Math.min(...result.map((o) => dist(p, o)))
          : Infinity;
        if (d >= minSeparation) {
          best = p;
          break;
        }
        if (d > bestDistance) {
          best = p;
          bestDistance = d;
        }
      }
      if (!best) throw Error('Spawn allocation failed');
      result.push(best);
    }
    // Randomize assignments rather than reserving any particular point for the player.
    for (let i = result.length - 1; i > 0; i--) {
      let j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function freePointNear(cx, cz, r = 48) {
    for (let n = 0; n < 180; n++) {
      let p = { x: cx + rand(-r, r), z: cz + rand(-r, r) };
      if (Math.abs(p.x) > 475 || Math.abs(p.z) > 475) continue;
      if (pointOpen(p, 1.1)) return p;
    }
    return freePoint(30);
  }
  function makeWorld() {
    obstacles = [];
    pickups = [];
    traps = [];
    pickupSpriteEls = [];
    $('#pickupSprites').innerHTML = '';
    settlements = [
      { x: -255 + rand(-30, 30), z: -210 + rand(-30, 30), name: 'ALPHA' },
      { x: 245 + rand(-30, 30), z: -155 + rand(-30, 30), name: 'BRAVO' },
      { x: 80 + rand(-30, 30), z: 275 + rand(-30, 30), name: 'CHARLIE' }
    ];
    let seeded = Math.floor(Math.random() * 4294967295),
      rr = () =>
        ((seeded = (Math.imul(seeded, 1664525) + 1013904223) | 0) >>> 0) /
        4294967296;
    const add = (x, z, w, d, h, color, extra = {}) =>
      obstacles.push({ x, z, w, d, h, color, ...extra });
    const nearSettlement = (x, z, r = 72) =>
      settlements.some((s) => Math.hypot(x - s.x, z - s.z) < r);
    const addL = (
      x,
      z,
      flipX = 1,
      flipZ = 1,
      color = '#5a5848',
      settlement = null
    ) => {
      add(x, z, 11, 2.2, 2.05, color, { settlement, cover: true });
      add(x + flipX * 4.5, z + flipZ * 4.5, 2.2, 11, 2.05, color, {
        settlement,
        cover: true
      });
    };
    const addBelt = (cx, cz, vertical, len = 86) => {
      let cursor = -len / 2,
        part = 0;
      while (cursor < len / 2) {
        let gap = 7 + rr() * 7,
          seg = 11 + rr() * 10;
        cursor += gap;
        if (cursor + seg > len / 2) seg = len / 2 - cursor;
        if (seg < 5) break;
        let along = cursor + seg / 2,
          jitter = (rr() - 0.5) * 7,
          thick = 4.2 + rr() * 3.4,
          h = 2.3 + rr() * 2.3;
        if (vertical)
          add(
            cx + jitter,
            cz + along,
            thick,
            seg,
            h,
            part % 2 ? '#47564d' : '#59604d',
            { terrain: 'screen', mapCover: true, noGrapple: true }
          );
        else
          add(
            cx + along,
            cz + jitter,
            seg,
            thick,
            h,
            part % 2 ? '#47564d' : '#59604d',
            { terrain: 'screen', mapCover: true, noGrapple: true }
          );
        cursor += seg;
        part++;
      }
    };
    const addGrove = (cx, cz, count = 6) => {
      for (let i = 0; i < count; i++) {
        let a = rr() * TAU,
          r = 5 + rr() * 18,
          x = cx + Math.cos(a) * r,
          z = cz + Math.sin(a) * r;
        let w = 3.5 + rr() * 5,
          d = 3.5 + rr() * 5,
          h = 3.2 + rr() * 4.8;
        add(x, z, w, d, h, rr() > 0.45 ? '#3e5048' : '#526052', {
          terrain: 'grove',
          mapCover: true,
          noGrapple: true
        });
      }
    };

    // 集落：一直線に抜ける十字路を避け、曲がった路地とL字遮蔽で近距離戦を作る。
    for (const s of settlements) {
      for (let gx = -2; gx <= 2; gx++)
        for (let gz = -2; gz <= 2; gz++) {
          let road =
            (gx === 0 && gz <= 1) ||
            (gz === 1 && gx >= 0) ||
            (gx === -1 && gz >= 0);
          if (road) continue;
          let w = 8.5 + rr() * 6.5,
            d = 8.5 + rr() * 6.5,
            h = 3.1 + rr() * 5.4;
          add(
            s.x + gx * 15.5 + (rr() - 0.5) * 2.4,
            s.z + gz * 15.5 + (rr() - 0.5) * 2.4,
            w,
            d,
            h,
            rr() > 0.55 ? '#4b5e55' : '#665f4b',
            { settlement: s.name, building: true }
          );
        }
      // 路地の途中に腰壁・L字壁を置く。完全封鎖せず、覗き込みと回り込みを促す。
      addL(s.x - 7, s.z + 2, 1, 1, '#615d4d', s.name);
      addL(s.x + 14, s.z + 14, -1, 1, '#56584b', s.name);
      addL(s.x - 18, s.z - 15, 1, -1, '#5d5947', s.name);
      add(s.x + 7, s.z - 19, 13, 2.4, 1.25, '#69624d', {
        settlement: s.name,
        cover: true
      });
      add(s.x + 24, s.z - 2, 2.4, 13, 1.45, '#5d604f', {
        settlement: s.name,
        cover: true
      });
      // 外周は点在する遮蔽。狙撃位置から集落中心を一望しにくくする。
      for (let i = 0; i < 14; i++) {
        let a = (i / 14) * TAU + (rr() - 0.5) * 0.16,
          r = 31 + rr() * 18;
        add(
          s.x + Math.cos(a) * r,
          s.z + Math.sin(a) * r,
          3 + rr() * 5,
          3 + rr() * 5,
          1.5 + rr() * 2.8,
          '#555a49',
          { settlement: s.name, cover: true }
        );
      }
    }

    // Light hedge cover: visual concealment, not ballistic protection. A few short,
    // separated sections next to settlements; no new weapons or AI behavior rules.
    for (const st of settlements) {
      for (const [ox, oz, horizontal] of [
        [-60, -12, true],
        [52, 47, true],
        [12, -61, false],
        [-48, 49, false]
      ]) {
        const x = st.x + ox,
          z = st.z + oz,
          w = horizontal ? 7.8 : 1.45,
          d = horizontal ? 1.45 : 7.8;
        if (
          obstacles.some(
            (o) =>
              Math.abs(x - o.x) < (w + o.w) / 2 + 1.3 &&
              Math.abs(z - o.z) < (d + o.d) / 2 + 1.3
          )
        )
          continue;
        add(x, z, w, d, 1.27, '#45664a', {
          terrain: 'hedge',
          softCover: true,
          mapCover: true,
          noGrapple: true
        });
      }
    }

    // 野外の「視線を切る帯」。それぞれに切れ目があり、迂回も突破もできる。
    [
      [-115, -235, false, 92],
      [105, -205, true, 84],
      [-115, 55, true, 96],
      [165, 85, false, 88],
      [-285, 70, false, 82],
      [250, 245, true, 90],
      [-95, 315, false, 78],
      [330, 40, true, 72]
    ].forEach((v) => addBelt(...v));

    // 林・岩場。一本の壁ではなく塊で射線を分断するので、接近経路が複数残る。
    [
      [-345, -335],
      [-105, -355],
      [335, -300],
      [-355, -80],
      [25, -105],
      [350, 95],
      [-310, 245],
      [-70, 175],
      [195, 190],
      [-180, 385],
      [315, 360]
    ].forEach((p, i) => addGrove(p[0], p[1], 5 + (i % 3)));

    // v2.4.8: 武器集落とは独立した野外遮蔽群。AIの選択傾向を観察するため、
    // 野外の全てを遮蔽で埋めず、群生域・疎らな区域・開放域を併存させる。
    // 衝突判定・銃弾遮蔽は既存 obstacles と共通。装飾だけの擬似遮蔽は作らない。
    const coverIslands = [
      [-405, -215],
      [-215, -65],
      [-15, -285],
      [135, -345],
      [385, -190],
      [-410, 340],
      [-180, 275],
      [45, 135],
      [300, 365]
    ];
    for (const [baseX, baseZ] of coverIslands) {
      const cx = baseX + (rr() - 0.5) * 22,
        cz = baseZ + (rr() - 0.5) * 22;
      let placed = 0;
      for (let attempt = 0; attempt < 28 && placed < 9; attempt++) {
        let a = rr() * TAU,
          r = 6 + Math.sqrt(rr()) * 29;
        let x = cx + Math.cos(a) * r,
          z = cz + Math.sin(a) * r;
        if (Math.abs(x) > 470 || Math.abs(z) > 470 || nearSettlement(x, z, 83))
          continue;
        let w = 2.8 + rr() * 6.3,
          d = 3.1 + rr() * 6.5,
          h = 1.65 + rr() * 3.4;
        // 足場が完全に塞がれないよう、既存の障害物との重なりは避ける。
        if (
          obstacles.some(
            (o) =>
              Math.abs(x - o.x) < (w + o.w) / 2 + 2.4 &&
              Math.abs(z - o.z) < (d + o.d) / 2 + 2.4
          )
        )
          continue;
        add(x, z, w, d, h, rr() > 0.52 ? '#586258' : '#66665a', {
          terrain: 'scatter',
          mapCover: true,
          coverIsland: true,
          noGrapple: true
        });
        placed++;
      }
    }

    // v2.0: 倉庫区画。建物の間に複数の抜け道を残し、真正面からの狙撃を分断する。
    const industrial = { x: 345, z: -8 };
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 4; col++) {
        if ((row === 1 && col === 1) || (row === 0 && col === 2)) continue;
        let x = industrial.x + (col - 1.5) * 20,
          z = industrial.z + (row - 1) * 24;
        let w = 10 + rr() * 4,
          d = 12 + rr() * 5,
          h = 4 + rr() * 3;
        add(x, z, w, d, h, col % 2 ? '#52615f' : '#666253', {
          terrain: 'industrial',
          building: true,
          mapCover: true
        });
      }
    // 短いコンテナの列は、射線を切るが迂回可能な間隔を維持する。
    for (let i = 0; i < 9; i++) {
      let x = industrial.x - 38 + (i % 5) * 18,
        z = industrial.z - 47 + Math.floor(i / 5) * 97;
      add(x, z, 8, 3.5, 2.8, i % 2 ? '#60706d' : '#786b59', {
        terrain: 'industrial',
        mapCover: true,
        noGrapple: true
      });
    }
    // 開けた空間を残すため、遮蔽物を外周へ偏らせた峡路を設ける。
    for (let i = 0; i < 7; i++) {
      let z = 94 + i * 13;
      add(-375 + (i % 2) * 8, z, 7, 6, 2.4 + (i % 3), '#526052', {
        terrain: 'scatter',
        mapCover: true
      });
      add(-325 - (i % 2) * 8, z + 3, 7, 6, 3.5, '#4b5753', {
        terrain: 'scatter',
        mapCover: true
      });
    }

    // 単独の岩・残骸。従来より数を抑え、開けた狙撃エリアも意図的に残す。
    for (let i = 0; i < 58; i++) {
      let x = (rr() - 0.5) * 930,
        z = (rr() - 0.5) * 930,
        w = 3 + rr() * 9,
        d = 3 + rr() * 9,
        h = 1.4 + rr() * 6.2;
      if (nearSettlement(x, z, 72)) {
        i--;
        continue;
      }
      add(x, z, w, d, h, rr() > 0.72 ? '#3e5048' : '#536158', {
        terrain: 'scatter'
      });
    }

    let pool = [...weapons.filter((w) => w.id !== 'knife'), ...utilities];
    for (let i = 0; i < 36; i++) {
      let s = settlements[i % settlements.length],
        p = i < 27 ? freePointNear(s.x, s.z, 48) : freePoint(40);
      pickups.push({
        x: p.x,
        z: p.z,
        y: 0,
        wid: pool[i % pool.length].id,
        taken: false
      });
    }
    for (const s of settlements)
      for (let i = 0; i < 3; i++) {
        let p = freePointNear(s.x, s.z, 42);
        traps.push({
          type: TRAP_DATA[i].id,
          x: p.x,
          z: p.z,
          y: 0,
          angle: rr() * TAU,
          owner: 'enemy',
          active: true,
          arm: 0
        });
      }
  }

  // 射撃訓練場
  function makeTrainingWorld() {
    obstacles = [];
    pickups = [];
    traps = [];
    settlements = [];
    pickupSpriteEls = [];
    $('#pickupSprites').innerHTML = '';
    const add = (x, z, w, d, h, color, extra = {}) =>
      obstacles.push({ x, z, w, d, h, color, ...extra });
    // 射線を邪魔しない低い距離マーカーと、射撃場の外周だけを物理壁にする。
    add(-27, -50, 2, 132, 4.2, '#445149', {
      terrain: 'screen',
      noGrapple: true,
      mapCover: true
    });
    // Keep the original lanes, but widen the right side into a walkable woodland.
    add(77, -50, 2, 132, 4.2, '#445149', {
      terrain: 'screen',
      noGrapple: true,
      mapCover: true
    });
    add(25, 14, 106, 2, 4.2, '#445149', {
      terrain: 'screen',
      noGrapple: true,
      mapCover: true
    });
    add(25, -116, 106, 2, 7, '#5b4a3e', {
      terrain: 'screen',
      noGrapple: true,
      mapCover: true
    });
    [10, 25, 50, 75, 100].forEach((d, i) => {
      let z = 6 - d;
      add(0, z, 52, 0.16, 0.08, i % 2 ? '#6e765e' : '#9a8655', {
        rangeMark: true,
        noGrapple: true
      });
    });
    // ベンチと左右レーンの目印。弾道より低いため射撃を遮らない。
    add(0, 9.5, 8, 1.6, 0.85, '#5f5a49', { cover: true, noGrapple: true });
    add(-13, -50, 0.12, 118, 0.06, '#9a8655', {
      rangeMark: true,
      noGrapple: true
    });
    add(13, -50, 0.12, 118, 0.06, '#9a8655', {
      rangeMark: true,
      noGrapple: true
    });
    // Forestry lane: identical 'grove' objects to survival, therefore the same
    // trunk-only player, projectile and sight collision shape. No debug overlays.
    const forestTargetSpots = [
      [40, -24],
      [54, -45],
      [43, -70],
      [63, -93]
    ];
    const treeColors = ['#334f3b', '#3c5b43', '#466347', '#304d3e', '#51694a'];
    let forestSeed = 90427;
    const forestRand = () => {
      forestSeed = (Math.imul(1664525, forestSeed) + 1013904223) >>> 0;
      return forestSeed / 4294967296;
    };
    for (let x = 33; x <= 69; x += 5.4)
      for (let z = -9; z >= -105; z -= 8.2) {
        if (forestRand() < 0.28) continue;
        const tx = x + (forestRand() - 0.5) * 4.2,
          tz = z + (forestRand() - 0.5) * 5.8;
        // Do not spawn a trunk on a target or in the access passage.
        if (
          forestTargetSpots.some(
            ([px, pz]) => Math.hypot(tx - px, tz - pz) < 3.8
          )
        )
          continue;
        let width = 4.8 + forestRand() * 4.3,
          height = 6.2 + forestRand() * 4.1;
        add(
          tx,
          tz,
          width,
          width * 0.91,
          height,
          treeColors[Math.floor(forestRand() * treeColors.length)],
          { terrain: 'grove', noGrapple: true, mapCover: true }
        );
      }
    // A simple shooting-through-hedge lane, adjacent to the woodland.
    // The target behind a hedge can still be hit: plant cover is not bulletproof.
    add(25, -31, 7, 1.4, 1.27, '#45664a', {
      terrain: 'hedge',
      softCover: true,
      noGrapple: true
    });
    add(23, -58, 1.4, 8, 1.27, '#486d50', {
      terrain: 'hedge',
      softCover: true,
      noGrapple: true
    });
    add(28, -84, 5.8, 1.35, 1.27, '#416147', {
      terrain: 'hedge',
      softCover: true,
      noGrapple: true
    });
    // A couple of ordinary pillars to compare against the irregular tree silhouettes.
    add(34, -43, 1.5, 1.5, 3.2, '#66736c', { cover: true, noGrapple: true });
    add(69, -71, 1.7, 1.7, 3.8, '#66736c', { cover: true, noGrapple: true });
    enemies = [];
    const target = (
      id,
      x,
      d,
      motion = 'static',
      span = 0,
      speed = 0,
      phase = 0
    ) => ({
      id,
      trainingTarget: true,
      baseX: x,
      baseZ: 6 - d,
      x,
      y: 0,
      z: 6 - d,
      yaw: 0,
      hp: 100,
      alive: true,
      cool: 0,
      think: 0,
      immobile: 0,
      revealedUntil: 0,
      investigateUntil: 0,
      shotSeq: 0,
      tx: x,
      tz: 6 - d,
      wid: 'p9',
      seekingPrimary: false,
      tactic: null,
      tacticUntil: 0,
      idleMode: 'range',
      lastTargetKey: null,
      lastTargetAt: 0,
      directTargetKey: null,
      lastSeen: null,
      reactionUntil: 0,
      belief: null,
      awareness: 'calm',
      searchX: x,
      searchZ: 6 - d,
      nextSearchAt: 0,
      lastProximityAt: 0,
      name: `${motion === 'sweep' ? 'MOVING' : 'STATIC'} ${d}m`,
      motion,
      span,
      speed,
      phase,
      respawnAt: 0
    });
    enemies.push(
      target(0, -8, 10),
      target(1, -8, 25),
      target(2, -8, 50),
      target(3, -8, 75),
      target(4, -8, 100)
    );
    enemies.push(
      target(5, 8, 10, 'sweep', 4, 1.5, 0.2),
      target(6, 8, 25, 'sweep', 6, 1.22, 1.0),
      target(7, 8, 50, 'sweep', 8, 1.0, 1.8),
      target(8, 8, 75, 'sweep', 9, 0.84, 2.6),
      target(9, 8, 100, 'sweep', 10, 0.7, 3.4)
    );
    // Forest targets are stationary: hit/miss directly reveals whether the trunk
    // blocked a shot. Respawn and scoring use the existing training machinery.
    const hedgeTarget = target(14, 25, 44);
    hedgeTarget.name = 'HEDGE 44m';
    enemies.push(hedgeTarget);
    forestTargetSpots.forEach(([x, z], i) => {
      const e = target(10 + i, x, 6 - z);
      e.name = 'FOREST ' + (i + 1);
      enemies.push(e);
    });
    window.__lastSignalEnemies = enemies;
  }
  function updateTrainingTargets(now) {
    for (const e of enemies) {
      if (!e.trainingTarget) continue;
      if (!e.alive) {
        if (now >= e.respawnAt) {
          e.alive = true;
          e.hp = 100;
        }
        continue;
      }
      if (e.motion === 'sweep') {
        let wave = Math.sin(now * e.speed + e.phase);
        e.x = e.baseX + wave * e.span;
        e.z = e.baseZ;
        e.yaw =
          Math.cos(now * e.speed + e.phase) >= 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        e.x = e.baseX;
        e.z = e.baseZ;
        e.yaw = 0;
      }
    }
  }
  function updateTrainingPanel() {
    if (gameMode !== 'training' || !player) return;
    let w = current(),
      acc = shots ? Math.round((hits / shots) * 100) : 0;
    $('#trainingStats').textContent =
      `SHOTS ${shots} · HITS ${hits} · ${acc}% · DOWN ${trainingDowns}`;
    $('#trainingWeaponInfo').textContent =
      `${fireModeLabel(w)} · DMG ${w.dmg}${w.pellets ? '×' + w.pellets : ''} · ${w.range}m · 反動 ${recoilLabel(w)} · 構え ${aimTimeLabel(w)} · 装填 ${w.reload ? w.reload.toFixed(2) + 's' : '—'} · 機動 ${Math.round((w.moveMul || 1) * 100)}%`;
    $('#trainingWeaponSelect').value = w.id;
  }
  function setTrainingWeapon(id, announce = true) {
    if (gameMode !== 'training' || !player) return;
    let w = W[id];
    if (!w || w.kind === 'melee') return;
    burstToken++;
    player.bursting = false;
    trainingWeaponIndex = Math.max(
      0,
      trainingWeapons.findIndex((q) => q.id === id)
    );
    player.slots[1] = id;
    player.slot = 1;
    player.reloading = 0;
    player.reloadTotal = 0;
    player.lead = 0;
    player.cool = 0;
    clearAim(true);
    ammo[id] = { mag: w.mag, reserve: 9999 };
    if (announce)
      msg(`${w.name} に変更 · ${fireModeLabel(w)} · 反動 ${recoilLabel(w)}`);
    updateTrainingPanel();
    updateHUD();
  }
  function cycleTrainingWeapon(dir) {
    if (gameMode !== 'training') return;
    trainingWeaponIndex =
      (trainingWeaponIndex + dir + trainingWeapons.length) %
      trainingWeapons.length;
    setTrainingWeapon(trainingWeapons[trainingWeaponIndex].id);
  }
  function resetTrainingTargets(resetScore = true) {
    if (gameMode !== 'training') return;
    let now = gameNow();
    for (const e of enemies) {
      if (!e.trainingTarget) continue;
      e.alive = true;
      e.hp = 100;
      e.respawnAt = now;
      e.x = e.baseX;
      e.z = e.baseZ;
    }
    projectiles = [];
    if (resetScore) {
      shots = 0;
      hits = 0;
      trainingDowns = 0;
    }
    updateTrainingPanel();
    msg('標的をリセット');
  }
  function startTraining() {
    resetTouchAimAssistSession();
    gameMode = 'training';
    totalTime = 0;
    remaining = 0;
    let initial = $('#trainingWeaponSelect').value || 'ar4';
    trainingWeaponIndex = Math.max(
      0,
      trainingWeapons.findIndex((w) => w.id === initial)
    );
    player = {
      isPlayer: true,
      x: 0,
      y: 0,
      z: 6,
      vy: 0,
      fallTop: 0,
      grounded: true,
      crouched: false,
      yaw: 0,
      pitch: 0,
      hp: 100,
      slot: 1,
      slots: ['knife', initial, 'p9'],
      cool: 0,
      reloading: 0,
      reloadTotal: 0,
      lead: 0,
      sprint: 100,
      alive: true,
      mapSpeed: 0,
      immobile: 0,
      grapple: null,
      ropeCd: 0,
      aiming: false,
      aimBlend: 0,
      bursting: false,
      trapCounts: { mine: 0, wire: 0, bear: 0 }
    };
    makeTrainingWorld();
    ammo = {};
    weapons.forEach((w) => (ammo[w.id] = { mag: w.mag, reserve: 9999 }));
    shots = hits = kills = trainingDowns = 0;
    lastPulse = -1;
    lastNpcLiveSignalAt = 0;
    revealUntil = 0;
    soundEvents = [];
    projectiles = [];
    feed = [];
    pickupNear = null;
    keys = {};
    mapTrail = [{ x: player.x, z: player.z, t: gameNow() }];
    mapSampleAt = 0;
    burstToken++;
    resetTouchControls();
    state = 'play';
    window.LSAudio?.ensure();
    window.LSAudio?.ambient();
    $('#start').classList.add('hidden');
    $('#result').classList.add('hidden');
    $('#pause').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    $('#trainingPanel').classList.remove('hidden');
    $('#minimapWrap').classList.add('hidden');
    $('#retireBtn').textContent = '訓練を終了';
    applyTouchUIVisibility();
    msg('射撃訓練場：正面は距離別の的、右側に森林射撃エリア');
    msg('[ / ] で武器切替 · T で標的リセット');
    updateHUD();
    updateTrainingPanel();
    canvas.focus();
    let lm = resolvedLookMode();
    if (lm === 'pointerlock') msg('画面をクリックするとマウス視点を固定');
    else if (lm === 'pointerevents')
      msg(
        inputSettings.edgeAssist
          ? '外付けマウス視点：Pointer Events + EDGE TURN'
          : '外付けマウス視点：Pointer Events'
      );
    if (inputSettings.fullscreen)
      try {
        let p = document.documentElement.requestFullscreen?.();
        p?.catch?.(() => {});
      } catch (e) {}
  }
  function leaveTraining() {
    if (gameMode !== 'training') return;
    burstToken++;
    state = 'menu';
    gameMode = 'survival';
    mouseDown = false;
    keys = {};
    if (player) clearAim(true);
    document.exitPointerLock?.();
    $('#pause').classList.add('hidden');
    $('#settings').classList.add('hidden');
    $('#hud').classList.add('hidden');
    $('#trainingPanel').classList.add('hidden');
    $('#minimapWrap').classList.remove('hidden');
    $('#mobileControls').classList.remove('gameOn');
    $('#retireBtn').textContent = 'リタイア';
    $('#start').classList.remove('hidden');
  }
  const MOVE_AUDIT = window.LSMovementAudit;
  function newGame() {
    MOVE_AUDIT?.start();
    nextTacticsSample = 0;
    fastSimClock = null;
    fastSimActive = false;
    fastSimToken++;
    resetTouchAimAssistSession();
    gameMode = 'survival';
    $('#trainingPanel').classList.add('hidden');
    $('#minimapWrap').classList.remove('hidden');
    $('#retireBtn').textContent = 'リタイア';
    totalTime = +$('#durationSelect').value;
    remaining = totalTime;
    let secondary = $('#sidearmSelect').value,
      brainOrder =
        LEARN?.beginMatch(10, totalTime) ||
        Array.from({ length: 10 }, (_, i) => i);
    player = {
      isPlayer: true,
      x: 0,
      y: 0,
      z: 0,
      vy: 0,
      fallTop: 0,
      grounded: true,
      crouched: false,
      yaw: 0,
      pitch: 0,
      hp: 100,
      slot: 2,
      slots: ['knife', null, secondary],
      cool: 0,
      reloading: 0,
      reloadTotal: 0,
      lead: 0,
      sprint: 100,
      alive: true,
      mapSpeed: 0,
      immobile: 0,
      grapple: null,
      ropeCd: 0,
      aiming: false,
      aimBlend: 0,
      bursting: false,
      trapCounts: { mine: 0, wire: 0, bear: 0 }
    };
    let selected = G[secondary];
    if (selected?.kind === 'utility' && selected.utility !== 'rope')
      player.trapCounts[selected.utility] = selected.charges;
    makeWorld();
    const spawns = sharedSpawnPoints(11);
    player.x = spawns[0].x;
    player.z = spawns[0].z;
    player.yaw = rand(0, TAU);
    ammo = {};
    weapons.forEach((w) => (ammo[w.id] = { mag: w.mag, reserve: w.reserve }));
    enemies = [];
    let starterSidearms = weapons.filter((w) => w.kind === 'sidearm');
    for (let i = 0; i < 10; i++) {
      let p = spawns[i + 1],
        starter =
          starterSidearms[Math.floor(Math.random() * starterSidearms.length)];
      enemies.push({
        id: i,
        brainId: brainOrder[i],
        x: p.x,
        y: 0,
        z: p.z,
        yaw: rand(0, TAU),
        hp: 100,
        alive: true,
        cool: rand(0, 2),
        think: 0,
        immobile: 0,
        revealedUntil: 0,
        investigateUntil: 0,
        shotSeq: 0,
        tx: p.x,
        tz: p.z,
        wid: starter.id,
        weaponAmmo: freshWeaponAmmo(starter),
        sidearmWid: starter.id,
        sidearmAmmo: freshWeaponAmmo(starter),
        reloadUntil: 0,
        seekingPrimary: true,
        tactic: null,
        tacticUntil: 0,
        idleMode: 'patrol',
        lastTargetKey: null,
        lastTargetAt: 0,
        directTargetKey: null,
        lastSeen: null,
        reactionUntil: 0,
        belief: null,
        awareness: 'calm',
        searchX: p.x,
        searchZ: p.z,
        nextSearchAt: 0,
        lastProximityAt: 0,
        routeUntil: 0,
        routeKind: 'spawn',
        exploreMode: null,
        exploreUntil: 0,
        exploreContext: null,
        exploreDecisionCount: 0,
        lootDropped: false,
        name: 'ECHO-' + String(brainOrder[i] + 1).padStart(2, '0')
      });
    }
    window.__lastSignalEnemies = enemies;
    MOVE_AUDIT?.register([player, ...enemies], settlements);
    LEARN?.refreshDebug(enemies);
    shots = hits = kills = 0;
    lastPulse = -1;
    lastNpcLiveSignalAt = 0;
    revealUntil = 0;
    soundEvents = [];
    projectiles = [];
    feed = [];
    pickupNear = null;
    keys = {};
    mapTrail = [{ x: player.x, z: player.z, t: gameNow() }];
    mapSampleAt = 0;
    burstToken++;
    resetTouchControls();
    state = 'play';
    window.LSAudio?.ensure();
    window.LSAudio?.ambient();
    $('#start').classList.add('hidden');
    $('#result').classList.add('hidden');
    $('#pause').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    applyTouchUIVisibility();
    msg('主武器なし：マップの橙色マーカーを探せ');
    msg(`${selected.name}を開始装備に選択`);
    updateHUD();
    canvas.focus();
    let lm = resolvedLookMode();
    if (lm === 'pointerlock') msg('画面をクリックするとマウス視点を固定');
    else if (lm === 'pointerevents')
      msg(
        inputSettings.edgeAssist
          ? '外付けマウス視点：Pointer Events + EDGE TURN'
          : '外付けマウス視点：Pointer Events'
      );
    if (inputSettings.fullscreen)
      try {
        let p = document.documentElement.requestFullscreen?.();
        p?.catch?.(() => {});
      } catch (e) {}
  }

  // 装備と照準
  function current() {
    return G[player.slots[player.slot]] || W.knife;
  }
  function canAim(g = current()) {
    return (
      !!g &&
      g.kind !== 'melee' &&
      g.kind !== 'utility' &&
      Number.isFinite(g.aimTime)
    );
  }
  function aimFactor() {
    return clamp(player?.aimBlend || 0, 0, 1);
  }
  function aimLookFactor(g = current()) {
    let a = aimFactor(),
      m = g?.adsLookMul ?? 1;
    return 1 - (1 - m) * a;
  }
  function scopeVisualActive(g = current(), a = aimFactor()) {
    return !!player?.aiming && g?.id === 'longshot' && a > 0.72;
  }
  function resetAimVisual() {
    let ch = $('#crosshair');
    $('#scopeOverlay').classList.add('hidden');
    if (ch) {
      ch.style.transform = 'translate(-50%,-50%)';
      ch.style.opacity = '';
      ch.classList.remove('aiming');
    }
  }
  function clearAim(instant = false) {
    if (!player) return;
    player.aiming = false;
    touchAdsTemporarilyOff = false;
    touchAimTarget = null;
    updateTemporaryAssistButton();
    if (instant) {
      player.aimBlend = 0;
      resetAimVisual();
    } else $('#scopeOverlay').classList.add('hidden');
  }
  function setAim(on) {
    if (!player) return;
    let g = current();
    player.aiming = !!on && canAim(g) && !player.reloading && !player.grapple;
    if (!player.aiming) {
      touchAdsTemporarilyOff = false;
      touchAimTarget = null;
      $('#scopeOverlay').classList.add('hidden');
    }
    updateTemporaryAssistButton();
    updateHUD();
  }
  function toggleAim(force) {
    setAim(typeof force === 'boolean' ? force : !player?.aiming);
  }
  function updateAim(dt) {
    if (!player) return;
    let g = current();
    if (!canAim(g)) {
      player.aiming = false;
      touchAdsTemporarilyOff = false;
    }
    updateTemporaryAssistButton();
    let target = player.aiming && !player.reloading && !player.grapple ? 1 : 0,
      currentAim = clamp(player.aimBlend || 0, 0, 1),
      t = Math.max(0.06, g?.aimTime || 0.18),
      out = Math.max(0.07, t * 0.72);
    if (target > currentAim) currentAim = Math.min(target, currentAim + dt / t);
    else if (target < currentAim)
      currentAim = Math.max(target, currentAim - dt / out);
    else currentAim = target;
    player.aimBlend = currentAim;
    let scopeOn = scopeVisualActive(g, currentAim);
    $('#scopeOverlay').classList.toggle('hidden', !scopeOn);
    let ch = $('#crosshair');
    if (ch) {
      ch.style.transform = `translate(-50%,-50%) scale(${(1 - currentAim * 0.42).toFixed(3)})`;
      ch.style.opacity = scopeOn ? '0' : '';
      ch.classList.toggle('aiming', currentAim > 0.08);
    }
  }
  function touchAimPoint(t) {
    return { x: t.x, y: (t.y || 0) + (t.trainingTarget ? 1.08 : 1.1), z: t.z };
  }
  function touchAimGeometry(t) {
    if (!t?.alive || !player) return null;
    let p = touchAimPoint(t),
      ex = player.x,
      ey = player.y + eyeHeight(),
      ez = player.z,
      dx = p.x - ex,
      dz = p.z - ez,
      flat = Math.hypot(dx, dz);
    if (flat < 0.01) return null;
    let yaw = Math.atan2(dx, -dz),
      pitch = Math.atan2(p.y - ey, flat),
      dyaw = Math.abs(angleDiff(yaw, player.yaw)),
      dpitch = Math.abs(pitch - player.pitch);
    return { p, yaw, pitch, dyaw, dpitch, distance: flat };
  }
  function validTouchAimTarget(t, holding = false) {
    let q = touchAimGeometry(t);
    if (!q) return null;
    let g = current(),
      scope = g?.id === 'longshot';
    // Acquisition should require intentional, near-crosshair alignment, not an
    // automatic search of the wider viewport. Tracking is slightly more forgiving.
    // Mobile movement-friendly ADS: acquisition still needs deliberate crosshair proximity.
    // Once acquired, retain the target over a wider zone while the player strafes.
    let yawLimit = holding ? (scope ? 0.135 : 0.17) : scope ? 0.052 : 0.075;
    let pitchLimit = holding ? (scope ? 0.115 : 0.15) : scope ? 0.05 : 0.08;
    let maxRange = Math.min(
      scope ? SCOPE_FAR - 3 : FAR - 8,
      Math.max(38, (g?.range || 80) * 1.35)
    );
    if (q.distance > maxRange || q.dyaw > yawLimit || q.dpitch > pitchLimit)
      return null;
    if (
      !clearShot3D(
        player.x,
        player.y + eyeHeight(),
        player.z,
        q.p.x,
        q.p.y,
        q.p.z
      )
    )
      return null;
    return q;
  }
  function chooseTouchAimTarget() {
    let best = null,
      bestScore = 1e9;
    for (const t of enemies) {
      if (!t.alive) continue;
      let q = validTouchAimTarget(t, false);
      if (!q) continue;
      let score =
        (q.dyaw / 0.075) ** 2 + (q.dpitch / 0.08) ** 2 + q.distance / 700;
      if (score < bestScore) {
        bestScore = score;
        best = { target: t, q };
      }
    }
    return best;
  }
  function updateTouchAdsTracking(dt) {
    if (!touchAimAssistActive() || aimFactor() < 0.32) {
      touchAimTarget = null;
      touchAimCandidate = null;
      touchAimCandidateTime = 0;
      touchAimTrackRamp = 0;
      return;
    }
    let q = touchAimTarget ? validTouchAimTarget(touchAimTarget, true) : null;
    if (!q) {
      touchAimTarget = null;
      touchAimTrackRamp = 0;
      let picked = chooseTouchAimTarget(),
        candidate = picked?.target || null;
      if (!candidate) {
        touchAimCandidate = null;
        touchAimCandidateTime = 0;
        return;
      }
      if (candidate !== touchAimCandidate) {
        touchAimCandidate = candidate;
        touchAimCandidateTime = 0;
        return;
      }
      touchAimCandidateTime += Math.min(dt, 0.05);
      // A short deliberate hold prevents automatic scouting, without making moving shots impractical.
      if (touchAimCandidateTime < 0.1) return;
      touchAimTarget = candidate;
      q = picked.q;
      touchAimTrackRamp = 0;
    }
    touchAimCandidate = null;
    touchAimCandidateTime = 0;
    if (!touchAimTarget || !q) return;
    touchAimTrackRamp = Math.min(1, touchAimTrackRamp + dt / 0.2);
    let strength = clamp((aimFactor() - 0.26) / 0.52, 0, 1) * touchAimTrackRamp;
    let follow = 1 - Math.exp(-6.2 * dt * strength);
    player.yaw += angleDiff(q.yaw, player.yaw) * follow;
    player.pitch = clamp(
      player.pitch + (q.pitch - player.pitch) * follow,
      -1.15,
      1.15
    );
  }
  function eyeHeight() {
    return player?.crouched ? 1.18 : 1.7;
  }
  function updateHUD() {
    if (!player) return;
    let g = current(),
      a = g.kind === 'utility' ? null : ammo[g.id];
    $('#weaponName').textContent =
      `${player.slot + 1} / ${g.name} · ${weaponFamily(g).toUpperCase()}`;
    $('#weaponName').style.color = g.color;
    $('#weaponHud').classList.toggle('utilityHud', g.kind === 'utility');
    syncWeaponSprite(g);
    if (g.kind === 'utility') {
      $('#ammo').innerHTML =
        g.utility === 'rope'
          ? player.grapple
            ? player.grapple.descending
              ? 'DESCENDING'
              : 'PULLING'
            : player.ropeCd > 0
              ? `${player.ropeCd.toFixed(1)}<small>s</small>`
              : 'READY'
          : `${player.trapCounts[g.utility]}<small> / ${g.charges}</small>`;
    } else if (g.mag === Infinity) $('#ammo').innerHTML = '∞';
    else
      $('#ammo').innerHTML =
        `${a.mag}<small> / ${gameMode === 'training' ? '∞' : a.reserve}</small>`;
    $('#hpText').textContent = Math.ceil(player.hp);
    $('#hpFill').style.width = player.hp + '%';
    $('#hpFill').style.background =
      player.hp < 30 ? 'var(--red)' : 'var(--green)';
    if (gameMode === 'training') {
      $('#time').textContent = 'RANGE';
      $('#time').classList.remove('danger');
      $('#alive').textContent =
        enemies.filter((e) => e.trainingTarget && e.alive).length +
        '/' +
        enemies.filter((e) => e.trainingTarget).length;
      $('#signal').textContent = 'PRACTICE';
      $('#signal').className = 'hudvalue';
      $('#signal').style.color = '#8fe3b8';
    } else {
      let m = Math.max(0, remaining),
        mi = Math.floor(m / 60),
        se = Math.floor(m % 60);
      $('#time').textContent = `${mi}:${String(se).padStart(2, '0')}`;
      $('#time').classList.toggle('danger', remaining <= 60);
      $('#alive').textContent = 1 + enemies.filter((e) => e.alive).length;
      let live = gameNow() < revealUntil || remaining <= 60;
      $('#signal').textContent =
        remaining > 600 ? 'HIDDEN' : live ? 'EXPOSED' : 'PULSE WAIT';
      $('#signal').className = 'hudvalue ' + (live ? 'danger' : 'signal');
      $('#signal').style.color = '';
    }
    let pct = player.reloading
      ? clamp(1 - player.reloading / player.reloadTotal, 0, 1) * 100
      : 0;
    $('#reloadFill').style.width = pct + '%';
    $('#touchFire').textContent = g.kind === 'utility' ? 'USE' : 'FIRE';
    $('#touchScope').classList.toggle('active', player.aiming);
    $('#touchScope').textContent = g.id === 'longshot' ? 'SCOPE' : 'AIM';
    $('#touchScope').style.opacity = canAim(g) ? 1 : 0.38;
    updateTouchCrouchButton();
  }
  function updateActionButton() {
    let btn = $('#touchAction');
    if (!btn) return;
    btn.textContent = actionLabel || 'ACTION';
    let show = state === 'play' && !!actionType && shouldShowTouchUI();
    btn.classList.toggle('show', show);
    btn.style.display = show ? 'block' : 'none';
  }
  function msg(t) {
    if (fastSimActive) return;
    feed.unshift({ t, life: 5 });
    feed = feed.slice(0, 5);
    $('#feed').innerHTML = feed
      .map((f) => `<div class="feedItem">${f.t}</div>`)
      .join('');
  }

  // 衝突判定と移動
  const PLAYER_RADIUS = 0.45,
    ROOF_OVERHANG = 0.5,
    ROOF_CAP_HEIGHT = 0.28;
  // Grove foliage is visual cover, not an invisible solid wall. The physical
  // collision shape follows the visible trunk; leaves do not block bullets.
  function solidShape(o) {
    return o.terrain === 'grove'
      ? {
          ...o,
          w: Math.max(0.48, o.w * 0.16),
          d: Math.max(0.48, o.d * 0.16),
          h: o.h * 0.68
        }
      : o;
  }
  function obstacleTop(o) {
    return o.h + (o.building ? ROOF_CAP_HEIGHT : 0);
  }
  function supportHeightAt(x, z, maxY = Infinity) {
    let h = 0;
    for (const o of obstacles) {
      if (o.terrain === 'grove' || o.softCover) continue;
      let top = obstacleTop(o),
        pad = o.building ? ROOF_OVERHANG : -0.15;
      if (top > maxY) continue;
      if (
        Math.abs(x - o.x) <= o.w / 2 + pad &&
        Math.abs(z - o.z) <= o.d / 2 + pad
      )
        h = Math.max(h, top);
    }
    return h;
  }
  function blocked(x, z, r = 0.35, y = 0) {
    if (Math.abs(x) > HALF - r || Math.abs(z) > HALF - r) return true;
    return obstacles.some((raw) => {
      let o = solidShape(raw);
      return (
        Math.abs(x - o.x) < o.w / 2 + r &&
        Math.abs(z - o.z) < o.d / 2 + r &&
        y < o.h - 0.45
      );
    });
  }
  function resolvePlayerPenetration(r = PLAYER_RADIUS) {
    if (!player || player.grapple) return;
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (const raw of obstacles) {
        let o = solidShape(raw);
        if (player.y >= o.h - 0.45) continue;
        let dx = player.x - o.x,
          dz = player.z - o.z,
          px = o.w / 2 + r - Math.abs(dx),
          pz = o.d / 2 + r - Math.abs(dz);
        if (px <= 0 || pz <= 0) continue;
        if (px < pz)
          player.x = o.x + (dx >= 0 ? 1 : -1) * (o.w / 2 + r + 0.025);
        else player.z = o.z + (dz >= 0 ? 1 : -1) * (o.d / 2 + r + 0.025);
        moved = true;
      }
      if (!moved) break;
    }
    player.x = clamp(player.x, -HALF + r, HALF - r);
    player.z = clamp(player.z, -HALF + r, HALF - r);
  }
  // A short-lived obstacle-corner detour. It changes locomotion only, not an NPC's
  // selected destination, tactics, reward or learning. The same collision bounds
  // are used by the player, bullets and NPCs; no teleportation is performed.
  function npcTravelTarget(e) {
    if (e.navMode === 'combat' || e.navMode === 'avoid') return null;
    if (e.seekingPrimary) return { x: e.tx, z: e.tz };
    if (e.idleMode === 'patrol' || e.idleMode === 'ambush')
      return { x: e.tx, z: e.tz };
    if (e.awareness === 'suspicious' && e.belief)
      return { x: e.belief.x, z: e.belief.z };
    if (e.awareness === 'searching') return { x: e.searchX, z: e.searchZ };
    return null; // combat, retreats and partner formations retain direct control
  }
  function npcClearLeg(x, z, tx, tz, y) {
    const len = Math.hypot(tx - x, tz - z),
      n = Math.max(1, Math.ceil(len / 1.6));
    for (let i = 1; i <= n; i++)
      if (
        blocked(
          x + ((tx - x) * i) / n,
          z + ((tz - z) * i) / n,
          PLAYER_RADIUS,
          y
        )
      )
        return false;
    return true;
  }
  function npcDetourCorner(e, goal, y) {
    // Identify only objects actually intersecting the attempted travel corridor.
    // Four corners per culprit is enough on the nearly-flat world; do not build a
    // global path graph or run an expensive pathfinder every update.
    const vx = goal.x - e.x,
      vz = goal.z - e.z,
      len = Math.hypot(vx, vz);
    if (len < 0.4) return null;
    const ux = vx / len,
      uz = vz / len,
      probe = Math.min(6, len),
      candidates = [];
    for (const raw of obstacles) {
      const o = solidShape(raw);
      if (y >= o.h - 0.45) continue;
      const rx = o.w / 2 + PLAYER_RADIUS + 0.8,
        rz = o.d / 2 + PLAYER_RADIUS + 0.8;
      // Discard obstacles away from the first few meters of the desired line.
      const ahead = (o.x - e.x) * ux + (o.z - e.z) * uz;
      if (ahead < -0.8 || ahead > probe + Math.max(rx, rz)) continue;
      const lateral = Math.abs((o.x - e.x) * uz - (o.z - e.z) * ux);
      if (lateral > Math.hypot(rx, rz) + 0.5) continue;
      if (
        !Array.from({ length: 5 }, (_, k) => k).some((k) => {
          const t = (k / 4) * probe;
          return (
            Math.abs(e.x + ux * t - o.x) <= rx &&
            Math.abs(e.z + uz * t - o.z) <= rz
          );
        })
      )
        continue;
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const x = o.x + sx * rx,
            z = o.z + sz * rz;
          if (Math.abs(x) > HALF - 2 || Math.abs(z) > HALF - 2) continue;
          if (!npcClearLeg(e.x, e.z, x, z, y)) continue;
          const leg = Math.hypot(x - e.x, z - e.z),
            toGo = Math.hypot(goal.x - x, goal.z - z);
          // Penalize moving backwards, and prefer the existing side on ties.
          const backwards = Math.max(0, -((x - e.x) * ux + (z - e.z) * uz));
          const side = Math.sign((x - e.x) * -uz + (z - e.z) * ux) || 1;
          candidates.push({
            x,
            z,
            score:
              leg +
              toGo +
              backwards * 2 +
              (e.avoidSide && side !== e.avoidSide ? 0.7 : 0),
            side
          });
        }
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0] || null;
  }
  function moveEntity(e, dx, dz) {
    const startX = e.x,
      startZ = e.z,
      step = Math.hypot(dx, dz),
      y = e.y || 0;
    const npc =
      e !== player &&
      (e.brainId === 0 || !!e.brainId) &&
      Number.isFinite(step) &&
      step > 0.00001;
    if (!npc) {
      if (!blocked(e.x + dx, e.z, PLAYER_RADIUS, y)) e.x += dx;
      if (!blocked(e.x, e.z + dz, PLAYER_RADIUS, y)) e.z += dz;
      return;
    }
    const now = gameNow(),
      ux = dx / step,
      uz = dz / step,
      goal = npcTravelTarget(e);
    // Detours belong to one movement goal. Combat and major direction changes can
    // immediately interrupt them, so no tactical decision is hijacked.
    if (e.nav) {
      const nav = e.nav,
        angle = ux * nav.ux + uz * nav.uz;
      if (
        !goal ||
        now > nav.until ||
        angle < 0.45 ||
        Math.hypot(goal.x - nav.gx, goal.z - nav.gz) > 9 ||
        Math.hypot(e.x - nav.x, e.z - nav.z) < 1.15
      )
        e.nav = null;
    }
    let vx = ux,
      vz = uz;
    if (e.nav) {
      const n = e.nav,
        dist = Math.hypot(n.x - e.x, n.z - e.z);
      if (dist > 1e-5) {
        vx = (n.x - e.x) / dist;
        vz = (n.z - e.z) / dist;
      }
    }
    const attempt = (ax, az) => {
      if (!blocked(e.x + ax, e.z, PLAYER_RADIUS, y)) e.x += ax;
      if (!blocked(e.x, e.z + az, PLAYER_RADIUS, y)) e.z += az;
    };
    attempt(vx * step, vz * step);
    let moved = Math.hypot(e.x - startX, e.z - startZ);
    if (moved < step * 0.6) {
      if (!e.nav && goal && Math.hypot(goal.x - e.x, goal.z - e.z) > 3) {
        const corner = npcDetourCorner(e, goal, y);
        if (corner) {
          e.nav = {
            x: corner.x,
            z: corner.z,
            gx: goal.x,
            gz: goal.z,
            ux,
            uz,
            until:
              now +
              Math.max(
                5,
                Math.min(
                  17,
                  Math.hypot(corner.x - e.x, corner.z - e.z) / 1.0 + 3
                )
              )
          };
          e.avoidSide = corner.side;
        }
      }
      // Existing side-step is a safe fallback in dense forests and combat.
      // Hold the chosen side briefly to prevent left/right oscillation.
      const side = e.avoidSide || (e.brainId % 2 ? 1 : -1);
      const turns = e.nav
        ? [
            [e.nav.x - e.x, e.nav.z - e.z],
            [-uz * side, ux * side],
            [uz * side, -ux * side]
          ]
        : [
            [-uz * side, ux * side],
            [uz * side, -ux * side],
            [(ux - uz * side) * 0.707, (uz + ux * side) * 0.707],
            [(ux + uz * side) * 0.707, (uz - ux * side) * 0.707]
          ];
      for (const [tx, tz] of turns) {
        const d = Math.hypot(tx, tz);
        if (d < 1e-5) continue;
        const fx = tx / d,
          fz = tz / d;
        if (blocked(e.x + fx * 1.8, e.z + fz * 1.8, PLAYER_RADIUS, y)) continue;
        const ox = e.x,
          oz = e.z;
        attempt(fx * step, fz * step);
        if (Math.hypot(e.x - ox, e.z - oz) > step * 0.45) {
          if (!e.nav) e.avoidSide = fx * -uz + fz * ux >= 0 ? 1 : -1;
          break;
        }
      }
    }
    MOVE_AUDIT?.move(e, step, Math.hypot(e.x - startX, e.z - startZ));
  }

  function jump() {
    if (
      state !== 'play' ||
      !player.grounded ||
      player.grapple ||
      player.immobile > 0
    )
      return;
    player.crouched = false;
    touchCrouch = false;
    updateTouchCrouchButton();
    player.grounded = false;
    player.vy = 6.2;
    player.fallTop = player.y;
  }
  function updateVertical(dt) {
    if (player.grapple) {
      let g = player.grapple;
      g.t = Math.min(1, g.t + dt / g.dur);
      let ease = g.t * g.t * (3 - 2 * g.t);
      const lateral = g.descending ? Math.min(1, g.t * 5) : ease;
      player.x = g.sx + (g.tx - g.sx) * lateral;
      player.z = g.sz + (g.tz - g.sz) * lateral;
      player.y = g.descending
        ? g.sy * (1 - Math.max(0, (g.t - 0.2) / 0.8))
        : g.sy + (g.ty - g.sy) * ease + Math.sin(g.t * Math.PI) * 1.2;
      player.vy = 0;
      if (g.t >= 1) {
        player.x = g.tx;
        player.z = g.tz;
        player.y = g.ty;
        player.grounded = true;
        player.fallTop = g.ty;
        player.grapple = null;
        msg(g.descending ? '地面へ到達' : '屋根へ到達');
      }
      return;
    }
    let support = supportHeightAt(player.x, player.z, player.y + 0.45);
    if (player.vy > 0 || player.y > support + 0.04) {
      if (player.grounded) {
        player.grounded = false;
        player.fallTop = player.y;
      }
      player.vy -= 18 * dt;
      player.y += player.vy * dt;
      player.fallTop = Math.max(player.fallTop, player.y);
      if (player.y <= support) {
        let drop = player.fallTop - support;
        player.y = support;
        player.vy = 0;
        player.grounded = true;
        if (drop > 4) {
          let dmg = Math.round((drop - 4) * 9);
          hurt(player, dmg, { name: 'FALL' });
          msg(`落下ダメージ ${dmg}`);
        }
      }
    } else {
      player.y = support;
      player.vy = 0;
      player.grounded = true;
    }
  }
  function update(dt, now) {
    if (state !== 'play') return;
    if (gameMode === 'survival' && !player.alive) return;
    applyEdgeAssist(dt);
    if (gameMode === 'survival') {
      remaining -= dt;
      LEARN?.setMatchElapsed(Math.max(0, totalTime - remaining));
      if (remaining <= 0) {
        endGame(player.alive ? 'TIME SURVIVED' : 'ELIMINATED');
        return;
      }
    }
    player.cool = Math.max(0, player.cool - dt);
    player.lead = Math.max(0, player.lead - dt);
    player.ropeCd = Math.max(0, player.ropeCd - dt);
    player.immobile = Math.max(0, player.immobile - dt);
    if (player.reloading && !firearmStunned(player, now)) {
      player.reloading -= dt;
      if (player.reloading <= 0) finishReload();
    }
    updateAim(dt);
    updateTouchAdsTracking(dt);
    let beforeX = player.x,
      beforeZ = player.z,
      f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - touchMove.y,
      s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touchMove.x,
      l = Math.hypot(f, s) || 1,
      crouching = !!(keys.ShiftLeft || keys.ShiftRight || touchCrouch),
      g = current(),
      sprinting = !!(
        (keys.ControlLeft || keys.ControlRight) &&
        f > 0 &&
        !crouching &&
        !player.aiming &&
        player.sprint > 0
      ),
      aimMove = 1 - (1 - (g.adsMoveMul ?? 1)) * aimFactor(),
      speed =
        (crouching ? 2.65 : sprinting ? 8.2 : 5.1) * aimMove * (g.moveMul || 1);
    player.crouched = crouching && player.grounded;
    if (sprinting) player.sprint -= dt * 18;
    else player.sprint = Math.min(100, player.sprint + dt * 12);
    let sy = Math.sin(player.yaw),
      cy = Math.cos(player.yaw);
    if (!player.grapple && player.immobile <= 0)
      moveEntity(
        player,
        ((sy * f + cy * s) / l) * speed * dt,
        ((-cy * f + sy * s) / l) * speed * dt
      );
    updateVertical(dt);
    resolvePlayerPenetration();
    if (gameMode === 'survival') {
      const wantedMove =
        Math.hypot(f, s) > 0.005 && !player.grapple && player.immobile <= 0
          ? speed * dt * Math.min(1, Math.hypot(f, s))
          : 0;
      const moved = Math.hypot(player.x - beforeX, player.z - beforeZ);
      const nearest = enemies.reduce(
        (min, e) =>
          e.alive
            ? Math.min(min, Math.hypot(e.x - player.x, e.z - player.z))
            : min,
        Infinity
      );
      MOVE_AUDIT?.playerFrame(player, dt, wantedMove, moved, nearest, {
        shots,
        hits,
        kills
      });
      window.__lastSignalAuditPlayer = player;
    }
    let instantSpeed = dt
      ? Math.hypot(player.x - beforeX, player.z - beforeZ) / dt
      : 0;
    player.mapSpeed = player.mapSpeed * 0.82 + instantSpeed * 0.18;
    if (instantSpeed < 0.01 && player.mapSpeed < 0.025) player.mapSpeed = 0;
    if (now - mapSampleAt >= 0.2) {
      mapSampleAt = now;
      let tail = mapTrail[mapTrail.length - 1];
      if (!tail || Math.hypot(player.x - tail.x, player.z - tail.z) > 0.35)
        mapTrail.push({ x: player.x, z: player.z, t: now });
      mapTrail = mapTrail.filter((p) => now - p.t < 18).slice(-70);
    }
    let edge = HALF - Math.max(Math.abs(player.x), Math.abs(player.z));
    if (gameMode === 'survival') {
      $('#borderWarning').classList.toggle('hidden', edge > 45);
      if (edge < 3) {
        player.hp -= dt * 18;
        flashDamage();
      }
    } else $('#borderWarning').classList.add('hidden');
    if (mouseDown && current().auto) tryFire();
    pickupNear = pickups
      .filter((p) => !p.taken && Math.abs((p.y || 0) - player.y) < 2.2)
      .sort((a, b) => dist(a, player) - dist(b, player))[0];
    let activeGear = current(),
      ropeTarget =
        activeGear.utility === 'rope' && player.ropeCd <= 0 && !player.grapple
          ? findRopeDescent() || findRopeTarget()
          : null,
      touchActions = shouldShowTouchUI();
    actionType = '';
    actionLabel = '';
    if (pickupNear && dist(pickupNear, player) < 2.8) {
      let pickupName = G[pickupNear.wid].name;
      actionType = 'pickup';
      actionLabel = touchActions ? `PICKUP · ${pickupName}` : 'PICKUP';
      $('#prompt').classList.toggle('hidden', touchActions);
      $('#prompt').textContent = `PICKUP: ${pickupName} と交換 [E]`;
    } else if (ropeTarget) {
      pickupNear = null;
      actionType = 'rope';
      actionLabel = ropeTarget.descending ? 'DESCEND' : 'GRAPPLE';
      $('#prompt').classList.toggle('hidden', touchActions);
      $('#prompt').textContent = ropeTarget.descending
        ? 'DESCEND: ロープで降りる [E]'
        : `GRAPPLE: 高さ${obstacleTop(ropeTarget).toFixed(1)}mへ登る`;
    } else {
      $('#prompt').classList.add('hidden');
      pickupNear = null;
    }
    updateActionButton();
    if (gameMode === 'training') {
      updateTrainingTargets(now);
      updateProjectiles(dt);
    } else {
      updateEnemies(dt, now);
      LEARN?.socialPulse(enemies, now);
      updateProjectiles(dt);
      updateTraps(dt, now);
      let alive = enemies.filter((e) => e.alive).length;
      if (alive === 0) {
        endGame('LAST SURVIVOR');
        return;
      }
    }
    if (gameMode === 'survival' && totalTime >= 600 && remaining <= 600) {
      let pulse = Math.floor((600 - remaining) / 60);
      if (pulse !== lastPulse) {
        lastPulse = pulse;
        revealUntil = now + 8;
        broadcastSignalEvidence(now, remaining <= 60);
        msg(
          remaining <= 60
            ? '最終信号：全員の位置を常時公開'
            : '信号漏洩：8秒間、位置を公開'
        );
      }
      if (remaining <= 60 && now - lastNpcLiveSignalAt >= 0.5) {
        lastNpcLiveSignalAt = now;
        broadcastSignalEvidence(now, true);
      }
    } else if (gameMode === 'survival' && totalTime < 600) {
      let interval = Math.max(15, totalTime / 6),
        pulse = Math.floor((totalTime - remaining) / interval);
      if (remaining <= totalTime / 2 && pulse !== lastPulse) {
        lastPulse = pulse;
        revealUntil = now + 6;
        broadcastSignalEvidence(now, false);
        msg('試験信号：位置を公開');
      }
    }
    soundEvents.forEach((s) => (s.life -= dt));
    soundEvents = soundEvents.filter((s) => s.life > 0);
    feed.forEach((f) => (f.life -= dt));
    feed = feed.filter((f) => f.life > 0);
    if (hitTimer > 0) {
      hitTimer -= dt;
      if (hitTimer <= 0) $('#crosshair').classList.remove('hit');
    }
    updateHUD();
    if (gameMode === 'survival') {
      sampleTactics();
      drawMap(now);
    } else updateTrainingPanel();
  }
  let nextTacticsSample = 0;
  function recordTactics(
    actor,
    event,
    detail = '',
    other = null,
    sourceWeapon = ''
  ) {
    if (
      gameMode !== 'survival' ||
      !MOVE_AUDIT ||
      !actor ||
      (batchRun && !event.startsWith('pattern_'))
    )
      return;
    const weapon = actor.isPlayer ? current().id : actor.wid;
    const rounds = actor.isPlayer ? ammo[weapon] : actor.weaponAmmo;
    MOVE_AUDIT.tacticsEvent({
      elapsed: Math.max(0, totalTime - remaining),
      phase: fastSimActive ? 'fast_resolution' : 'live',
      actor: actor.isPlayer ? 'PLAYER' : actor.name,
      role: actor.isPlayer ? 'PLAYER' : 'AI',
      event,
      detail,
      x: actor.x,
      z: actor.z,
      yaw: actor.yaw,
      hp: actor.hp,
      weapon,
      mag: Number.isFinite(rounds?.mag) ? rounds.mag : '',
      reserve: Number.isFinite(rounds?.reserve) ? rounds.reserve : '',
      other: other?.isPlayer ? 'PLAYER' : (other?.name ?? ''),
      distance: other && Number.isFinite(other.x) ? dist(actor, other) : null,
      sourceWeapon
    });
  }
  function sampleTactics() {
    if (batchRun || !MOVE_AUDIT) return;
    const elapsed = totalTime - remaining;
    if (elapsed + 1e-6 < nextTacticsSample) return;
    nextTacticsSample = elapsed + 0.5;
    const actors = [player, ...enemies].filter((actor) => actor.alive);
    for (const actor of actors) {
      let nearest = null,
        nearestDistance = NPC_SIGHT_RANGE;
      for (const other of actors) {
        if (other === actor) continue;
        const distance = dist(actor, other);
        if (
          distance < nearestDistance &&
          clearSight3D(
            actor.x,
            (actor.y || 0) + 1.1,
            actor.z,
            other.x,
            (other.y || 0) + 1.1,
            other.z
          )
        ) {
          nearest = other;
          nearestDistance = distance;
        }
      }
      recordTactics(actor, 'sample', '', nearest);
    }
  }
  function clearShot3D(ax, ay, az, bx, by, bz) {
    return !obstacles.some(
      (o) => !o.softCover && segmentAabbT(ax, ay, az, bx, by, bz, o) !== null
    );
  }
  function clearSight3D(ax, ay, az, bx, by, bz) {
    return !obstacles.some(
      (o) => segmentAabbT(ax, ay, az, bx, by, bz, o) !== null
    );
  }
  // Each ground weapon carries its own remaining rounds. No pickup or swap can refill it.
  // A knife hit interrupts firearm actions, but never immobilizes the victim.
  const KNIFE_GUN_STUN_SECONDS = 0.65;
  function firearmStunned(actor, now = gameNow()) {
    return !!actor && now < (actor.gunStunUntil || 0);
  }
  function applyKnifeHitstun(target, attacker, now = gameNow()) {
    if (!target?.alive || !attacker || target === attacker) return;
    target.gunStunUntil = Math.max(
      target.gunStunUntil || 0,
      now + KNIFE_GUN_STUN_SECONDS
    );
    if (target === player) {
      // Abort delayed shots already queued by semi-auto lead or burst fire.
      burstToken++;
      player.bursting = false;
      player.lead = 0;
    }
  }
  function freshWeaponAmmo(w) {
    return w?.kind === 'melee'
      ? { mag: Infinity, reserve: Infinity }
      : { mag: w.mag, reserve: w.reserve };
  }
  function groundWeaponAmmo(p) {
    if (!p.ammoState) p.ammoState = freshWeaponAmmo(W[p.wid]);
    return p.ammoState;
  }
  function copyAmmo(a) {
    return a ? { mag: a.mag, reserve: a.reserve } : null;
  }
  // NPCs have the same finite ammunition as the player; reloads use real match time.
  function equipNpcGroundWeapon(e, p) {
    const w = W[p.wid];
    if (!w) return;
    if (e.wid && W[e.wid]?.kind === 'sidearm' && e.wid !== 'knife') {
      e.sidearmWid = e.wid;
      e.sidearmAmmo = copyAmmo(e.weaponAmmo);
    }
    const previous = e.wid;
    e.wid = p.wid;
    e.weaponAmmo = copyAmmo(groundWeaponAmmo(p));
    e.reloadUntil = 0;
    recordTactics(e, 'pickup', previous);
  }
  function npcWeaponReady(e, now) {
    let w = W[e.wid],
      a = e.weaponAmmo;
    if (!w || w.kind === 'melee') return true;
    if (firearmStunned(e, now)) return false;
    if (!a) {
      e.weaponAmmo = a = freshWeaponAmmo(w);
    }
    if (e.reloadUntil > now) return false;
    if (e.reloadUntil && e.reloadUntil <= now) {
      let n = Math.min(w.mag - a.mag, a.reserve);
      a.mag += n;
      a.reserve -= n;
      e.reloadUntil = 0;
    }
    if (a.mag > 0) return true;
    if (a.reserve > 0) {
      e.reloadUntil = now + w.reload;
      recordTactics(e, 'reload');
      return false;
    }
    // Switch to the original sidearm after the primary is exhausted.
    if (
      e.sidearmWid &&
      e.wid !== e.sidearmWid &&
      e.sidearmAmmo?.mag + e.sidearmAmmo?.reserve > 0
    ) {
      e.wid = e.sidearmWid;
      e.weaponAmmo = copyAmmo(e.sidearmAmmo);
      e.sidearmWid = null;
      e.sidearmAmmo = null;
      e.reloadUntil = 0;
      e.cool = Math.max(e.cool, 0.45);
      e.seekingPrimary = false;
      recordTactics(e, 'swap', w.id);
      return false;
    }
    // Empty weapon cannot fire. Knife remains a final fallback, with no free ammo.
    e.wid = 'knife';
    e.weaponAmmo = freshWeaponAmmo(W.knife);
    e.sidearmWid = null;
    e.sidearmAmmo = null;
    e.reloadUntil = 0;
    e.seekingPrimary = true;
    e.cool = Math.max(e.cool, 0.4);
    recordTactics(e, 'swap', w.id);
    return false;
  }

  // 敵の移動と戦術
  function nearestPrimaryPickup(e, maxD = 1000) {
    let best = null,
      bestScore = 1e9;
    for (const p of pickups) {
      if (p.taken) continue;
      let g = G[p.wid];
      if (!g || g.kind !== 'primary') continue;
      let d = dist(e, p);
      if (d > maxD) continue;
      let score = d - (LEARN?.weaponPreference(e, p.wid) || 0) * 18;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }
  function nearestBaitPickup(e, maxD = 150) {
    let best = null,
      bd = maxD;
    for (const p of pickups) {
      if (p.taken) continue;
      let d = dist(e, p);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }
  function enemySeekPrimary(e, dt, now) {
    if (!e.seekingPrimary) return false;
    let p = nearestPrimaryPickup(e);
    if (!p) return false;
    let d = dist(e, p);
    if (d < 1.8) {
      equipNpcGroundWeapon(e, p);
      e.seekingPrimary = false;
      p.taken = true;
      e.cool = Math.max(e.cool, 0.6);
      e.routeUntil = 0;
      e.think = 0;
      LEARN?.onPickup(e, p.wid);
      reportPickupDisappearance(p, e, now);
      return true;
    }
    let a = Math.atan2(p.x - e.x, -(p.z - e.z));
    e.yaw = a;
    if (e.immobile <= 0)
      moveEntity(e, Math.sin(a) * dt * 2.05, -Math.cos(a) * dt * 2.05);
    e.tx = p.x;
    e.tz = p.z;
    return true;
  }

  function setPatrolDestination(e, now) {
    const progress = totalTime > 0 ? clamp(1 - remaining / totalTime, 0, 1) : 0;
    const policy = LEARN?.chooseExplore(e, progress, now) || 'near';
    const ranges = {
      hold: [6, 22],
      near: [40, 100],
      mid: [110, 230],
      wide: [260, 400]
    };
    const [minimum, maximum] = ranges[policy] || ranges.near;
    let p = null;
    // Select an open point at the intended range, without a fixed attraction to
    // ALPHA / BRAVO / CHARLIE. Buildings and pickups remain ordinary game inputs.
    for (let i = 0; i < 45; i++) {
      const a = rand(0, TAU),
        r = rand(minimum, maximum),
        x = e.x + Math.cos(a) * r,
        z = e.z + Math.sin(a) * r;
      if (Math.abs(x) > 463 || Math.abs(z) > 463 || !pointOpen({ x, z }, 1.2))
        continue;
      p = { x, z };
      break;
    }
    if (!p) p = freePointNear(e.x, e.z, Math.min(maximum, 60));
    e.routeKind = 'explore_' + policy;
    e.tx = p.x;
    e.tz = p.z;
    const d = Math.hypot(e.tx - e.x, e.tz - e.z);
    // A long-range decision has enough time to reach its destination; combat,
    // weapon seeking, investigation and partner-following can still interrupt it.
    e.routeUntil =
      now +
      clamp(
        (d / (policy === 'wide' ? NPC_TRAFFIC_SPEED : NPC_LOCAL_SPEED)) * 1.35 +
          12,
        20,
        250
      );
    MOVE_AUDIT?.goal(e, e.routeKind, e.tx, e.tz, now);
  }
  function evidenceResponse(e, b, score) {
    if (!b) return 'investigate';
    let bias = LEARN?.investigationBias?.(e, b.source) || 0;
    if (b.source === 'sound' && (e.hp < 42 || (bias < -0.52 && score < 0.56)))
      return 'avoid';
    if (b.source === 'pickup' && bias < -0.62 && score < 0.22) return 'ignore';
    return 'investigate';
  }
  function findRetreatCover(e, target) {
    const away = Math.atan2(e.z - target.z, e.x - target.x);
    for (const distance of [4, 7, 10]) {
      for (const angle of [0, 0.55, -0.55, 1.1, -1.1, 1.57, -1.57]) {
        const dx = Math.cos(away + angle),
          dz = Math.sin(away + angle);
        const x = e.x + dx * distance,
          z = e.z + dz * distance;
        if (clearShot3D(x, 1.15, z, target.x, (target.y || 0) + 1.1, target.z))
          continue;
        let pathClear = true;
        for (let step = 0.5; step <= distance; step += 0.5) {
          if (blocked(e.x + dx * step, e.z + dz * step, PLAYER_RADIUS)) {
            pathClear = false;
            break;
          }
        }
        if (pathClear) return { x, z, dx, dz };
      }
    }
    return null;
  }
  function maybeBeginCoverTrial(e, target, td, now) {
    const weapon = W[e.wid];
    if (
      !LEARN ||
      e.immobile > 0 ||
      e.burstFire ||
      !weapon ||
      weapon.kind === 'melee' ||
      td < weapon.range ||
      !(e.weaponAmmo?.mag + e.weaponAmmo?.reserve > 0) ||
      now < (e.nextCoverCheck || 0) ||
      LEARN.sessionOf(e)?.coverTrial
    )
      return;
    e.nextCoverCheck = now + 1;
    if (!clearShot3D(e.x, 1.15, e.z, target.x, (target.y || 0) + 1.1, target.z))
      return;
    const cover = findRetreatCover(e, target);
    if (!cover) return;
    const choice = LEARN.beginCoverTrial(e, now, target);
    if (!choice) return;
    recordTactics(e, 'pattern_start', choice, target);
    if (choice === 'cover_wait')
      e.coverPlan = { ...cover, stage: 'cover', until: now + 4, target };
  }
  function updateCoverPlan(e, target, dt, now) {
    const plan = e.coverPlan;
    if (!plan) return false;
    if (target && target !== plan.target) {
      e.coverPlan = null;
      recordTactics(e, 'pattern_end', 'new_contact', target);
      return false;
    }
    if (plan.stage === 'cover') {
      const dx = plan.x - e.x,
        dz = plan.z - e.z,
        distance = Math.hypot(dx, dz);
      if (distance > 0.45 && now < plan.until) {
        if (e.immobile <= 0)
          moveEntity(
            e,
            (dx / distance) * dt * 2.65,
            (dz / distance) * dt * 2.65
          );
        return true;
      }
      const w = W[e.wid],
        ammo = e.weaponAmmo;
      const canReload = !!(
        w &&
        ammo &&
        ammo.mag < w.mag &&
        ammo.reserve > 0 &&
        !firearmStunned(e, now)
      );
      plan.stage =
        distance <= 0.45
          ? LEARN?.chooseCoverFollowup(e, canReload) || 'wait'
          : 'leave';
      if (plan.stage === 'reload') {
        e.reloadUntil = e.reloadUntil || now + w.reload;
        recordTactics(e, 'reload');
      }
      plan.until = now + (plan.stage === 'leave' ? 1.5 : 2);
      recordTactics(e, 'pattern_step', plan.stage, target);
    }
    if (plan.stage === 'reload') {
      if (e.reloadUntil > now) return true;
      npcWeaponReady(e, now);
      plan.stage = 'wait';
    }
    if (plan.stage === 'wait') {
      if (
        target &&
        dist(e, target) < (W[e.wid]?.range || 0) &&
        clearShot3D(e.x, 1.15, e.z, target.x, (target.y || 0) + 1.1, target.z)
      ) {
        e.coverPlan = null;
        recordTactics(e, 'pattern_end', 'counterattack', target);
        return false;
      }
      if (now < plan.until) return true;
      plan.stage = 'leave';
      plan.until = now + 1.5;
      recordTactics(e, 'pattern_step', 'leave', target);
    }
    if (now < plan.until) {
      if (e.immobile <= 0)
        moveEntity(e, plan.dx * dt * 2.65, plan.dz * dt * 2.65);
      return true;
    }
    e.coverPlan = null;
    recordTactics(e, 'pattern_end', 'disengaged', target);
    return false;
  }
  function settlePattern(e, now) {
    const result = LEARN?.settleCoverTrial(e, now);
    if (!result) return;
    recordTactics(
      e,
      'pattern_score',
      result.choice + ':' + result.score.toFixed(3)
    );
    if (result.branch)
      recordTactics(
        e,
        'pattern_branch_score',
        result.branch + ':' + result.branchScore.toFixed(3)
      );
  }
  function moveEnemyCombat(e, tar, td, dt, now, visibleCount) {
    let tk =
      LEARN?.targetKey(tar) || (tar === player ? 'player' : 'enemy:' + tar.id);
    if (!e.tactic || e.tacticUntil <= now || e.tacticTarget !== tk) {
      let choice = LEARN?.chooseCombat(e, td, visibleCount, tar) || {
        action: 'strafe',
        duration: 3
      };
      e.tactic = choice.action;
      e.tacticUntil = now + choice.duration;
      e.tacticTarget = tk;
    }
    e.lastTargetKey = tk;
    e.lastTargetAt = now;
    let ang = Math.atan2(tar.x - e.x, -(tar.z - e.z)),
      da = Math.atan2(Math.sin(ang - e.yaw), Math.cos(ang - e.yaw));
    e.yaw += clamp(da, -dt * 2.2, dt * 2.2);
    let w = W[e.wid],
      baseDesired = Math.min(w.range * 0.62, 35),
      desired =
        w.kind === 'melee'
          ? 1.45
          : e.tactic === 'rush'
            ? Math.max(5, baseDesired * 0.42)
            : e.tactic === 'retreat'
              ? Math.min(48, baseDesired * 1.5)
              : baseDesired,
      side = Math.sin(performance.now() / 700 + e.id),
      fx = Math.sin(e.yaw),
      fz = -Math.cos(e.yaw),
      rx = Math.cos(e.yaw),
      rz = Math.sin(e.yaw);
    if (e.immobile <= 0) {
      if (e.tactic === 'retreat') {
        if (td < desired) moveEntity(e, -fx * dt * 2.65, -fz * dt * 2.65);
        else moveEntity(e, rx * side * dt * 0.65, rz * side * dt * 0.65);
      } else if (e.tactic === 'flank') {
        let forward = td > desired ? 1.15 : 0;
        moveEntity(
          e,
          (fx * forward + rx * side * 2.15) * dt,
          (fz * forward + rz * side * 2.15) * dt
        );
      } else if (e.tactic === 'hold') {
        if (td < desired * 0.62)
          moveEntity(e, -fx * dt * 1.15, -fz * dt * 1.15);
      } else if (e.tactic === 'rush') {
        if (td > desired) moveEntity(e, fx * dt * 3.05, fz * dt * 3.05);
        else moveEntity(e, rx * side * dt * 1.2, rz * side * dt * 1.2);
      } else {
        if (td > desired) moveEntity(e, fx * dt * 2.4, fz * dt * 2.4);
        else moveEntity(e, rx * side * dt * 1.75, rz * side * dt * 1.75);
      }
    }
    updateEnemyFire(e, tar, tk, td, ang, da, now);
  }
  function updateEnemyFire(e, tar, targetKey, td, ang, da, now) {
    const pending = e.burstFire;
    if (!npcWeaponReady(e, now)) {
      e.burstFire = null;
      return;
    }
    const w = W[e.wid];
    const validShot =
      Math.abs(da) < 0.18 &&
      td < w.range &&
      now >= e.reactionUntil &&
      clearShot3D(
        e.x,
        (e.y || 0) + 1.15,
        e.z,
        tar.x,
        tar === player ? player.y + eyeHeight() * 0.68 : (tar.y || 0) + 1.1,
        tar.z
      );
    if (pending) {
      if (
        !validShot ||
        pending.weapon !== w ||
        pending.targetKey !== targetKey
      ) {
        e.burstFire = null;
        return;
      }
      if (now < pending.nextAt) return;
      fireEnemyRound(e, tar, w, td, ang, now);
      pending.rounds--;
      if (pending.rounds === 0) e.burstFire = null;
      else pending.nextAt = now + 1 / w.rof;
      e.cool = Math.max(e.cool, 1 / w.rof);
      return;
    }
    if (!validShot || e.cool > 0) return;
    if (w.burst) {
      const rounds = Math.min(w.burst, e.weaponAmmo.mag),
        lead = w.lead || 0;
      e.burstFire = { weapon: w, targetKey, rounds, nextAt: now + lead };
      e.cool = lead + rounds / w.rof;
      return;
    }
    e.cool =
      w.kind === 'melee'
        ? 1 / w.rof
        : 1 / w.rof + (w.lead || 0) + Math.random() * 0.18;
    if (w.kind === 'melee') {
      recordTactics(e, 'melee', '', tar);
      hurt(tar, w.dmg, e);
      return;
    }
    fireEnemyRound(e, tar, w, td, ang, now);
  }
  function fireEnemyRound(e, tar, w, td, ang, now) {
    LEARN?.coverTrialFired(e, tar, now);
    recordTactics(e, 'fire', '', tar);
    e.weaponAmmo.mag--;
    emitGunshot(e, w, now);
    e.shotSeq = (e.shotSeq || 0) + 1;
    let muzzleY = (e.y || 0) + 1.15,
      targetY =
        tar === player ? player.y + eyeHeight() * 0.68 : (tar.y || 0) + 1.1,
      tof = td / Math.max(1, w.speed || 120),
      drop = 0.5 * 9.81 * (w.gravity || 0) * tof * tof,
      aimPitch = Math.atan2(targetY + drop - muzzleY, td),
      accuracy = clamp(
        0.74 -
          (td / w.range) * 0.5 -
          w.spread * 3 -
          Math.abs((tar.y || 0) - (e.y || 0)) * 0.012,
        0.08,
        0.8
      ),
      miss = (1 - accuracy) * 0.055 + w.spread * 0.7,
      pellets = w.pellets || 1;
    for (let p = 0; p < pellets; p++) {
      let jy = rand(-miss, miss),
        jp = rand(-miss * 0.75, miss * 0.75);
      spawnProjectile(
        e,
        w,
        e.x,
        muzzleY,
        e.z,
        ang + jy,
        aimPitch + jp,
        w.dmg,
        null,
        e.shotSeq
      );
    }
  }
  function updateEnemyInvestigation(e, dt, now) {
    let b = e.belief;
    if (!b || now >= b.expiresAt) {
      e.belief = null;
      e.awareness = 'calm';
      return false;
    }
    let score = evidenceScore(e, b, now),
      d = Math.hypot(e.x - b.x, e.z - b.z),
      minScore = b.source === 'pickup' ? 0.035 : 0.08;
    if (score < minScore) return false;
    let response = evidenceResponse(e, b, score);
    if (response === 'ignore') {
      e.belief = null;
      e.awareness = 'calm';
      e.routeUntil = 0;
      return false;
    }
    if (response === 'avoid') {
      e.navMode = 'avoid';
      e.nav = null;
      let away = Math.atan2(e.x - b.x, -(e.z - b.z)),
        da = angleDiff(away, e.yaw);
      e.yaw += clamp(da, -dt * 1.45, dt * 1.45);
      if (e.immobile <= 0)
        moveEntity(e, Math.sin(e.yaw) * dt * 1.6, -Math.cos(e.yaw) * dt * 1.6);
      e.awareness = 'avoiding';
      if (d > 34 + b.uncertainty * 0.35 || now - b.at > 4.8) {
        e.belief = null;
        e.awareness = 'calm';
        e.routeUntil = 0;
      }
      return true;
    }
    let age = now - b.at,
      uncertainty = b.uncertainty + age * (b.source === 'signal' ? 1.8 : 1.1),
      arrive = Math.max(3, Math.min(10, uncertainty * 0.45));
    if (d > arrive) {
      let a = Math.atan2(b.x - e.x, -(b.z - e.z)),
        da = angleDiff(a, e.yaw);
      e.yaw += clamp(da, -dt * 1.65, dt * 1.65);
      let speed = b.source === 'pickup' ? 1.52 : 1.75 + clamp(score, 0, 0.7);
      if (e.immobile <= 0)
        moveEntity(
          e,
          Math.sin(e.yaw) * dt * speed,
          -Math.cos(e.yaw) * dt * speed
        );
      e.awareness = 'suspicious';
    } else {
      e.awareness = 'searching';
      if (now >= e.nextSearchAt) {
        e.nextSearchAt = now + rand(0.9, 1.6);
        let r = rand(1, Math.max(2, uncertainty)),
          a = rand(0, TAU);
        e.searchX = clamp(b.x + Math.cos(a) * r, -480, 480);
        e.searchZ = clamp(b.z + Math.sin(a) * r, -480, 480);
      }
      let a = Math.atan2(e.searchX - e.x, -(e.searchZ - e.z)),
        da = angleDiff(a, e.yaw);
      e.yaw += clamp(da, -dt * 1.3, dt * 1.3);
      if (e.immobile <= 0 && Math.hypot(e.searchX - e.x, e.searchZ - e.z) > 1.4)
        moveEntity(e, Math.sin(e.yaw) * dt * 0.9, -Math.cos(e.yaw) * dt * 0.9);
    }
    return true;
  }
  function updateEnemyIdle(e, dt, now) {
    if (updateEnemyInvestigation(e, dt, now)) return;
    if (enemySeekPrimary(e, dt, now)) return;
    let partner = LEARN?.pickPartner(e, enemies) || null;
    if (e.think <= 0) {
      e.think = rand(3.2, 6.4);
      let previous = e.idleMode;
      e.idleMode = LEARN?.chooseIdle(e, partner) || 'patrol';
      if (e.idleMode === 'shadow' && partner) {
        e.partnerBrainId = partner.brainId;
        e.routeUntil = 0;
      } else if (e.idleMode === 'ambush') {
        let bait = nearestBaitPickup(e);
        if (bait) {
          let a = Math.atan2(bait.x - e.x, -(bait.z - e.z));
          e.tx = clamp(bait.x - Math.sin(a) * rand(7, 12), -480, 480);
          e.tz = clamp(bait.z + Math.cos(a) * rand(7, 12), -480, 480);
          e.routeKind = 'ambush';
          e.routeUntil = now + rand(14, 26);
        } else {
          e.idleMode = 'patrol';
          e.routeUntil = 0;
        }
      }
      if (
        e.idleMode === 'patrol' &&
        (previous !== 'patrol' ||
          !e.routeUntil ||
          now >= e.routeUntil ||
          Math.hypot(e.x - e.tx, e.z - e.tz) < 5)
      )
        setPatrolDestination(e, now);
    }
    if (e.idleMode === 'shadow') {
      partner =
        enemies.find((x) => x.alive && x.brainId === e.partnerBrainId) ||
        partner;
      if (partner) {
        let d = dist(e, partner),
          a = Math.atan2(partner.x - e.x, -(partner.z - e.z));
        e.yaw = a;
        if (e.immobile <= 0) {
          if (d > 12)
            moveEntity(e, Math.sin(a) * dt * 1.75, -Math.cos(a) * dt * 1.75);
          else if (d < 6)
            moveEntity(e, -Math.sin(a) * dt * 0.8, Math.cos(a) * dt * 0.8);
        }
        return;
      }
      e.idleMode = 'patrol';
      e.routeUntil = 0;
    }
    if (
      e.idleMode === 'patrol' &&
      (!e.routeUntil ||
        now >= e.routeUntil ||
        Math.hypot(e.x - e.tx, e.z - e.tz) < 4.5)
    )
      setPatrolDestination(e, now);
    if (e.idleMode === 'ambush' && e.routeUntil && now >= e.routeUntil) {
      e.idleMode = 'patrol';
      e.routeUntil = 0;
      setPatrolDestination(e, now);
    }
    let a = Math.atan2(e.tx - e.x, -(e.tz - e.z));
    e.yaw = a;
    if (e.immobile <= 0) {
      let speed =
        e.idleMode === 'ambush'
          ? 1.05
          : e.routeKind === 'explore_wide'
            ? NPC_TRAFFIC_SPEED
            : NPC_LOCAL_SPEED;
      moveEntity(e, Math.sin(a) * dt * speed, -Math.cos(a) * dt * speed);
    }
  }
  function updateEnemies(dt, now) {
    let targets = [player, ...enemies].filter((e) => e.alive),
      aliveCount = targets.length;
    for (const e of enemies) {
      if (!e.alive) continue;
      settlePattern(e, now);
      MOVE_AUDIT?.beginFrame(e);
      e.cool -= dt;
      e.think -= dt;
      e.immobile = Math.max(0, e.immobile - dt);
      if (firearmStunned(e, now) && e.reloadUntil > 0) e.reloadUntil += dt;
      let visible = [],
        halfFov = e.awareness === 'calm' ? NPC_FOV_CALM : NPC_FOV_ALERT;
      for (const t of targets) {
        if (t === e || !t.alive) continue;
        let d = dist(e, t),
          bearing = Math.atan2(t.x - e.x, -(t.z - e.z)),
          facing = Math.abs(angleDiff(bearing, e.yaw)),
          ty =
            t === player
              ? player.y + (player.crouched ? 0.86 : 1.6)
              : (t.y || 0) + 1.6,
          line =
            d < NPC_SIGHT_RANGE &&
            (d < 2.8
              ? clearShot3D(e.x, 1.6, e.z, t.x, ty, t.z)
              : clearSight3D(e.x, 1.6, e.z, t.x, ty, t.z));
        if (line && facing <= halfFov)
          visible.push({ entity: t, distance: d, isPlayer: t === player });
        else if (line && d < 5.5 && now - e.lastProximityAt > 1.2) {
          e.lastProximityAt = now;
          rememberEvidence(
            e,
            t.x + rand(-2, 2),
            t.z + rand(-2, 2),
            'proximity',
            now,
            { confidence: 0.48, uncertainty: 3.5, duration: 3.5, target: t }
          );
        }
      }
      let tar =
        LEARN?.pickTarget(e, visible, aliveCount) ||
        (!LEARN &&
          visible.sort((a, b) => a.distance - b.distance)[0]?.entity) ||
        null;
      e.navMode = tar ? 'combat' : 'travel';
      if (tar) {
        e.nav = null;
        let tk =
            LEARN?.targetKey(tar) ||
            (tar === player ? 'player' : 'enemy:' + tar.id),
          w = W[e.wid];
        if (e.directTargetKey !== tk) {
          e.directTargetKey = tk;
          e.reactionUntil = now + rand(0.24, 0.5) + (w?.lead || 0);
        }
        e.lastSeen = { target: tar, key: tk, x: tar.x, z: tar.z, at: now };
        e.awareness = 'confirmed';
        e.belief = null;
        const td = dist(e, tar);
        if (!e.coverPlan) maybeBeginCoverTrial(e, tar, td, now);
        if (!updateCoverPlan(e, tar, dt, now))
          moveEnemyCombat(e, tar, td, dt, now, visible.length);
      } else {
        e.burstFire = null;
        if (e.directTargetKey && e.lastSeen) {
          rememberEvidence(e, e.lastSeen.x, e.lastSeen.z, 'lastSeen', now, {
            confidence: 0.88,
            uncertainty: 2.5,
            duration: 6.5,
            target: e.lastSeen.target
          });
          e.directTargetKey = null;
        }
        if (now - (e.lastTargetAt || 0) > 2) e.lastTargetKey = null;
        if (!updateCoverPlan(e, null, dt, now)) updateEnemyIdle(e, dt, now);
      }
      MOVE_AUDIT?.endFrame(e, dt, now);
    }
  }

  // 罠とロープ
  function lineDistance(t, x, z) {
    let hx = Math.cos(t.angle) * 3,
      hz = Math.sin(t.angle) * 3,
      ax = t.x - hx,
      az = t.z - hz,
      bx = t.x + hx,
      bz = t.z + hz,
      dx = bx - ax,
      dz = bz - az,
      l2 = dx * dx + dz * dz,
      q = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
    return Math.hypot(x - (ax + dx * q), z - (az + dz * q));
  }
  function triggerTrap(t, target, now) {
    t.active = false;
    let data = TRAP_DATA.find((d) => d.id === t.type),
      attacker = t.owner === 'player' ? player : { name: 'TRAP' };
    if (t.type === 'mine') {
      let victims =
        t.owner === 'player' ? enemies.filter((e) => e.alive) : [player];
      for (const v of victims)
        if (dist(t, v) < 6 && Math.abs((v.y || 0) - t.y) < 4)
          hurt(v, data.damage * (1 - dist(t, v) / 9), attacker);
      msg(target === player ? '地雷を踏んだ' : '地雷が作動');
    } else if (t.type === 'bear') {
      hurt(target, data.damage, attacker);
      target.immobile = Math.max(target.immobile || 0, 3);
      msg(target === player ? '虎バサミ：3秒間移動不能' : '虎バサミが作動');
    } else {
      hurt(target, data.damage, attacker);
      target.immobile = Math.max(target.immobile || 0, 0.7);
      target.revealedUntil = now + 8;
      for (const e of enemies)
        if (e.alive && e !== target)
          rememberEvidence(e, target.x, target.z, 'tripwire', now, {
            confidence: 0.84,
            uncertainty: 2.5,
            duration: 8,
            target
          });
      msg(
        target === player
          ? 'ワイヤー接触：位置情報が漏洩'
          : 'ワイヤー接触：敵を8秒間捕捉'
      );
    }
  }
  function updateTraps(dt, now) {
    for (const t of traps) {
      if (!t.active) continue;
      t.arm = Math.max(0, t.arm - dt);
      if (t.arm > 0) continue;
      let targets =
        t.owner === 'player'
          ? enemies.filter((e) => e.alive)
          : player.alive
            ? [player]
            : [];
      for (const target of targets) {
        if (Math.abs((target.y || 0) - t.y) > 1.6) continue;
        let hit =
          t.type === 'wire'
            ? lineDistance(t, target.x, target.z) < 0.55
            : dist(t, target) < (t.type === 'mine' ? 2.2 : 1.15);
        if (hit) {
          triggerTrap(t, target, now);
          break;
        }
      }
    }
  }
  function placeTrap(type) {
    if (state !== 'play' || player.grapple || current().utility !== type)
      return;
    let td = TRAP_DATA.find((d) => d.id === type);
    if (!td) return;
    if (player.trapCounts[type] <= 0) {
      msg(`${td.name} は残っていない`);
      return;
    }
    let x = player.x + Math.sin(player.yaw) * 2,
      z = player.z - Math.cos(player.yaw) * 2;
    if (
      blocked(x, z, 0.25, player.y) ||
      traps.some((t) => t.active && Math.hypot(t.x - x, t.z - z) < 1.5)
    ) {
      msg('ここには設置できない');
      return;
    }
    traps.push({
      type,
      x,
      z,
      y: player.y,
      angle: player.yaw + Math.PI / 2,
      owner: 'player',
      active: true,
      arm: 1.1
    });
    player.trapCounts[type]--;
    msg(`${td.name} 設置：1秒後に作動`);
    updateHUD();
  }
  function findRopeDescent() {
    if (!player.grounded || player.y < 0.7 || player.pitch > -0.35) return null;
    const dx = Math.sin(player.yaw),
      dz = -Math.cos(player.yaw);
    for (let d = 0.5; d <= 2.5; d += 0.25) {
      const x = player.x + dx * d,
        z = player.z + dz * d;
      if (blocked(x, z, PLAYER_RADIUS, player.y)) return null;
      if (supportHeightAt(x, z) > 0.01) continue;
      if (blocked(x, z, PLAYER_RADIUS)) return null;
      const margin = PLAYER_RADIUS;
      if (
        [
          [margin, 0],
          [-margin, 0],
          [0, margin],
          [0, -margin]
        ].some(([sx, sz]) => supportHeightAt(x + sx, z + sz) > 0.01)
      )
        continue;
      return { x, z, descending: true };
    }
    return null;
  }
  function findRopeTarget() {
    let best = null,
      score = 1e9;
    for (const o of obstacles) {
      if (o.noGrapple) continue;
      let top = obstacleTop(o),
        dx = o.x - player.x,
        dz = o.z - player.z,
        d = Math.hypot(dx, dz),
        rise = top - player.y;
      if (d > 15 || rise < 0.7 || rise > 8.2) continue;
      let ang = Math.atan2(dx, -dz),
        diff = Math.abs(
          Math.atan2(Math.sin(ang - player.yaw), Math.cos(ang - player.yaw))
        ),
        elev = Math.atan2(top - (player.y + eyeHeight() * 0.7), d),
        q = diff + Math.abs(elev - player.pitch) * 0.45 + d * 0.006;
      if (diff < 0.34 && q < score) {
        best = o;
        score = q;
      }
    }
    return best;
  }
  function useRope() {
    if (state !== 'play' || player.grapple || current().utility !== 'rope')
      return;
    if (player.ropeCd > 0) {
      msg(`投げ縄 再使用まで ${player.ropeCd.toFixed(1)}秒`);
      return;
    }
    const descent = findRopeDescent();
    if (descent) {
      clearAim(true);
      player.grapple = {
        sx: player.x,
        sy: player.y,
        sz: player.z,
        tx: descent.x,
        ty: 0,
        tz: descent.z,
        t: 0,
        dur: 1.9,
        descending: true
      };
      player.ropeCd = 8;
      recordTactics(player, 'rope_descend');
      msg('ロープ降下中：射撃不可');
      updateHUD();
      return;
    }
    let best = findRopeTarget();
    if (!best) {
      msg('投げ縄：届く上面が照準内にない');
      return;
    }
    let top = obstacleTop(best);
    clearAim(true);
    player.grapple = {
      sx: player.x,
      sy: player.y,
      sz: player.z,
      tx: best.x,
      ty: top,
      tz: best.z,
      t: 0,
      dur: 1.35
    };
    player.ropeCd = 8;
    msg(`投げ縄：${top.toFixed(1)}m上へ移動`);
    updateHUD();
  }

  // 武器とダメージ
  function dropEnemyWeapon(e, now = gameNow()) {
    if (!e || e.isPlayer || e.trainingTarget || e.lootDropped) return null;
    let g = W[e.wid];
    if (!g || g.kind === 'melee') return null;
    e.lootDropped = true;
    let a = rand(0, TAU),
      r = rand(0.35, 0.75),
      x = clamp(e.x + Math.cos(a) * r, -HALF + 2, HALF - 2),
      z = clamp(e.z + Math.sin(a) * r, -HALF + 2, HALF - 2),
      p = {
        x,
        z,
        y: Math.max(0, e.y || 0),
        wid: g.id,
        taken: false,
        ammoState: copyAmmo(e.weaponAmmo),
        loot: true,
        droppedAt: now,
        droppedBy: e.id
      };
    pickups.push(p);
    return p;
  }
  function hurt(t, dmg, attacker, sourceWeapon) {
    if (!t?.alive) return;
    let now = gameNow();
    if (gameMode === 'training' && t.trainingTarget) {
      t.hp -= dmg;
      if (t.hp <= 0) {
        t.hp = 0;
        t.alive = false;
        t.respawnAt = now + 0.7;
        trainingDowns++;
        msg(`${t.name} DOWN`);
        updateTrainingPanel();
      }
      return;
    }
    let wid = attacker === player ? current().id : attacker?.wid;
    if (
      t !== player &&
      Number.isFinite(attacker?.x) &&
      Number.isFinite(attacker?.z)
    ) {
      rememberEvidence(t, attacker.x, attacker.z, 'damage', now, {
        confidence: clearShot3D(
          t.x,
          (t.y || 0) + 1.1,
          t.z,
          attacker.x,
          (attacker.y || 0) + 1.1,
          attacker.z
        )
          ? 0.95
          : 0.48,
        uncertainty: clearShot3D(
          t.x,
          (t.y || 0) + 1.1,
          t.z,
          attacker.x,
          (attacker.y || 0) + 1.1,
          attacker.z
        )
          ? 2
          : 11,
        duration: 5.5,
        target: attacker
      });
      t.reactionUntil = Math.min(t.reactionUntil || now, now + 0.16);
    }
    LEARN?.onDamage(attacker, t, dmg, wid);
    t.hp -= dmg;
    if (wid === 'knife' && t.hp > 0) applyKnifeHitstun(t, attacker, now);
    if (t === player && !fastSimActive) {
      window.LSAudio?.hurt();
      flashDamage();
    }
    recordTactics(t, 'damage', dmg, attacker, sourceWeapon ?? wid);
    if (t.hp <= 0) {
      t.hp = 0;
      t.alive = false;
      settlePattern(t, now);
      recordTactics(t, 'eliminated', '', attacker, sourceWeapon ?? wid);
      LEARN?.onKill(attacker, t, enemies);
      if (t === player) {
        let place = 1 + enemies.filter((e) => e.alive).length;
        if (!fastSimActive) setTimeout(() => endGame('ELIMINATED', place), 350);
      } else {
        dropEnemyWeapon(t, now);
        if (attacker === player) {
          kills++;
          msg(`${t.name} を排除`);
        } else msg(`${attacker?.name || 'ENVIRONMENT'} → ${t.name}`);
      }
    }
  }
  function flashDamage() {
    $('#damageFlash').style.opacity = 0.85;
    clearTimeout(damageTimer);
    damageTimer = setTimeout(() => ($('#damageFlash').style.opacity = 0), 90);
  }
  function startBurst(w) {
    if (player.bursting) return;
    let a = ammo[w.id],
      count = Math.min(w.burst || 3, w.mag === Infinity ? w.burst || 3 : a.mag);
    if (count <= 0) {
      reload();
      return;
    }
    let token = ++burstToken,
      lead = Math.max(0, w.lead || 0),
      gap = 1 / Math.max(0.1, w.rof);
    player.bursting = true;
    player.lead = lead;
    player.cool = lead + gap * count;
    for (let i = 0; i < count; i++)
      setTimeout(
        () => {
          if (token !== burstToken || state !== 'play' || current().id !== w.id)
            return;
          fireNow(w, true);
        },
        (lead + gap * i) * 1000
      );
    setTimeout(
      () => {
        if (token === burstToken && player) player.bursting = false;
      },
      (lead + gap * count + 0.02) * 1000
    );
  }
  function tryFire() {
    if (
      state !== 'play' ||
      !player.alive ||
      player.grapple?.descending ||
      player.reloading ||
      player.cool > 0 ||
      player.bursting
    )
      return;
    let g = current();
    if (g.kind !== 'melee' && firearmStunned(player)) return;
    if (g.kind === 'utility') {
      player.cool = 0.28;
      if (g.utility === 'rope') useRope();
      else placeTrap(g.utility);
      return;
    }
    let a = ammo[g.id];
    if (g.mag !== Infinity && a.mag <= 0) {
      reload();
      return;
    }
    if (g.burst) {
      startBurst(g);
      return;
    }
    if (player.lead <= 0 && g.lead > 0) {
      player.lead = g.lead;
      player.cool = g.lead;
      setTimeout(() => {
        if (state === 'play' && current().id === g.id) fireNow(g);
      }, g.lead * 1000);
      return;
    }
    fireNow(g);
  }
  function projectileVisualMode(owner, w, shotOrdinal) {
    if (w.id === 'crossbow') return 'bolt';
    if (w.id === 'rail') return 'rail';
    if (w.id === 'flame') return 'flame';
    if (w.id === 'lmg' && shotOrdinal % 5 === 0) return 'tracer';
    if (owner === player && w.id === 'longshot' && aimFactor() > 0.7)
      return 'precision';
    if (owner === player && w.id === 'dmr') return 'precision';
    return 'faint';
  }
  function spawnProjectile(
    owner,
    w,
    x,
    y,
    z,
    yaw,
    pitch,
    damage,
    shotMeta,
    shotOrdinal = 1
  ) {
    let speed = Math.max(1, w.speed || 120),
      cp = Math.cos(pitch),
      visual = projectileVisualMode(owner, w, shotOrdinal);
    projectiles.push({
      owner,
      wid: w.id,
      x,
      y,
      z,
      vx: Math.sin(yaw) * cp * speed,
      vy: Math.sin(pitch) * speed,
      vz: -Math.cos(yaw) * cp * speed,
      gravity: 9.81 * (w.gravity || 0),
      damage,
      range: w.range,
      traveled: 0,
      shotMeta,
      color: w.color,
      alive: true,
      visual,
      trail: [{ x, y, z }],
      trailMax:
        visual === 'tracer'
          ? 7
          : visual === 'precision'
            ? 6
            : visual === 'rail'
              ? 8
              : visual === 'flame'
                ? 3
                : visual === 'faint'
                  ? 2
                  : 1
    });
  }
  function segmentSphereT(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
    let dx = bx - ax,
      dy = by - ay,
      dz = bz - az,
      l2 = dx * dx + dy * dy + dz * dz;
    if (l2 <= 1e-8) return null;
    let q = clamp(
        ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / l2,
        0,
        1
      ),
      px = ax + dx * q,
      py = ay + dy * q,
      pz = az + dz * q;
    return Math.hypot(px - cx, py - cy, pz - cz) <= r ? q : null;
  }
  function segmentAabbT(ax, ay, az, bx, by, bz, raw) {
    let o = solidShape(raw);
    let dx = bx - ax,
      dy = by - ay,
      dz = bz - az,
      t0 = 0,
      t1 = 1,
      mins = [o.x - o.w / 2, 0, o.z - o.d / 2],
      maxs = [o.x + o.w / 2, o.h, o.z + o.d / 2],
      as = [ax, ay, az],
      ds = [dx, dy, dz];
    for (let i = 0; i < 3; i++) {
      let a = as[i],
        d = ds[i],
        mn = mins[i],
        mx = maxs[i];
      if (Math.abs(d) < 1e-8) {
        if (a < mn || a > mx) return null;
        continue;
      }
      let u = (mn - a) / d,
        v = (mx - a) / d;
      if (u > v) {
        let q = u;
        u = v;
        v = q;
      }
      t0 = Math.max(t0, u);
      t1 = Math.min(t1, v);
      if (t0 > t1) return null;
    }
    return t0;
  }
  function projectileTargets(p) {
    if (p.owner === player) return enemies.filter((e) => e.alive);
    let arr = [];
    if (player.alive) arr.push(player);
    for (const e of enemies) if (e.alive && e !== p.owner) arr.push(e);
    return arr;
  }
  function updateProjectiles(dt) {
    for (const p of projectiles) {
      if (!p.alive) continue;
      let ax = p.x,
        ay = p.y,
        az = p.z,
        newVy = p.vy - p.gravity * dt,
        bx = ax + p.vx * dt,
        by = ay + (p.vy + newVy) * 0.5 * dt,
        bz = az + p.vz * dt,
        seg = Math.hypot(bx - ax, by - ay, bz - az);
      p.vy = newVy;
      let hitT = 2,
        hitTarget = null;
      for (const t of projectileTargets(p)) {
        let cy =
            t === player
              ? player.y + (player.crouched ? 0.66 : 1.05)
              : (t.y || 0) + 1.05,
          r = t === player ? (player.crouched ? 0.48 : 0.62) : 0.58,
          q = segmentSphereT(ax, ay, az, bx, by, bz, t.x, cy, t.z, r);
        if (q !== null && q < hitT) {
          hitT = q;
          hitTarget = t;
        }
      }
      let wallT = 2;
      for (const o of obstacles) {
        if (o.softCover) continue;
        let q = segmentAabbT(ax, ay, az, bx, by, bz, o);
        if (q !== null && q < wallT) wallT = q;
      }
      if (hitTarget && hitT <= wallT) {
        p.x = ax + (bx - ax) * hitT;
        p.y = ay + (by - ay) * hitT;
        p.z = az + (bz - az) * hitT;
        p.alive = false;
        hurt(hitTarget, p.damage, p.owner, p.wid);
        if (p.owner === player && p.shotMeta && !p.shotMeta.hit) {
          p.shotMeta.hit = true;
          hits++;
          $('#crosshair').classList.add('hit');
          hitTimer = 0.13;
        }
        continue;
      }
      if (
        wallT <= 1 ||
        by <= 0.02 ||
        Math.abs(bx) > HALF ||
        Math.abs(bz) > HALF
      ) {
        p.alive = false;
        continue;
      }
      p.x = bx;
      p.y = by;
      p.z = bz;
      p.traveled += seg;
      if (p.trailMax > 1) {
        p.trail.push({ x: p.x, y: p.y, z: p.z });
        if (p.trail.length > p.trailMax) p.trail.shift();
      }
      if (p.traveled >= p.range) p.alive = false;
    }
    projectiles = projectiles.filter((p) => p.alive);
  }
  function applyPlayerRecoil(w) {
    if (!player || w.kind === 'melee') return;
    let a = aimFactor(),
      rm = 1 - (1 - (w.adsRecoilMul ?? 1)) * a,
      r = (w.recoil || 0) * rm,
      y = (w.recoilYaw ?? (w.recoil || 0) * 0.55) * rm;
    if (r > 0) {
      player.pitch = clamp(player.pitch + r * rand(0.88, 1.16), -1.15, 1.15);
      player.yaw += rand(-y, y);
    }
    lastViewKick = (w.kick || 1) * rm;
  }
  function fireNow(w, fromBurst = false) {
    if (
      state !== 'play' ||
      player.grapple?.descending ||
      current().id !== w.id ||
      (w.kind !== 'melee' && firearmStunned(player))
    )
      return;
    lastViewShotAt = gameNow();
    lastViewKick = w.kick || 1;
    window.LSAudio?.shot(w);
    let a = ammo[w.id];
    if (w.mag !== Infinity && a.mag <= 0) return;
    recordTactics(player, w.kind === 'melee' ? 'melee' : 'fire');
    if (w.mag !== Infinity) a.mag--;
    if (!fromBurst) player.cool = 1 / w.rof;
    shots++;
    emitGunshot(player, w);
    $('#muzzle').style.opacity = 0.9;
    setTimeout(() => ($('#muzzle').style.opacity = 0), 45);
    let camY = player.y + eyeHeight();
    if (w.kind === 'melee') {
      let best = null,
        bd = w.range;
      for (const e of enemies) {
        if (!e.alive) continue;
        let d = dist(e, player);
        if (
          d < bd &&
          clearShot3D(player.x, camY, player.z, e.x, (e.y || 0) + 1.1, e.z)
        ) {
          best = e;
          bd = d;
        }
      }
      if (best) {
        hurt(best, w.dmg, player);
        hits++;
        $('#crosshair').classList.add('hit');
        hitTimer = 0.13;
      }
      updateHUD();
      return;
    }
    let pellets = w.pellets || 1,
      shotMeta = { hit: false },
      aim = aimFactor(),
      spreadMul = 1 - (1 - (w.adsSpreadMul ?? 1)) * aim,
      shotSpread = w.spread * spreadMul;
    for (let p = 0; p < pellets; p++) {
      let yaw = player.yaw + (Math.random() + Math.random() - 1) * shotSpread,
        pitch = player.pitch + (Math.random() + Math.random() - 1) * shotSpread;
      spawnProjectile(
        player,
        w,
        player.x,
        camY,
        player.z,
        yaw,
        pitch,
        w.dmg,
        shotMeta,
        shots
      );
    }
    applyPlayerRecoil(w);
    updateHUD();
    if (gameMode === 'training') updateTrainingPanel();
  }
  function reload() {
    let w = current();
    if (w.kind === 'utility' || firearmStunned(player)) return;
    burstToken++;
    player.bursting = false;
    let a = ammo[w.id];
    if (
      w.mag === Infinity ||
      player.reloading ||
      a.mag >= w.mag ||
      a.reserve <= 0
    )
      return;
    clearAim(false);
    player.reloading = w.reload;
    player.reloadTotal = w.reload;
    recordTactics(player, 'reload');
    window.LSAudio?.reload();
    msg(`${w.name} 装填中`);
  }
  function finishReload() {
    let w = current(),
      a = ammo[w.id],
      need = w.mag - a.mag,
      take = Math.min(need, a.reserve);
    a.mag += take;
    a.reserve -= take;
    player.reloading = 0;
  }
  function swap(slot) {
    if (!player || player.grapple?.descending || slot < 0 || slot > 2) return;
    burstToken++;
    player.bursting = false;
    if (!player.slots[slot]) {
      msg(slot === 1 ? '主武器なし：フィールドで取得' : '装備なし');
      return;
    }
    const previous = current().id;
    player.slot = slot;
    player.reloading = 0;
    player.lead = 0;
    clearAim(true);
    if (previous !== current().id) recordTactics(player, 'swap', previous);
    updateHUD();
  }
  function cycleSwap(dir = 1) {
    if (!player) return;
    for (let i = 1; i <= 3; i++) {
      let s = (player.slot + dir * i + 3) % 3;
      if (player.slots[s]) {
        swap(s);
        return;
      }
    }
  }
  function pickup() {
    if (!pickupNear || player.grapple?.descending) return;
    window.LSAudio?.pickup();
    let p = pickupNear,
      g = G[p.wid],
      slot = g.kind === 'sidearm' || g.kind === 'utility' ? 2 : 1,
      old = player.slots[slot],
      newAmmo = g.kind === 'utility' ? null : copyAmmo(groundWeaponAmmo(p)),
      oldAmmo = old && W[old] ? copyAmmo(ammo[old]) : null;
    player.slots[slot] = g.id;
    if (old) {
      p.wid = old;
      p.ammoState = oldAmmo;
    } else {
      p.taken = true;
      p.ammoState = null;
      reportPickupDisappearance(p, player);
    }
    if (
      g.kind === 'utility' &&
      g.utility !== 'rope' &&
      player.trapCounts[g.utility] === 0
    )
      player.trapCounts[g.utility] = g.charges;
    if (g.kind !== 'utility') ammo[g.id] = newAmmo;
    player.slot = slot;
    player.reloading = 0;
    player.reloadTotal = 0;
    burstToken++;
    player.bursting = false;
    clearAim(true);
    msg(`${g.name} を取得：${slot === 2 ? '副武器枠を交換' : '主武器を確保'}`);
    pickupNear = null;
    recordTactics(player, 'pickup', old ?? '');
    updateHUD();
  }

  // ミニマップと画面描画
  function drawMap(now) {
    let w = mini.width,
      h = mini.height,
      left = 10,
      right = w - 10,
      top = 10,
      bottom = h - 10,
      toX = (x) => left + ((x + HALF) / WORLD) * (right - left),
      toY = (z) => top + ((z + HALF) / WORLD) * (bottom - top);
    mctx.clearRect(0, 0, w, h);
    mctx.fillStyle = '#07100f';
    mctx.fillRect(0, 0, w, h);
    mctx.strokeStyle = 'rgba(82,98,90,.34)';
    mctx.lineWidth = 1;
    for (let q = -250; q <= 250; q += 250) {
      mctx.beginPath();
      mctx.moveTo(toX(q), top);
      mctx.lineTo(toX(q), bottom);
      mctx.stroke();
      mctx.beginPath();
      mctx.moveTo(left, toY(q));
      mctx.lineTo(right, toY(q));
      mctx.stroke();
    }
    mctx.strokeStyle = '#52625a';
    mctx.lineWidth = 2;
    mctx.strokeRect(left, top, right - left, bottom - top);
    mctx.fillStyle = 'rgba(73,91,78,.28)';
    for (const o of obstacles) {
      if (!o.mapCover) continue;
      let x1 = toX(o.x - o.w / 2),
        x2 = toX(o.x + o.w / 2),
        y1 = toY(o.z - o.d / 2),
        y2 = toY(o.z + o.d / 2);
      mctx.fillRect(
        Math.min(x1, x2),
        Math.min(y1, y2),
        Math.max(1, Math.abs(x2 - x1)),
        Math.max(1, Math.abs(y2 - y1))
      );
    }
    mctx.fillStyle = 'rgba(130,117,83,.22)';
    mctx.strokeStyle = 'rgba(198,178,118,.45)';
    for (const s of settlements) {
      mctx.beginPath();
      mctx.arc(toX(s.x), toY(s.z), 13, 0, TAU);
      mctx.fill();
      mctx.stroke();
    }
    for (const p of pickups) {
      if (p.taken) continue;
      let g = G[p.wid],
        x = toX(p.x),
        y = toY(p.z);
      if (p.loot || g?.kind === 'primary') {
        mctx.save();
        mctx.translate(x, y);
        mctx.rotate(Math.PI / 4);
        mctx.fillStyle = p.loot ? '#ffd06a' : '#ffb24a';
        let sz = p.loot ? 4 : 3;
        mctx.fillRect(-sz, -sz, sz * 2, sz * 2);
        if (p.loot) {
          mctx.strokeStyle = 'rgba(55,28,4,.9)';
          mctx.lineWidth = 1.5;
          mctx.strokeRect(-sz, -sz, sz * 2, sz * 2);
        }
        mctx.restore();
      } else {
        mctx.fillStyle = '#52645b';
        mctx.fillRect(x - 1, y - 1, 3, 3);
      }
    }
    if (mapTrail.length > 1) {
      mctx.beginPath();
      mctx.moveTo(toX(mapTrail[0].x), toY(mapTrail[0].z));
      for (let i = 1; i < mapTrail.length; i++)
        mctx.lineTo(toX(mapTrail[i].x), toY(mapTrail[i].z));
      mctx.strokeStyle = 'rgba(255,178,74,.48)';
      mctx.lineWidth = 2;
      mctx.lineCap = 'round';
      mctx.stroke();
    }
    let exposed = now < revealUntil || remaining <= 60,
      visibleEnemies = enemies
        .filter((e) => e.alive && (exposed || e.revealedUntil > now))
        .map((e) => ({ e, x: toX(e.x), y: toY(e.z) })),
      clusters = [];
    for (const p of visibleEnemies) {
      let c = clusters.find((c) => Math.hypot(c.x - p.x, c.y - p.y) < 10);
      if (c) {
        c.items.push(p);
        c.x = (c.x * (c.items.length - 1) + p.x) / c.items.length;
        c.y = (c.y * (c.items.length - 1) + p.y) / c.items.length;
      } else clusters.push({ x: p.x, y: p.y, items: [p] });
    }
    for (const c of clusters) {
      mctx.beginPath();
      mctx.arc(c.x, c.y, 6, 0, TAU);
      mctx.fillStyle = '#ff5a47';
      mctx.fill();
      mctx.strokeStyle = 'rgba(35,6,5,.95)';
      mctx.lineWidth = 2;
      mctx.stroke();
      if (c.items.length > 1) {
        mctx.fillStyle = '#fff4e8';
        mctx.font = '800 13px monospace';
        mctx.textAlign = 'center';
        mctx.textBaseline = 'middle';
        mctx.fillText('×' + c.items.length, c.x, c.y - 13);
      }
    }
    let px = toX(player.x),
      py = toY(player.z),
      pulse = 10 + Math.sin(now * 6) * 2;
    mctx.strokeStyle = 'rgba(255,178,74,.5)';
    mctx.lineWidth = 2;
    mctx.beginPath();
    mctx.arc(px, py, pulse, 0, TAU);
    mctx.stroke();
    mctx.save();
    mctx.translate(px, py);
    mctx.rotate(player.yaw);
    mctx.fillStyle = '#ffb24a';
    mctx.beginPath();
    mctx.moveTo(0, -9);
    mctx.lineTo(6, 7);
    mctx.lineTo(-6, 7);
    mctx.closePath();
    mctx.fill();
    mctx.restore();
    drawSoundBearings(px, py);
    let near = visibleEnemies.filter(
      (p) => Math.hypot(p.x - px, p.y - py) < 13
    );
    if (near.length) {
      mctx.strokeStyle = '#ff5a47';
      mctx.lineWidth = 3;
      mctx.beginPath();
      mctx.arc(px, py, 15 + Math.sin(now * 8) * 2, 0, TAU);
      mctx.stroke();
      if (near.length > 1) {
        mctx.fillStyle = '#fff4e8';
        mctx.font = '800 13px monospace';
        mctx.textAlign = 'center';
        mctx.textBaseline = 'middle';
        mctx.fillText('×' + near.length, px, py - 20);
      }
    }
    $('#mapCoords').textContent =
      `X${Math.round(player.x)} Z${Math.round(player.z)} H${player.y.toFixed(1)} |${player.mapSpeed.toFixed(1)}`;
  }
  function angleDiff(a, b) {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b));
  }
  function resizeOrientationHud() {
    let d = Math.min(devicePixelRatio || 1, 1.5),
      w = Math.max(1, Math.floor(viewportWidth * d)),
      h = Math.max(1, Math.floor(viewportHeight * d));
    if (oriCanvas.width !== w || oriCanvas.height !== h) {
      oriCanvas.width = w;
      oriCanvas.height = h;
    }
  }
  function compassLabel(deg) {
    deg = ((deg % 360) + 360) % 360;
    if (deg === 0) return 'N';
    if (deg === 90) return 'E';
    if (deg === 180) return 'S';
    if (deg === 270) return 'W';
    return String(deg).padStart(3, '0') + '°';
  }
  function drawOrientationHUD() {
    if (!player || state === 'menu' || state === 'result') {
      oriCtx.clearRect(0, 0, oriCanvas.width, oriCanvas.height);
      return;
    }
    resizeOrientationHud();
    const w = viewportWidth,
      h = viewportHeight,
      d = oriCanvas.width / Math.max(1, w);
    oriCtx.setTransform(d, 0, 0, d, 0, 0);
    oriCtx.clearRect(0, 0, w, h);
    oriCtx.save();
    oriCtx.font = '700 11px monospace';
    oriCtx.textAlign = 'center';
    oriCtx.textBaseline = 'middle';
    let center = w / 2,
      barW = Math.min(w * 0.52, 520),
      half = barW / 2,
      y = Math.max(58, Math.min(82, h * 0.095)),
      heading = ((((player.yaw * 180) / Math.PI) % 360) + 360) % 360;
    oriCtx.fillStyle = 'rgba(6,11,10,.58)';
    oriCtx.fillRect(center - half, y - 17, barW, 34);
    oriCtx.strokeStyle = 'rgba(244,234,216,.16)';
    oriCtx.strokeRect(center - half, y - 17, barW, 34);
    for (
      let deg = Math.floor((heading - 75) / 15) * 15;
      deg <= heading + 75;
      deg += 15
    ) {
      let norm = ((deg % 360) + 360) % 360,
        delta = ((deg - heading + 540) % 360) - 180;
      if (Math.abs(delta) > 72) continue;
      let x = center + (delta / 72) * half,
        major = norm % 30 === 0,
        card = norm % 90 === 0;
      oriCtx.strokeStyle = card
        ? 'rgba(255,178,74,.92)'
        : major
          ? 'rgba(244,234,216,.60)'
          : 'rgba(244,234,216,.28)';
      oriCtx.lineWidth = card ? 2 : 1;
      oriCtx.beginPath();
      oriCtx.moveTo(x, y + (major ? 2 : 7));
      oriCtx.lineTo(x, y + 14);
      oriCtx.stroke();
      if (major) {
        oriCtx.fillStyle = card ? '#ffcf89' : 'rgba(244,234,216,.78)';
        oriCtx.fillText(compassLabel(norm), x, y - 5);
      }
    }
    oriCtx.fillStyle = '#ffb24a';
    oriCtx.beginPath();
    oriCtx.moveTo(center, y + 17);
    oriCtx.lineTo(center - 5, y + 10);
    oriCtx.lineTo(center + 5, y + 10);
    oriCtx.closePath();
    oriCtx.fill();
    oriCtx.fillStyle = 'rgba(255,207,137,.92)';
    oriCtx.fillText(
      String(Math.round(heading)).padStart(3, '0') + '°',
      center,
      y + 29
    );
    let fov = scopeVisualActive(current(), aimFactor()) ? 0.23 : 1.05,
      ladderX = center - 48,
      pitchDeg = (player.pitch * 180) / Math.PI;
    oriCtx.font = '700 10px monospace';
    for (let a = -40; a <= 40; a += 5) {
      let rad = (a * Math.PI) / 180,
        diff = rad - player.pitch;
      if (Math.abs(diff) > fov * 0.48) continue;
      let sy = h / 2 - (diff / (fov / 2)) * (h / 2),
        major = a % 10 === 0,
        len = major ? 22 : 12;
      oriCtx.strokeStyle =
        a === 0 ? 'rgba(255,178,74,.88)' : 'rgba(244,234,216,.42)';
      oriCtx.lineWidth = a === 0 ? 1.8 : 1;
      oriCtx.beginPath();
      oriCtx.moveTo(ladderX - len, sy);
      oriCtx.lineTo(ladderX, sy);
      oriCtx.stroke();
      if (major) {
        oriCtx.fillStyle = a === 0 ? '#ffcf89' : 'rgba(244,234,216,.68)';
        oriCtx.textAlign = 'right';
        oriCtx.fillText((a > 0 ? '+' : '') + a + '°', ladderX - len - 4, sy);
      }
    }
    oriCtx.textAlign = 'left';
    oriCtx.fillStyle = 'rgba(255,207,137,.95)';
    oriCtx.font = '800 11px monospace';
    oriCtx.fillText(
      'EL ' + (pitchDeg >= 0 ? '+' : '') + pitchDeg.toFixed(1) + '°',
      center + 42,
      h / 2 - 28
    );
    oriCtx.restore();
  }
  // Neutral, low-contrast ground: no repetitive 18m checkerboard texture.
  // Ground markings are only visual. The playable area remains perfectly flat.
  const GROUND_COLOR = '#344139';
  function renderTrap(vp, t) {
    if (!t.active) return;
    let ground = GROUND_COLOR,
      metal = shadeColor(ground, 0.025),
      shadow = shadeColor(ground, -0.025);
    if (t.type === 'mine') {
      cube(vp, t.x, t.y + 0.055, t.z, 0.58, 0.11, 0.58, ground);
      cube(vp, t.x, t.y + 0.115, t.z, 0.34, 0.025, 0.34, metal);
    } else if (t.type === 'bear') {
      cube(vp, t.x, t.y + 0.035, t.z, 0.52, 0.06, 0.5, shadow);
      cube(vp, t.x - 0.27, t.y + 0.075, t.z, 0.4, 0.085, 0.6, ground);
      cube(vp, t.x + 0.27, t.y + 0.075, t.z, 0.4, 0.085, 0.6, metal);
    } else {
      let hx = Math.cos(t.angle) * 3,
        hz = Math.sin(t.angle) * 3,
        wireY = t.y + 0.16;
      cubeR(vp, t.x, wireY, t.z, 6, 0.022, 0.022, -t.angle, metal);
      cube(vp, t.x - hx, t.y + 0.1, t.z - hz, 0.035, 0.2, 0.035, shadow);
      cube(vp, t.x + hx, t.y + 0.1, t.z + hz, 0.035, 0.2, 0.035, shadow);
    }
  }
  function renderProjectileVisual(vp, p, drawFar) {
    let d = Math.hypot(p.x - player.x, p.z - player.z);
    if (d >= drawFar) return;
    if (p.visual === 'bolt') {
      cube(vp, p.x, p.y, p.z, 0.045, 0.045, 0.32, '#8d826b');
      return;
    }
    let headColor =
      p.visual === 'tracer'
        ? '#ffd47a'
        : p.visual === 'precision'
          ? '#efe5bf'
          : p.visual === 'rail'
            ? '#d9ffff'
            : p.visual === 'flame'
              ? '#ff8b55'
              : p.color;
    let hs =
      p.visual === 'tracer'
        ? 0.1
        : p.visual === 'precision'
          ? 0.075
          : p.visual === 'rail'
            ? 0.12
            : p.visual === 'flame'
              ? 0.1
              : 0.045;
    cube(
      vp,
      p.x,
      p.y,
      p.z,
      hs,
      hs,
      p.visual === 'rail' ? 0.28 : 0.16,
      headColor
    );
    if (!p.trail || p.trail.length < 2 || p.visual === 'bolt') return;
    let step = p.visual === 'faint' ? 2 : 1;
    for (let i = 0; i < p.trail.length - 1; i += step) {
      let q = p.trail[i],
        age = (i + 1) / p.trail.length,
        sz;
      if (p.visual === 'tracer') sz = 0.075 * age;
      else if (p.visual === 'precision') sz = 0.048 * age;
      else if (p.visual === 'rail') sz = 0.085 * age;
      else if (p.visual === 'flame') sz = 0.065 * age;
      else sz = 0.026 * age;
      cube(vp, q.x, q.y, q.z, sz, sz, sz * 2.1, headColor);
    }
  }
  function drawTerrain(vp, drawFar) {
    // Single continuous surface: a nearby tiled carpet is particularly distracting
    // when moving the camera. Keep small sparse, matte patches with no collision.
    cube(
      vp,
      player.x,
      -0.3,
      player.z,
      drawFar * 2.05,
      0.5,
      drawFar * 2.05,
      GROUND_COLOR
    );
    const cell = 52,
      cx = Math.floor(player.x / cell),
      cz = Math.floor(player.z / cell);
    const radius = Math.ceil(drawFar / cell) + 1;
    for (let ix = -radius; ix <= radius; ix++)
      for (let iz = -radius; iz <= radius; iz++) {
        const gx = cx + ix,
          gz = cz + iz;
        let n = Math.abs(Math.sin(gx * 19.113 + gz * 47.791));
        if (n < 0.69) continue;
        let x = (gx + 0.5) * cell + Math.sin(gx * 7.13 + gz * 4.71) * 13;
        let z = (gz + 0.5) * cell + Math.cos(gz * 9.37 + gx * 3.23) * 12;
        if (Math.hypot(x - player.x, z - player.z) > drawFar * 0.88) continue;
        let w = 3.5 + n * 7.5,
          d = 2.6 + n * 5.8;
        cube(vp, x, -0.028, z, w, 0.018, d, n > 0.92 ? '#3c4840' : '#39463d');
      }
  }
  function drawObstacle(vp, o) {
    cube(
      vp,
      o.x + 0.22,
      0.025,
      o.z + 0.22,
      o.w * 1.03,
      0.05,
      o.d * 1.03,
      '#18211e'
    );
    if (o.building) {
      cube(vp, o.x, o.h / 2, o.z, o.w, o.h, o.d, o.color);
      cube(
        vp,
        o.x,
        o.h + 0.14,
        o.z,
        o.w + 1,
        0.28,
        o.d + 1,
        shadeColor(o.color, -0.1)
      );
      let roofTop = o.h + ROOF_CAP_HEIGHT,
        roofW = o.w + 1,
        roofD = o.d + 1,
        roofEdge = shadeColor(o.color, 0.13);
      cube(
        vp,
        o.x,
        roofTop + 0.035,
        o.z - roofD / 2 + 0.055,
        roofW,
        0.07,
        0.11,
        roofEdge
      );
      cube(
        vp,
        o.x,
        roofTop + 0.035,
        o.z + roofD / 2 - 0.055,
        roofW,
        0.07,
        0.11,
        roofEdge
      );
      cube(
        vp,
        o.x - roofW / 2 + 0.055,
        roofTop + 0.035,
        o.z,
        0.11,
        0.07,
        roofD,
        roofEdge
      );
      cube(
        vp,
        o.x + roofW / 2 - 0.055,
        roofTop + 0.035,
        o.z,
        0.11,
        0.07,
        roofD,
        roofEdge
      );
      cube(
        vp,
        o.x,
        o.h * 0.38,
        o.z - o.d / 2 - 0.025,
        Math.min(1.45, o.w * 0.24),
        Math.min(2.35, o.h * 0.72),
        0.08,
        '#252a27'
      );
      let windowY = Math.min(o.h * 0.62, 2.15),
        windowColor = '#d6a24e';
      cube(
        vp,
        o.x - o.w * 0.28,
        windowY,
        o.z - o.d / 2 - 0.04,
        Math.min(1.35, o.w * 0.18),
        0.72,
        0.09,
        windowColor
      );
      cube(
        vp,
        o.x + o.w * 0.28,
        windowY,
        o.z - o.d / 2 - 0.04,
        Math.min(1.35, o.w * 0.18),
        0.72,
        0.09,
        '#27352f'
      );
      cube(
        vp,
        o.x - o.w / 2 + 0.16,
        o.h * 0.55,
        o.z,
        0.22,
        o.h * 0.92,
        o.d + 0.18,
        shadeColor(o.color, 0.05)
      );
      cube(
        vp,
        o.x + o.w / 2 - 0.16,
        o.h * 0.55,
        o.z,
        0.22,
        o.h * 0.92,
        o.d + 0.18,
        shadeColor(o.color, -0.06)
      );
    } else if (o.terrain === 'grove') {
      cube(
        vp,
        o.x,
        o.h * 0.34,
        o.z,
        Math.max(0.48, o.w * 0.16),
        o.h * 0.68,
        Math.max(0.48, o.d * 0.16),
        '#51463a'
      );
      cube(
        vp,
        o.x,
        o.h * 0.7,
        o.z,
        o.w * 0.92,
        o.h * 0.52,
        o.d * 0.92,
        o.color
      );
      cube(
        vp,
        o.x - o.w * 0.22,
        o.h * 0.86,
        o.z + o.d * 0.12,
        o.w * 0.55,
        o.h * 0.34,
        o.d * 0.55,
        shadeColor(o.color, 0.035)
      );
      // Crown facets remain inside the original collider's bounding box.
      cube(
        vp,
        o.x + o.w * 0.18,
        o.h * 0.77,
        o.z - o.d * 0.15,
        o.w * 0.46,
        o.h * 0.33,
        o.d * 0.47,
        shadeColor(o.color, 0.1)
      );
    } else if (o.terrain === 'hedge') {
      cube(vp, o.x, o.h * 0.47, o.z, o.w, o.h * 0.94, o.d, o.color);
      cube(
        vp,
        o.x,
        o.h * 0.83,
        o.z,
        o.w * 0.94,
        o.h * 0.29,
        o.d * 0.95,
        shadeColor(o.color, 0.09)
      );
    } else if (o.terrain === 'screen') {
      cube(vp, o.x, o.h * 0.46, o.z, o.w, o.h * 0.92, o.d, o.color);
      cube(
        vp,
        o.x,
        o.h * 0.82,
        o.z,
        o.w * 0.88,
        o.h * 0.34,
        o.d * 0.88,
        shadeColor(o.color, 0.045)
      );
      // Readable horizontal band distinguishes sight-blocking walls from terrain.
      if (o.w > o.d)
        cube(
          vp,
          o.x,
          o.h * 0.66,
          o.z + o.d * 0.5,
          o.w * 0.88,
          0.1,
          0.065,
          '#849083'
        );
      else
        cube(
          vp,
          o.x + o.w * 0.5,
          o.h * 0.66,
          o.z,
          0.065,
          0.1,
          o.d * 0.88,
          '#849083'
        );
    } else if (o.terrain === 'scatter') {
      cube(vp, o.x, o.h * 0.38, o.z, o.w, o.h * 0.76, o.d, o.color);
      cube(
        vp,
        o.x - o.w * 0.16,
        o.h * 0.77,
        o.z + o.d * 0.12,
        o.w * 0.62,
        o.h * 0.46,
        o.d * 0.64,
        shadeColor(o.color, 0.035)
      );
    } else {
      cube(vp, o.x, o.h / 2, o.z, o.w, o.h, o.d, o.color);
      if (o.cover)
        cube(vp, o.x, o.h * 0.73, o.z, o.w + 0.04, 0.09, o.d + 0.04, '#b1884e');
    }
  }
  function weaponFamily(g) {
    if (g.kind === 'melee') return 'knife';
    if (g.kind === 'utility') return g.utility;
    if (['p9', 'hush', 'hc12'].includes(g.id)) return 'pistol';
    if (g.id === 'r45') return 'revolver';
    if (g.id === 'm10') return 'machinepistol';
    if (['viper', 'mp7'].includes(g.id)) return 'smg';
    if (['ar4', 'akm', 'burst', 'carbine'].includes(g.id)) return 'rifle';
    if (g.id === 'dmr') return 'dmr';
    if (g.id === 'longshot') return 'sniper';
    if (g.id === 'rail') return 'rail';
    if (['sg8', 'auto12'].includes(g.id)) return 'shotgun';
    if (g.id === 'lmg') return 'lmg';
    if (g.id === 'crossbow') return 'crossbow';
    if (g.id === 'flame') return 'flame';
    return 'rifle';
  }
  function drawPickup(vp, p, time) {
    let g = G[p.wid],
      bob = Math.sin(time * 2.5 + p.x) * 0.05,
      y = (p.y || 0) + 0.24 + bob;
    cube(vp, p.x, 0.09, p.z, 1.3, 0.18, 1.05, '#202b27');
    cube(vp, p.x, y, p.z, 1.08, 0.38, 0.83, '#343b37');
    cube(vp, p.x, y + 0.22, p.z, 0.94, 0.08, 0.69, shadeColor(g.color, -0.12));
    cube(vp, p.x, y + 0.92, p.z, 0.045, 0.64, 0.045, '#ffcc79');
    cube(vp, p.x, y + 1.24, p.z, 0.13, 0.06, 0.13, '#fff0bd');
  }
  function projectToScreen(m, x, y, z) {
    let cx = m[0] * x + m[4] * y + m[8] * z + m[12],
      cy = m[1] * x + m[5] * y + m[9] * z + m[13],
      cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.03) return null;
    let nx = cx / cw,
      ny = cy / cw;
    if (nx < -1.18 || nx > 1.18 || ny < -1.18 || ny > 1.18) return null;
    return {
      x: (nx * 0.5 + 0.5) * viewportWidth,
      y: (1 - (ny * 0.5 + 0.5)) * viewportHeight
    };
  }
  function ensurePickupSprite(i) {
    let el = pickupSpriteEls[i];
    if (el) return el;
    el = document.createElement('div');
    el.className = 'pickupSprite';
    el.innerHTML = '<img alt="">';
    $('#pickupSprites').appendChild(el);
    pickupSpriteEls[i] = el;
    return el;
  }
  function updatePickupSprites(vp, drawFar) {
    for (let i = 0; i < pickups.length; i++) {
      let p = pickups[i],
        el = ensurePickupSprite(i),
        g = G[p.wid],
        d = Math.hypot(p.x - player.x, p.z - player.z),
        show =
          !p.taken &&
          d < drawFar &&
          clearShot3D(
            player.x,
            player.y + eyeHeight(),
            player.z,
            p.x,
            (p.y || 0) + 0.85,
            p.z
          ),
        screen = show ? projectToScreen(vp, p.x, (p.y || 0) + 0.92, p.z) : null;
      if (!screen) {
        el.classList.remove('visible', 'near');
        continue;
      }
      let img = el.firstElementChild;
      if (el.dataset.weapon !== g.id) {
        el.dataset.weapon = g.id;
        el.dataset.label = g.name;
        img.src = weaponSpriteUrl(g.id);
      }
      let h = clamp(850 / Math.max(1, d), 18, 88),
        w = h * 1.5;
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      el.style.transform =
        'translate(' + (screen.x - w / 2) + 'px,' + (screen.y - h / 2) + 'px)';
      el.style.opacity = clamp(1 - (d / drawFar) * 0.58, 0.42, 1);
      el.classList.add('visible');
      el.classList.toggle('near', d < 11);
    }
  }
  function syncWeaponSprite(g) {
    let layer = $('#viewWeapon'),
      img = $('#viewWeaponImage'),
      adsImg = $('#viewWeaponImageAds');
    if (!layer || !img || !g) return;
    let hasAds = hasDedicatedAdsSprite(g);
    if (lastWeaponSpriteId !== g.id) {
      lastWeaponSpriteId = g.id;
      img.src = weaponSpriteUrl(g.id);
      layer.dataset.family = weaponFamily(g);
      layer.classList.remove('empty');
      if (adsImg) {
        if (hasAds) {
          adsImg.src = weaponAdsSpriteUrl(g.id);
        } else {
          adsImg.removeAttribute('src');
          adsImg.style.opacity = '0';
        }
      }
    }
    layer.classList.toggle('has-ads', hasAds);
  }
  function drawTrainingTarget(vp, e) {
    let moving = e.motion === 'sweep',
      plate = moving ? '#d8a24f' : '#8eb69f',
      edge = moving ? '#6b4b25' : '#355b49';
    cube(vp, e.x, 0.04, e.z, 1.15, 0.08, 0.72, '#202724');
    cube(vp, e.x, 0.72, e.z, 0.09, 1.36, 0.09, '#4d5650');
    cube(vp, e.x, 1.03, e.z, 0.88, 1.02, 0.16, plate);
    cube(vp, e.x, 1.64, e.z, 0.42, 0.42, 0.18, plate);
    cube(vp, e.x, 1.03, e.z - 0.1, 0.62, 0.76, 0.05, edge);
    if (moving) cube(vp, e.x, 0.16, e.z, 1.6, 0.12, 0.36, '#6c5d43');
  }
  function drawEnemy(vp, e) {
    if (e.trainingTarget) {
      drawTrainingTarget(vp, e);
      return;
    }
    let fx = Math.sin(e.yaw),
      fz = -Math.cos(e.yaw),
      rx = Math.cos(e.yaw),
      rz = Math.sin(e.yaw),
      armor =
        e.id % 3 === 0 ? '#5f6b58' : e.id % 3 === 1 ? '#66554b' : '#4b5e58';
    cube(vp, e.x + 0.12, 0.025, e.z + 0.12, 0.78, 0.05, 0.62, '#161b1a');
    cube(
      vp,
      e.x - rx * 0.18,
      0.42,
      e.z - rz * 0.18,
      0.22,
      0.72,
      0.25,
      '#262c29'
    );
    cube(
      vp,
      e.x + rx * 0.18,
      0.42,
      e.z + rz * 0.18,
      0.22,
      0.72,
      0.25,
      '#262c29'
    );
    cubeR(vp, e.x, 0.98, e.z, 0.64, 0.82, 0.42, e.yaw, armor);
    cubeR(
      vp,
      e.x - fx * 0.23,
      1.02,
      e.z - fz * 0.23,
      0.5,
      0.62,
      0.22,
      e.yaw,
      '#303a35'
    );
    cube(
      vp,
      e.x - rx * 0.39,
      1.08,
      e.z - rz * 0.39,
      0.18,
      0.68,
      0.18,
      '#79614f'
    );
    cube(
      vp,
      e.x + rx * 0.39,
      1.08,
      e.z + rz * 0.39,
      0.18,
      0.68,
      0.18,
      '#79614f'
    );
    cube(vp, e.x, 1.57, e.z, 0.39, 0.39, 0.39, '#a57c60');
    cube(vp, e.x, 1.78, e.z, 0.48, 0.16, 0.48, '#303a35');
    cubeR(
      vp,
      e.x + fx * 0.43,
      1.05,
      e.z + fz * 0.43,
      0.12,
      0.12,
      0.72,
      e.yaw,
      '#252b29'
    );
  }
  function drawViewWeapon(time) {
    let layer = $('#viewWeapon'),
      img = $('#viewWeaponImage'),
      adsImg = $('#viewWeaponImageAds'),
      g = current();
    if (!layer || !img || !g) return;
    syncWeaponSprite(g);
    let aim = aimFactor(),
      scopeOn = scopeVisualActive(g, aim),
      hasAds = hasDedicatedAdsSprite(g);
    layer.classList.toggle('scoped', scopeOn);
    layer.classList.toggle('aiming', aim > 0.08);
    if (scopeOn) {
      if (adsImg) adsImg.style.opacity = '0';
      return;
    }
    let speed = player.mapSpeed || 0,
      sniper = g.id === 'longshot',
      walkX = 1 - aim,
      walkY = 1 - aim * 0.82,
      bobX = Math.sin(time * 7.5) * speed * (sniper ? 0.65 : 1.35) * walkX,
      bobY = Math.abs(Math.cos(time * 7.5)) * speed * 1.05 * walkY,
      kick = clamp(1 - (time - lastViewShotAt) / 0.13, 0, 1),
      reload = player.reloadTotal
        ? clamp(player.reloading / player.reloadTotal, 0, 1)
        : 0;
    let kickScale = lastViewKick || 1,
      aimShiftX = -viewportWidth * (g.adsViewShift || 0) * aim * 0.88,
      aimShiftY = -viewportHeight * (g.adsViewLift || 0) * aim * 0.82,
      tx =
        bobX -
        kick * (sniper ? 5 : 15) * kickScale * (1 - aim * 0.32) +
        aimShiftX,
      ty =
        bobY +
        kick * 17 * kickScale +
        (reload > 0 ? Math.sin((1 - reload) * Math.PI) * 55 : 0) +
        aimShiftY,
      rot =
        -kick * 3 * kickScale * (1 - aim * 0.82) +
        (reload > 0 ? Math.sin((1 - reload) * Math.PI) * 13 : 0) *
          (1 - aim * 0.55),
      baseScale = player.crouched ? 0.96 : 1,
      scale =
        baseScale *
        (1 - aim * 0.028 + ((g.adsViewScale || 1) - 1) * aim * 0.08);
    let baseOpacity = '1';
    // Keep the normal sprite until the current ADS image has loaded successfully.
    if (
      hasAds &&
      adsImg?.complete &&
      adsImg.naturalWidth > 0 &&
      adsImg.currentSrc === adsImg.src
    ) {
      let swapMix = clamp((aim - 0.08) / 0.18, 0, 1),
        adsMix = clamp((aim - 0.14) / 0.22, 0, 1),
        adsStill = 1 - adsMix * 0.92;
      let adsBobX = Math.sin(time * 7.5) * speed * 0.18 * adsStill,
        adsBobY =
          Math.abs(Math.cos(time * 7.5)) * speed * 0.3 * (1 - adsMix * 0.38);
      let adsKickX = -kick * 1.4 * kickScale * (1 - adsMix * 0.55),
        adsKickY =
          kick * 7.2 * kickScale +
          (reload > 0 ? Math.sin((1 - reload) * Math.PI) * 16 : 0),
        adsRot = rot * (1 - adsMix * 0.94),
        adsScale = 1 + (player.crouched ? -0.02 : 0);
      let adsTx = adsBobX + adsKickX,
        adsTy = adsBobY + adsKickY;
      if (adsMix > 0.32) {
        adsTx = Math.round(adsTx);
        adsTy = Math.round(adsTy * 2) / 2;
        adsRot = Math.round(adsRot * 10) / 10;
      }
      baseOpacity = (1 - swapMix).toFixed(3);
      adsImg.style.opacity = adsMix.toFixed(3);
      adsImg.style.transform =
        'translate3d(' +
        adsTx +
        'px,' +
        adsTy +
        'px,0) rotate(' +
        adsRot +
        'deg) scale(' +
        adsScale +
        ')';
    } else if (adsImg) {
      adsImg.style.opacity = '0';
      adsImg.style.transform = 'translate3d(0,0,0) rotate(0deg) scale(1)';
    }
    img.style.opacity = baseOpacity;
    img.style.transform =
      'translate3d(' +
      tx +
      'px,' +
      ty +
      'px,0) rotate(' +
      rot +
      'deg) scale(' +
      scale +
      ')';
  }
  function drawSettlementSignals(vp, drawFar, time) {
    for (const s of settlements) {
      if (Math.hypot(s.x - player.x, s.z - player.z) > drawFar) continue;
      cube(vp, s.x, 0.9, s.z, 0.14, 1.8, 0.14, '#6f5741');
      cube(vp, s.x, 1.86, s.z, 0.42, 0.12, 0.42, '#ffb24a');
      cube(
        vp,
        s.x,
        2.13,
        s.z,
        0.12,
        0.42,
        0.12,
        Math.sin(time * 4) > 0 ? '#ff6755' : '#6d302c'
      );
    }
  }
  function render() {
    if (!gl || !player) return;
    resize();
    let time = gameNow();
    gl.clearColor(0.36, 0.43, 0.41, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    let g = current(),
      aim = aimFactor(),
      ease = aim * aim * (3 - 2 * aim),
      scopeZoom = g.id === 'longshot' && player.aiming && aim > 0.05,
      drawFar = gameMode === 'training' ? 125 : scopeZoom ? SCOPE_FAR : FAR,
      fov = 1.05 + ((g.adsFov ?? 1.05) - 1.05) * ease;
    gl.uniform1f(fogFarLoc, drawFar);
    let pr = M.persp(fov, canvas.width / canvas.height, 0.08, drawFar),
      vi = M.view(
        player.x,
        player.y + eyeHeight(),
        player.z,
        player.yaw,
        player.pitch
      ),
      vp = M.mul(pr, vi);
    drawTerrain(vp, drawFar);
    for (const o of obstacles)
      if (Math.hypot(o.x - player.x, o.z - player.z) < drawFar + 12)
        drawObstacle(vp, o);
    drawSettlementSignals(vp, drawFar, time);
    for (const p of pickups)
      if (!p.taken && Math.hypot(p.x - player.x, p.z - player.z) < drawFar)
        drawPickup(vp, p, time);
    updatePickupSprites(vp, drawFar);
    for (const t of traps)
      if (Math.hypot(t.x - player.x, t.z - player.z) < drawFar)
        renderTrap(vp, t);
    for (const e of enemies)
      if (e.alive && Math.hypot(e.x - player.x, e.z - player.z) <= drawFar)
        drawEnemy(vp, e);
    for (const p of projectiles) renderProjectileVisual(vp, p, drawFar);
    if (player.grapple) {
      let g = player.grapple;
      for (let i = 1; i < 18; i++) {
        let q = i / 18;
        cube(
          vp,
          player.x + (g.tx - player.x) * q,
          player.y + 1.2 + (g.ty - player.y - 0.6) * q,
          player.z + (g.tz - player.z) * q,
          0.035,
          0.035,
          0.035,
          '#d4c29a'
        );
      }
    }
    let nearX = HALF - Math.abs(player.x),
      nearZ = HALF - Math.abs(player.z);
    if (nearX < drawFar) {
      let x = player.x > 0 ? HALF : -HALF;
      cube(vp, x, 4, player.z, 1, 8, drawFar * 2, '#7e2d29');
    }
    if (nearZ < drawFar) {
      let z = player.z > 0 ? HALF : -HALF;
      cube(vp, player.x, 4, z, drawFar * 2, 8, 1, '#7e2d29');
    }
    drawViewWeapon(time);
  }
  function loop(t) {
    let dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    update(dt, t / 1000);
    if (state !== 'resolving') {
      render();
      drawOrientationHUD();
    }
    requestAnimationFrame(loop);
  }

  // 一時停止・試合終了・連続試合
  function fullscreenRestoreNeeded() {
    return !!(
      inputSettings.fullscreen &&
      !document.fullscreenElement &&
      document.documentElement.requestFullscreen
    );
  }
  function updateResumeButton() {
    let b = $('#resumeBtn');
    if (!b) return;
    let back = gameMode === 'training' ? '訓練へ戻る' : '戦闘へ戻る';
    b.textContent = fullscreenRestoreNeeded()
      ? `フルスクリーンで${back}`
      : back;
  }
  function openPause() {
    if (state !== 'play') return;
    burstToken++;
    if (player) player.bursting = false;
    state = 'paused';
    pauseOpenedAt = performance.now();
    keys = {};
    mouseDown = false;
    edgeTurn = 0;
    resetTouchControls();
    clearAim(false);
    $('#pause').classList.remove('hidden');
    $('#mobileControls').classList.remove('gameOn');
    updateResumeButton();
    document.exitPointerLock?.();
  }
  function resumeGame() {
    if (state !== 'paused') return;
    if (fullscreenRestoreNeeded())
      try {
        let p = document.documentElement.requestFullscreen();
        p?.catch?.(() => {});
      } catch (e) {}
    state = 'play';
    $('#pause').classList.add('hidden');
    applyTouchUIVisibility();
    last = performance.now();
    canvas.focus();
    if (resolvedLookMode() === 'pointerlock' && lastInputType === 'mouse')
      msg('画面をクリックするとマウス視点を固定');
  }
  function retireGame() {
    if (state !== 'paused' && state !== 'play') return;
    if (gameMode === 'training') {
      leaveTraining();
      return;
    }
    let rank = 1 + enemies.filter((e) => e.alive).length;
    if (state === 'paused') state = 'play';
    $('#pause').classList.add('hidden');
    endGame('RETIRED', rank);
  }
  function beginFastResolution(reason, rank) {
    if (fastSimActive) return;
    fastSimActive = true;
    state = 'resolving';
    fastSimClock = performance.now() / 1000;
    const token = ++fastSimToken,
      startRemaining = Math.max(0, remaining),
      progress = document.querySelector('#resolutionProgress'),
      label = document.querySelector('#resolutionLabel'),
      panel = document.querySelector('#resolution');
    $('#pause').classList.add('hidden');
    $('#hud').classList.add('hidden');
    $('#mobileControls').classList.remove('gameOn');
    if (player) clearAim(true);
    document.exitPointerLock?.();
    mouseDown = false;
    keys = {};
    burstToken++;
    if (progress) progress.style.width = '0%';
    if (label) label.textContent = '0%';
    panel?.classList.remove('hidden');
    function finish() {
      fastSimActive = false;
      fastSimClock = null;
      panel?.classList.add('hidden');
      finalizeGame(reason, rank);
    }
    function batch() {
      if (token !== fastSimToken) return;
      const frameStart = performance.now();
      let count = 0;
      while (
        remaining > 0 &&
        enemies.filter((e) => e.alive).length > 1 &&
        count < 130 &&
        performance.now() - frameStart < 13
      ) {
        const dt = Math.min(0.05, remaining);
        remaining = Math.max(0, remaining - dt);
        fastSimClock += dt;
        LEARN?.setMatchElapsed(totalTime - remaining);
        updateEnemies(dt, fastSimClock);
        LEARN?.socialPulse(enemies, fastSimClock);
        updateProjectiles(dt);
        updateTraps(dt, fastSimClock);
        sampleTactics();
        // Keep the scheduled battlefield signals and exposure rules active after death.
        if (totalTime >= 600 && remaining <= 600) {
          const pulse = Math.floor((600 - remaining) / 60);
          if (pulse !== lastPulse) {
            lastPulse = pulse;
            broadcastSignalEvidence(fastSimClock, remaining <= 60);
          }
          if (remaining <= 60 && fastSimClock - lastNpcLiveSignalAt >= 0.5) {
            lastNpcLiveSignalAt = fastSimClock;
            broadcastSignalEvidence(fastSimClock, true);
          }
        }
        count++;
      }
      const pct =
        startRemaining <= 0
          ? 100
          : Math.min(
              100,
              Math.round(((startRemaining - remaining) / startRemaining) * 100)
            );
      if (progress) progress.style.width = pct + '%';
      if (label)
        label.textContent =
          pct +
          '% · 残りゲーム内 ' +
          Math.ceil(remaining) +
          '秒 · 生存者 ' +
          enemies.filter((e) => e.alive).length +
          '体';
      if (batchRun) updateBatchProgress();
      if (remaining <= 0 || enemies.filter((e) => e.alive).length <= 1) {
        finish();
        return;
      }
      setTimeout(batch, 0);
    }
    // Give the browser a rendering opportunity before CPU-intensive resolution begins.
    requestAnimationFrame(() => setTimeout(batch, 0));
  }
  async function finalizeGame(reason, rank) {
    MOVE_AUDIT?.finish(reason, [player, ...enemies]);
    LEARN?.finishMatch(
      reason,
      enemies,
      Math.max(0, totalTime - remaining),
      !!player?.alive
    );
    state = 'result';
    mouseDown = false;
    keys = {};
    if (player) clearAim(true);
    document.exitPointerLock?.();
    $('#pause').classList.add('hidden');
    $('#hud').classList.add('hidden');
    $('#mobileControls').classList.remove('gameOn');
    $('#result').classList.remove('hidden');
    rank = rank || 1 + enemies.filter((e) => e.alive).length;
    let won = reason === 'LAST SURVIVOR',
      retired = reason === 'RETIRED';
    $('#resultEyebrow').textContent = won
      ? 'MISSION COMPLETE'
      : retired
        ? 'MISSION ABORTED'
        : 'SIGNAL LOST';
    $('#resultTitle').innerHTML = won
      ? 'LAST <span>SIGNAL</span>'
      : retired
        ? 'RE<span>TIRED</span>'
        : 'GAME <span>OVER</span>';
    $('#resultRank').textContent = `#${rank}`;
    $('#resultSub').textContent =
      `排除 ${kills}　命中率 ${shots ? Math.round((hits / shots) * 100) : 0}%　生存 ${Math.floor(playerElapsedAtDeath / 60)}分${Math.floor(playerElapsedAtDeath % 60)}秒`;
    await window.LSSharedLearning?.publish();
    if (batchRun) completeBatchRound();
  }
  let playerElapsedAtDeath = 0;
  function endGame(reason, rank) {
    if (state !== 'play') return;
    if (gameMode === 'training') {
      leaveTraining();
      return;
    }
    playerElapsedAtDeath = Math.max(0, totalTime - remaining);

    if (
      reason === 'ELIMINATED' &&
      enemies.filter((e) => e.alive).length > 1 &&
      remaining > 0
    ) {
      beginFastResolution(reason, rank);
      return;
    }
    finalizeGame(reason, rank);
  }
  // A batch is only a sequence of normal survival matches, with a non-scoring fall exit.
  // It intentionally reuses newGame -> hurt(FALL) -> endGame -> fast resolution -> finishMatch.
  function completeBatchRound() {
    const job = batchRun;
    job.completed++;
    if (job.stopRequested || job.completed >= job.total) {
      batchRun = null;
      updateBatchProgress();
      $('#resultSub').textContent +=
        `　連続試合 ${job.completed}/${job.total} 完了`;
      $('#batchHint').textContent = `${job.completed}試合を完了しました。`;
    } else {
      setTimeout(() => runBatchRound(job), 80);
    }
  }

  function updateBatchProgress() {
    const text = $('#batchProgressText'),
      stop = $('#batchStopBtn');
    if (!batchRun) {
      text.classList.add('hidden');
      stop.classList.add('hidden');
      return;
    }
    text.classList.remove('hidden');
    stop.classList.remove('hidden');
    text.textContent =
      `連続試合 ${batchRun.completed + 1} / ${batchRun.total}` +
      (batchRun.stopRequested ? ' · この試合で停止' : '');
    stop.disabled = batchRun.stopRequested;
    stop.textContent = batchRun.stopRequested
      ? '停止予約済み'
      : '今回の試合後に停止';
  }
  function runBatchRound(job) {
    if (batchRun !== job || job.stopRequested) return;
    newGame();
    // Follow the same FALL damage/kill bookkeeping as a fatal high fall.
    // No AI is credited with the player's exit, and no player kill is recorded.
    hurt(player, 1000, { name: 'FALL' });
    if (state === 'play')
      endGame('ELIMINATED', 1 + enemies.filter((e) => e.alive).length);
    updateBatchProgress();
  }
  async function loadSharedBeforeStart(start) {
    const sync = window.LSSharedLearning;
    if (state !== 'menu' || batchRun || sync?.busy) return;
    if (sync) await sync.load();
    return start();
  }
  function startBatchRun() {
    if (
      batchRun ||
      fastSimActive ||
      state !== 'menu' ||
      $('#developerLab').classList.contains('hidden') ||
      $('#start').classList.contains('hidden')
    )
      return;
    const raw = Number($('#batchMatchCount').value);
    if (!Number.isInteger(raw) || raw < 1 || raw > 200) {
      $('#batchHint').textContent = '1～200の整数を指定してください。';
      return;
    }
    if (!gl && !initGL()) return;
    batchRun = { total: raw, completed: 0, stopRequested: false };
    $('#batchHint').textContent = `${raw}試合を実行しています。`;
    $('#developerLab').classList.add('hidden');
    runBatchRound(batchRun);
  }
  // The research controls are accessible only from the title screen, never from in-game settings.
  function openDeveloperLab() {
    if (
      state !== 'menu' ||
      window.LSSharedLearning?.busy ||
      batchRun ||
      fastSimActive ||
      $('#start').classList.contains('hidden')
    )
      return;
    $('#developerLab').classList.remove('hidden');
  }
  function closeDeveloperLab() {
    $('#developerLab').classList.add('hidden');
  }
  document.addEventListener('lastsignal:open-developer-lab', openDeveloperLab);
  $('#closeDeveloperLab').onclick = closeDeveloperLab;
  $('#batchStartBtn').onclick = () => loadSharedBeforeStart(startBatchRun);
  $('#batchStopBtn').onclick = () => {
    if (!batchRun) return;
    batchRun.stopRequested = true;
    updateBatchProgress();
  };

  // キーボード・マウス・タッチ入力
  addEventListener('keydown', (e) => {
    if (state === 'play') lockTouchAimAssistForMatch();
    if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    if (state === 'play') {
      if (gameMode === 'training') {
        if (e.code === 'BracketLeft' && !e.repeat) {
          cycleTrainingWeapon(-1);
          return;
        }
        if (e.code === 'BracketRight' && !e.repeat) {
          cycleTrainingWeapon(1);
          return;
        }
        if (e.code === 'KeyT' && !e.repeat) {
          resetTrainingTargets(true);
          return;
        }
      }
      if (e.code === 'Escape') {
        openPause();
        return;
      }
      if (e.code === 'Space' && !e.repeat) jump();
      if (e.code === 'KeyR') reload();
      if (e.code === 'KeyE') {
        if (actionType === 'rope') useRope();
        else pickup();
      }
      if (e.code === 'Digit1') swap(0);
      if (e.code === 'Digit2') swap(1);
      if (e.code === 'Digit3') swap(2);
      if (e.code === 'KeyF' || e.code === 'KeyQ')
        swap(player.slot === 1 ? 2 : 1);
      if (e.code === 'Tab') {
        burstToken++;
        player.bursting = false;
        state = 'arsenal';
        clearAim(false);
        $('#arsenal').classList.remove('hidden');
        document.exitPointerLock?.();
      }
    } else if (
      state === 'paused' &&
      e.code === 'Escape' &&
      performance.now() - pauseOpenedAt > 180
    )
      resumeGame();
    else if (state === 'arsenal' && (e.code === 'Tab' || e.code === 'Escape'))
      closeArsenal();
  });
  addEventListener('keyup', (e) => (keys[e.code] = false));
  function applyMouseLook(dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !player) return;
    dx = clamp(dx, -160, 160);
    dy = clamp(dy, -160, 160);
    let scopeSense = aimLookFactor(),
      sx = (inputSettings.sensX || 100) / 100,
      sy = (inputSettings.sensY || 100) / 100,
      iy = inputSettings.invertY ? -1 : 1;
    player.yaw += dx * 0.0024 * sx * scopeSense;
    player.pitch = clamp(
      player.pitch - dy * 0.0019 * sy * scopeSense * iy,
      -1.15,
      1.15
    );
  }
  function updateEdgeTurnFromPointer(e) {
    if (resolvedLookMode() !== 'pointerevents' || !inputSettings.edgeAssist) {
      edgeTurn = 0;
      return;
    }
    let r = canvas.getBoundingClientRect(),
      x = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1),
      start = clamp((inputSettings.edgeStart || 92) / 100, 0.8, 0.97),
      zone = Math.max(0.01, 1 - start);
    if (x > start) {
      let p = clamp((x - start) / zone, 0, 1);
      edgeTurn = p * p;
    } else if (x < zone) {
      let p = clamp((zone - x) / zone, 0, 1);
      edgeTurn = -p * p;
    } else edgeTurn = 0;
  }
  function applyEdgeAssist(dt) {
    if (
      !player ||
      resolvedLookMode() !== 'pointerevents' ||
      !inputSettings.edgeAssist ||
      document.pointerLockElement === canvas
    ) {
      edgeTurn = 0;
      return;
    }
    if (Math.abs(edgeTurn) < 0.001) return;
    let scopeSense = aimLookFactor(),
      speed = 3.2 * ((inputSettings.edgeSpeed || 100) / 100);
    player.yaw += edgeTurn * speed * dt * scopeSense;
  }
  function requestMouseLook() {
    if (
      state !== 'play' ||
      resolvedLookMode() !== 'pointerlock' ||
      document.pointerLockElement === canvas
    )
      return true;
    lastInputType = 'mouse';
    if (!canvas.requestPointerLock) return false;
    try {
      let p = canvas.requestPointerLock();
      p?.catch?.(() =>
        msg(
          'Pointer Lockを取得できません。操作設定で Pointer Events を試してください'
        )
      );
      return true;
    } catch {
      msg('Pointer Lockを取得できません。操作設定を確認してください');
      return false;
    }
  }
  canvas.addEventListener('mousedown', (e) => {
    if (state !== 'play') return;
    let mode = resolvedLookMode();
    lastInputType = 'mouse';
    updateInputTest('mouse', 'mousedown', 0, 0);
    if (mode === 'touch') return;
    if (e.button === 2) {
      e.preventDefault();
      rightMousePhysicalDown = true;
      if (mode === 'pointerlock' && document.pointerLockElement !== canvas)
        requestMouseLook();
      return;
    }
    if (mode === 'pointerlock' && document.pointerLockElement !== canvas) {
      requestMouseLook();
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    mouseDown = true;
    tryFire();
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseDown = false;
    if (e.button === 2) {
      let wasDown = rightMousePhysicalDown;
      rightMousePhysicalDown = false;
      if (!wasDown || state !== 'play') return;
      let now = performance.now();
      if (now - lastRightMouseToggleAt < 180) return;
      lastRightMouseToggleAt = now;
      toggleAim();
    }
  });
  addEventListener('mousemove', (e) => {
    if (
      state !== 'play' ||
      resolvedLookMode() !== 'pointerlock' ||
      document.pointerLockElement !== canvas
    )
      return;
    if (ignoreLockedMoves > 0) {
      ignoreLockedMoves--;
      return;
    }
    let dx = Number.isFinite(e.movementX)
        ? e.movementX
        : e.mozMovementX || e.webkitMovementX || 0,
      dy = Number.isFinite(e.movementY)
        ? e.movementY
        : e.mozMovementY || e.webkitMovementY || 0;
    updateInputTest('mouse', 'mousemove', dx, dy);
    applyMouseLook(dx, dy);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    let mode = resolvedLookMode();
    if (mode !== 'pointerevents') {
      pointerEventMouseX = e.clientX;
      pointerEventMouseY = e.clientY;
      return;
    }
    let dx =
        Number.isFinite(e.movementX) && Math.abs(e.movementX) < 500
          ? e.movementX
          : NaN,
      dy =
        Number.isFinite(e.movementY) && Math.abs(e.movementY) < 500
          ? e.movementY
          : NaN;
    if (!Number.isFinite(dx) || (!dx && pointerEventMouseX !== null))
      dx = e.clientX - (pointerEventMouseX ?? e.clientX);
    if (!Number.isFinite(dy) || (!dy && pointerEventMouseY !== null))
      dy = e.clientY - (pointerEventMouseY ?? e.clientY);
    pointerEventMouseX = e.clientX;
    pointerEventMouseY = e.clientY;
    updateEdgeTurnFromPointer(e);
    updateInputTest('mouse', 'pointermove', dx || 0, dy || 0);
    if (state === 'play' && document.pointerLockElement !== canvas)
      applyMouseLook(dx || 0, dy || 0);
  });
  canvas.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse') {
      pointerEventMouseX = e.clientX;
      pointerEventMouseY = e.clientY;
      updateEdgeTurnFromPointer(e);
    }
  });
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') {
      pointerEventMouseX = null;
      pointerEventMouseY = null;
      edgeTurn = 0;
    }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (state === 'play') cycleSwap(e.deltaY > 0 ? 1 : -1);
    },
    { passive: true }
  );
  document.addEventListener('pointerlockchange', () => {
    updateInputTest('mouse', 'pointerlockchange', 0, 0);
    if (document.pointerLockElement === canvas) {
      ignoreLockedMoves = 1;
      return;
    }
    if (
      state === 'play' &&
      resolvedLookMode() === 'pointerlock' &&
      lastInputType === 'mouse'
    )
      msg('画面をクリックするとマウス視点を再固定');
  });
  document.addEventListener('pointerlockerror', () => {
    if (state === 'play' && resolvedLookMode() === 'pointerlock')
      msg('Pointer Lock不可：⚙ 操作設定で Pointer Events を選択できます');
  });
  function fillSettingsForm() {
    $('#lookModeSelect').value = inputSettings.lookMode;
    $('#touchUiSelect').value = inputSettings.touchUI;
    $('#touchAdsTracking').checked = !!inputSettings.touchAdsTracking;
    $('#sensX').value = inputSettings.sensX;
    $('#sensY').value = inputSettings.sensY;
    $('#edgeAssist').checked = !!inputSettings.edgeAssist;
    $('#edgeStart').value = inputSettings.edgeStart;
    $('#edgeSpeed').value = inputSettings.edgeSpeed;
    $('#invertY').checked = !!inputSettings.invertY;
    $('#fullscreenEnabled').checked = !!inputSettings.fullscreen;
    updateSettingsPreview();
  }
  function updateSettingsPreview() {
    let sx = +$('#sensX').value || 100,
      sy = +$('#sensY').value || 100,
      es = +$('#edgeStart').value || 92,
      ev = +$('#edgeSpeed').value || 100;
    $('#sensXValue').textContent = sx + '%';
    $('#sensYValue').textContent = sy + '%';
    $('#edgeStartValue').textContent = es + '%';
    $('#edgeSpeedValue').textContent = ev + '%';
    let raw = $('#lookModeSelect').value,
      old = inputSettings.lookMode;
    inputSettings.lookMode = raw;
    let resolved = resolvedLookMode();
    inputSettings.lookMode = old;
    $('#resolvedModeText').textContent =
      `現在の自動判定: ${resolved === 'pointerlock' ? 'PCマウス / Pointer Lock' : resolved === 'pointerevents' ? 'Android外付けマウス / Pointer Events' : 'タッチ操作'} | Android: ${isAndroid() ? 'YES' : 'NO'} | Touch points: ${navigator.maxTouchPoints || 0}`;
    $('#testMode').textContent = resolved.toUpperCase();
  }
  function openSettings(from) {
    settingsReturnState = from || state;
    edgeTurn = 0;
    if (state === 'play') {
      burstToken++;
      if (player) player.bursting = false;
      state = 'paused';
      keys = {};
      mouseDown = false;
      clearAim(false);
      $('#mobileControls').classList.remove('gameOn');
      document.exitPointerLock?.();
    }
    $('#pause').classList.add('hidden');
    $('#settings').classList.remove('hidden');
    testPointerX = null;
    testPointerY = null;
    fillSettingsForm();
    updateInputTest(lastInputType, 'settings', 0, 0);
  }
  function closeSettings() {
    if ($('#settings').classList.contains('hidden')) return;
    $('#settings').classList.add('hidden');
    if (settingsReturnState === 'play' || settingsReturnState === 'paused') {
      state = 'paused';
      $('#pause').classList.remove('hidden');
    } else {
      state = 'menu';
      $('#start').classList.remove('hidden');
    }
  }
  function closeArsenal() {
    state = 'play';
    $('#arsenal').classList.add('hidden');
    applyTouchUIVisibility();
    if (resolvedLookMode() === 'pointerlock' && lastInputType === 'mouse')
      msg('画面をクリックするとマウス視点を固定');
  }
  $('#closeArsenal').onclick = closeArsenal;
  $('#resumeBtn').onclick = resumeGame;
  $('#retireBtn').onclick = retireGame;
  $('#startBtn').onclick = () =>
    loadSharedBeforeStart(() => {
      if (!gl && !initGL()) return;
      newGame();
    });
  $('#trainingBtn').onclick = () => {
    if (window.LSSharedLearning?.busy) return;
    if (!gl && !initGL()) return;
    startTraining();
  };
  $('#trainingWeaponSelect').onchange = (e) =>
    setTrainingWeapon(e.target.value);
  $('#trainingPrev').onclick = () => cycleTrainingWeapon(-1);
  $('#trainingNext').onclick = () => cycleTrainingWeapon(1);
  $('#trainingReset').onclick = () => resetTrainingTargets(true);
  $('#restartBtn').onclick = () => {
    if (batchRun || window.LSSharedLearning?.busy) return;
    $('#result').classList.add('hidden');
    $('#start').classList.remove('hidden');
    state = 'menu';
  };
  $('#openSettingsStart').onclick = () => openSettings('menu');
  $('#openSettingsPause').onclick = () => openSettings('paused');
  $('#closeSettings').onclick = closeSettings;
  [
    'lookModeSelect',
    'touchUiSelect',
    'touchAdsTracking',
    'sensX',
    'sensY',
    'edgeAssist',
    'edgeStart',
    'edgeSpeed',
    'invertY',
    'fullscreenEnabled'
  ].forEach((id) =>
    $('#' + id).addEventListener('input', updateSettingsPreview)
  );
  $('#saveSettings').onclick = () => {
    inputSettings = {
      lookMode: $('#lookModeSelect').value,
      touchUI: $('#touchUiSelect').value,
      touchAdsTracking: $('#touchAdsTracking').checked,
      sensX: +$('#sensX').value,
      sensY: +$('#sensY').value,
      edgeAssist: $('#edgeAssist').checked,
      edgeStart: +$('#edgeStart').value,
      edgeSpeed: +$('#edgeSpeed').value,
      invertY: $('#invertY').checked,
      fullscreen: $('#fullscreenEnabled').checked
    };
    edgeTurn = 0;
    saveInputSettings();
    applyTouchUIVisibility();
    $('#settingsStatus').textContent =
      '保存しました。この端末では次回も同じ設定を使います。';
    updateSettingsPreview();
  };
  $('#resetSettings').onclick = () => {
    inputSettings = { ...defaultInputSettings };
    saveInputSettings();
    fillSettingsForm();
    applyTouchUIVisibility();
    $('#settingsStatus').textContent = '初期値に戻しました。';
  };
  const stick = $('#stick'),
    knob = $('#knob'),
    fireButton = $('#touchFire');
  let sid = null,
    lookId = null,
    fireId = null;
  function resetStick(e) {
    if (e && sid !== null && e.pointerId !== sid) return;
    sid = null;
    touchMove = { x: 0, y: 0 };
    knob.style.transform = '';
  }
  function stickMove(e) {
    let r = stick.getBoundingClientRect(),
      rawX = e.clientX - (r.left + r.width / 2),
      rawY = e.clientY - (r.top + r.height / 2),
      l = Math.hypot(rawX, rawY),
      max = 43,
      dead = 7,
      x = rawX,
      y = rawY;
    if (l > max) {
      x = (x / l) * max;
      y = (y / l) * max;
    }
    knob.style.transform = `translate(${x}px,${y}px)`;
    if (l <= dead) {
      touchMove = { x: 0, y: 0 };
    } else {
      let power = Math.min(1, (l - dead) / (max - dead));
      touchMove = { x: (rawX / l) * power, y: (rawY / l) * power };
    }
  }
  stick.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || sid !== null) return;
    e.preventDefault();
    sid = e.pointerId;
    stick.setPointerCapture(sid);
    stickMove(e);
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId === sid) stickMove(e);
  });
  stick.addEventListener('pointerup', resetStick);
  stick.addEventListener('pointercancel', resetStick);
  stick.addEventListener('lostpointercapture', resetStick);
  function endLook(e) {
    if (e.pointerId === lookId) lookId = null;
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || state !== 'play') return;
    e.preventDefault();
    if (lookId !== null) {
      if (canvas.hasPointerCapture?.(lookId)) return;
      lookId = null;
    }
    lookId = e.pointerId;
    lastTouchX = e.clientX;
    lastTouchY = e.clientY;
    canvas.setPointerCapture(lookId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === lookId && state === 'play') {
      let sense = aimLookFactor();
      player.yaw += (e.clientX - lastTouchX) * 0.005 * sense;
      player.pitch = clamp(
        player.pitch - (e.clientY - lastTouchY) * 0.004 * sense,
        -1.15,
        1.15
      );
      lastTouchX = e.clientX;
      lastTouchY = e.clientY;
    }
  });
  canvas.addEventListener('pointerup', endLook);
  canvas.addEventListener('pointercancel', endLook);
  canvas.addEventListener('lostpointercapture', endLook);
  function endFire(e) {
    if (e && fireId !== null && e.pointerId !== fireId) return;
    fireId = null;
    mouseDown = false;
  }
  fireButton.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || fireId !== null) return;
    e.preventDefault();
    fireId = e.pointerId;
    fireButton.setPointerCapture(fireId);
    mouseDown = true;
    tryFire();
  });
  fireButton.addEventListener('pointerup', endFire);
  fireButton.addEventListener('pointercancel', endFire);
  fireButton.addEventListener('lostpointercapture', endFire);
  function bindTouchActionButton(selector, action) {
    let el = $(selector);
    if (!el) return;
    el.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType !== 'touch' || state !== 'play') return;
        e.preventDefault();
        e.stopPropagation();
        action();
      },
      { passive: false }
    );
  }
  bindTouchActionButton('#touchCrouch', toggleTouchCrouch);
  bindTouchActionButton('#touchJump', jump);
  bindTouchActionButton('#touchReload', reload);
  bindTouchActionButton('#touchSwap', () => cycleSwap(1));
  bindTouchActionButton('#touchScope', () => toggleAim());
  bindTouchActionButton('#touchAssistToggle', toggleTemporaryAssist);
  $('#touchAction').onclick = () => {
    if (state !== 'play') return;
    if (actionType === 'pickup') pickup();
    else if (actionType === 'rope') useRope();
  };
  $('#touchMenu').onclick = openPause;
  function resetTouchControls() {
    touchCrouch = false;
    updateTouchCrouchButton();
    resetStick();
    lookId = null;
    fireId = null;
    mouseDown = false;
    rightMousePhysicalDown = false;
    ignoreLockedMoves = 0;
    pointerEventMouseX = null;
    pointerEventMouseY = null;
    edgeTurn = 0;
    actionType = '';
    actionLabel = '';
    updateActionButton();
  }
  document.addEventListener(
    'click',
    (e) => {
      if (e.target.closest('button,.weaponCard')) window.LSAudio?.ui();
    },
    { passive: true }
  );
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'play') openPause();
  });
  document.addEventListener('fullscreenchange', () => {
    if (state === 'paused') updateResumeButton();
  });
  addEventListener('blur', resetTouchControls);
  requestAnimationFrame(loop);
  const modelContext = document.modelContext;
  if (modelContext?.registerTool) {
    const ctl = new AbortController();
    Promise.resolve(
      modelContext.registerTool(
        {
          name: 'start_survival_match',
          title: 'サバイバルマッチを開始',
          description:
            '開始時の拳銃または副装備一つを設定し、主武器は現地調達で新しいオフラインマッチを開始する。',
          inputSchema: {
            type: 'object',
            properties: {
              secondary: {
                type: 'string',
                enum: [
                  ...weapons.filter((w) => w.kind === 'sidearm'),
                  ...utilities
                ].map((g) => g.id)
              },
              durationSeconds: { type: 'integer', enum: [180, 600, 900, 1200] }
            },
            required: ['secondary', 'durationSeconds'],
            additionalProperties: false
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input) {
            return loadSharedBeforeStart(() => {
              let secondary = G[input.secondary];
              if (
                !secondary ||
                !['sidearm', 'utility'].includes(secondary.kind) ||
                ![180, 600, 900, 1200].includes(input.durationSeconds)
              )
                throw new Error('開始装備または制限時間が無効です');
              $('#sidearmSelect').value = input.secondary;
              $('#durationSelect').value = String(input.durationSeconds);
              if (!gl && !initGL()) throw new Error('WebGLを利用できません');
              newGame();
              return {
                status: 'started',
                primary: 'field_acquisition',
                secondary: input.secondary,
                durationSeconds: input.durationSeconds
              };
            });
          }
        },
        { signal: ctl.signal }
      )
    ).catch(() => {});
    Promise.resolve(
      modelContext.registerTool(
        {
          name: 'read_survival_match',
          title: 'マッチ状況を確認',
          description:
            '現在のマッチの残り時間、生存者数、体力、装備、高度を読み取る。',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
          },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute() {
            return {
              status: state,
              remainingSeconds: Math.max(0, Math.ceil(remaining)),
              survivors: player
                ? 1 + enemies.filter((e) => e.alive).length
                : null,
              health: player ? Math.ceil(player.hp) : null,
              equipped: player ? current().id : null,
              primary: player?.slots?.[1] || null,
              secondary: player?.slots?.[2] || null,
              altitude: player ? Number(player.y.toFixed(1)) : null,
              aiming: player?.aiming || false,
              aimProgress: player
                ? Number((player.aimBlend || 0).toFixed(2))
                : 0,
              scoped: !!(player?.aiming && current().id === 'longshot'),
              ropeCooldown: player ? Number(player.ropeCd.toFixed(1)) : null,
              traps: player?.trapCounts || null,
              kills
            };
          }
        },
        { signal: ctl.signal }
      )
    ).catch(() => {});
  }
})();

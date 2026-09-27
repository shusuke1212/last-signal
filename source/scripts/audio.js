/* Procedural Web Audio soundscape. No downloaded audio assets are required. */
window.LSAudio = (() => {
  let ctx, master, ambience, noiseBuffer;

  const ensure = () => {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = .32;
    master.connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  };

  const tone = (frequency, duration, volume = .1, type = 'sine', slide = 1) => {
    if (!ensure()) return;
    const now = ctx.currentTime, osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(24, frequency * slide), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    osc.connect(gain).connect(master);
    osc.start(now); osc.stop(now + duration);
  };

  const noise = (duration, volume = .1, cutoff = 1800) => {
    if (!ensure()) return;
    const now = ctx.currentTime, src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = noiseBuffer;
    filter.type = 'lowpass'; filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    src.connect(filter).connect(gain).connect(master);
    src.start(now); src.stop(now + duration);
  };

  const shot = weapon => {
    ensure();
    if (!weapon || weapon.kind === 'melee') { noise(.09, .08, 900); tone(180, .08, .035, 'triangle', .55); return; }
    if (weapon.id === 'crossbow') { noise(.08, .04, 1600); tone(310, .12, .035, 'triangle', .45); return; }
    if (weapon.id === 'flame') { noise(.16, .11, 2400); return; }
    if (weapon.id === 'rail') { tone(1300, .18, .09, 'sawtooth', .18); tone(90, .28, .1, 'sine', .45); return; }
    const profiles = {
      p9:[.11,.09,2300,148,.15,.065], r45:[.18,.14,1450,102,.22,.095], m10:[.075,.075,2700,188,.095,.052],
      hush:[.065,.042,1050,128,.10,.034], hc12:[.21,.17,1200,82,.28,.125],
      viper:[.075,.082,2550,180,.10,.052], mp7:[.072,.078,2850,205,.09,.048],
      ar4:[.12,.115,2050,132,.16,.075], akm:[.18,.155,1450,96,.23,.11], burst:[.095,.10,2350,158,.12,.064], carbine:[.095,.095,2550,175,.12,.058],
      dmr:[.18,.15,1500,105,.23,.105], longshot:[.24,.18,1050,72,.32,.135],
      sg8:[.22,.18,1150,78,.28,.135], auto12:[.15,.145,1350,92,.20,.105], lmg:[.17,.155,1250,88,.24,.115]
    };
    const p = profiles[weapon.id] || [.12,.11,1900,125,.17,.075];
    noise(p[0], p[1], p[2]);
    tone(p[3], p[4], p[5], 'square', .46);
  };

  const ambient = () => {
    if (!ensure() || ambience) return;
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = noiseBuffer; src.loop = true;
    filter.type = 'lowpass'; filter.frequency.value = 420;
    gain.gain.value = .018;
    src.connect(filter).connect(gain).connect(master);
    src.start(); ambience = { src, gain };
  };

  return {
    ensure, ambient, shot,
    reload: () => { tone(280, .08, .035, 'square', .72); setTimeout(() => tone(420, .07, .03, 'square', .8), 90); },
    pickup: () => { tone(420, .08, .045, 'sine', 1.35); setTimeout(() => tone(640, .12, .035, 'sine', 1.15), 70); },
    hit: () => tone(880, .055, .028, 'square', .62),
    hurt: () => { noise(.18, .09, 600); tone(68, .3, .08, 'sine', .7); },
    alert: () => { tone(520, .11, .04, 'square', 1); setTimeout(() => tone(420, .15, .035, 'square', 1), 130); },
    ui: () => tone(360, .045, .018, 'square', 1.12),
    setVolume: value => { ensure(); if (master) master.gain.value = Math.max(0, Math.min(1, value)); }
  };
})();

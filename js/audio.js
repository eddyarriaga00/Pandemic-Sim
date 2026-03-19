// audio.js — Procedural ambient music + sound effects
// built with Web Audio API so no sound files needed
// took me a while to get the reverb feeling right lol

const AudioEngine = (() => {
  let ctx          = null;
  let masterGain   = null;
  let musicGain    = null;
  let sfxGain      = null;
  let musicRunning = false;
  let muted        = false;
  let drones       = [];
  let hauntTimer   = null;

  // pull from localStorage so the setting persists between sessions
  const MUTE_KEY = 'pathogen_muted';

  function init() {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn('Web Audio API not supported in this browser');
      return false;
    }

    masterGain = ctx.createGain();
    masterGain.gain.value = 0.55;
    masterGain.connect(ctx.destination);

    musicGain = ctx.createGain();
    musicGain.gain.value = 0.45;
    musicGain.connect(masterGain);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.9;
    sfxGain.connect(masterGain);

    // restore mute preference
    muted = localStorage.getItem(MUTE_KEY) === 'true';
    if (muted) masterGain.gain.value = 0;

    return true;
  }

  function ensureCtx() {
    if (!ctx) init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // ─── BACKGROUND MUSIC ─────────────────────────
  // dark ambient drone — three layered oscillators + filtered noise
  // + haunting high notes that play randomly

  function startMusic() {
    if (musicRunning) return;
    ensureCtx();
    if (!ctx) return;
    musicRunning = true;
    // On desktop, AudioContext may be suspended — resume first
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => _startDrones());
      return;
    }
    _startDrones();
  }

  function _startDrones() {
    if (!musicRunning || !ctx) return;
    // low fundamental drone
    addDrone(55,   0.18, 'sine',     0.06);
    addDrone(82.4, 0.09, 'sine',     0.04);
    addDrone(110,  0.05, 'triangle', 0.08);

    // gritty sub texture
    addFilteredNoise();

    // haunting melody notes (eerie minor scale)
    scheduleHaunting();
  }

  function stopMusic() {
    musicRunning = false;
    if (hauntTimer) { clearTimeout(hauntTimer); hauntTimer = null; }
    drones.forEach(({ osc, lfo, gain }) => {
      try {
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.8);
        osc.stop(ctx.currentTime + 2);
        lfo.stop(ctx.currentTime + 2);
      } catch (_) {}
    });
    drones = [];
  }

  function addDrone(freq, amp, type, lfoDepth) {
    if (!ctx) return;

    const lfo     = ctx.createOscillator();
    lfo.type      = 'sine';
    lfo.frequency.value = 0.07 + Math.random() * 0.05;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = freq * lfoDepth;
    lfo.connect(lfoGain);

    const osc   = ctx.createOscillator();
    osc.type    = type;
    osc.frequency.value = freq;
    lfoGain.connect(osc.frequency); // LFO modulates pitch slightly

    const filter = ctx.createBiquadFilter();
    filter.type  = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 0.4;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(amp, ctx.currentTime + 4);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(musicGain);

    osc.start();
    lfo.start();
    drones.push({ osc, lfo, gain });
  }

  function addFilteredNoise() {
    if (!ctx) return;
    const sr  = ctx.sampleRate;
    const buf = ctx.createBuffer(1, sr * 3, sr);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop   = true;

    const bp = ctx.createBiquadFilter();
    bp.type  = 'bandpass';
    bp.frequency.value = 100;
    bp.Q.value = 0.6;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 5);

    src.connect(bp);
    bp.connect(gain);
    gain.connect(musicGain);
    src.start();
  }

  // minor pentatonic — sounds eerie and unsettling
  const SCALE = [110, 130.8, 146.8, 164.8, 196, 220, 246.9, 261.6];

  function scheduleHaunting() {
    if (!musicRunning) return;

    function playNote() {
      if (!musicRunning || !ctx) return;

      const freq = SCALE[Math.floor(Math.random() * SCALE.length)];
      const osc  = ctx.createOscillator();
      osc.type   = 'sine';
      osc.frequency.value = freq;

      const rev  = makeReverb(1.8);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.07, ctx.currentTime + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.8);

      osc.connect(gain);
      gain.connect(rev);
      rev.connect(musicGain);

      osc.start();
      osc.stop(ctx.currentTime + 3);

      hauntTimer = setTimeout(playNote, 4500 + Math.random() * 9000);
    }

    hauntTimer = setTimeout(playNote, 3000);
  }

  // simple convolution reverb — makes notes sound distant and ghostly
  function makeReverb(duration) {
    const conv = ctx.createConvolver();
    const len  = Math.floor(ctx.sampleRate * duration);
    const buf  = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
      }
    }
    conv.buffer = buf;
    return conv;
  }

  // ─── SOUND EFFECTS ────────────────────────────

  function tone(freq, dur, amp, type = 'sine', delay = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + delay;

    const osc  = ctx.createOscillator();
    osc.type   = type;
    osc.frequency.value = freq;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(amp, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // called whenever a new country gets infected
  function sfxNewCountry() {
    ensureCtx();
    tone(60,  0.55, 0.28, 'sine');
    tone(90,  0.40, 0.14, 'triangle', 0.1);
    tone(180, 0.30, 0.09, 'sine', 0.22);
  }

  // subtle tick for each DNA point earned
  function sfxDNA() {
    ensureCtx();
    tone(1047, 0.15, 0.18, 'sine');
    tone(1319, 0.20, 0.12, 'sine', 0.09);
  }

  // warning — used for alert-type toasts
  function sfxAlert() {
    ensureCtx();
    tone(220, 0.12, 0.22, 'square');
    tone(185, 0.35, 0.18, 'square', 0.14);
  }

  // cure research started
  function sfxCure() {
    ensureCtx();
    tone(440, 0.09, 0.12, 'sine');
    tone(523, 0.18, 0.09, 'sine', 0.10);
    tone(659, 0.25, 0.07, 'sine', 0.20);
  }

  // soft pulse when new infection data comes in
  function sfxInfect() {
    ensureCtx();
    tone(75, 0.35, 0.13, 'sine');
  }

  // win — dark, ominous "victory"
  function sfxWin() {
    ensureCtx();
    [55, 69.3, 82.4, 110].forEach((f, i) => tone(f, 2.0, 0.22, 'sine', i * 0.25));
  }

  // lose — hopeful/sad resolution
  function sfxLose() {
    ensureCtx();
    [523, 466, 415, 392, 349].forEach((f, i) => tone(f, 1.5, 0.18, 'sine', i * 0.28));
  }

  // soft thud when pausing
  function sfxPause() {
    ensureCtx();
    tone(180, 0.18, 0.14, 'sine');
    tone(120, 0.30, 0.10, 'sine', 0.08);
  }

  // short rising tone when resuming
  function sfxUnpause() {
    ensureCtx();
    tone(130, 0.12, 0.10, 'sine');
    tone(195, 0.18, 0.12, 'sine', 0.08);
  }

  // subtle beep when tapping a country
  function sfxCountryClick() {
    ensureCtx();
    tone(900, 0.06, 0.07, 'sine');
    tone(1200, 0.09, 0.05, 'sine', 0.04);
  }

  // sci-fi whoosh when evolution panel opens
  function sfxEvoOpen() {
    ensureCtx();
    if (!ctx) return;
    const t   = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type  = 'sine';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(520, t + 0.28);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.36);
  }

  // satisfying 3-note chime on trait purchase
  function sfxTraitPurchase() {
    ensureCtx();
    tone(523, 0.14, 0.15, 'sine');         // C5
    tone(659, 0.18, 0.13, 'sine', 0.09);   // E5
    tone(784, 0.24, 0.11, 'sine', 0.18);   // G5
  }

  // descending tone when devolving a trait
  function sfxTraitDevolve() {
    ensureCtx();
    tone(784, 0.12, 0.11, 'sine');
    tone(523, 0.22, 0.09, 'sine', 0.12);
    tone(330, 0.30, 0.08, 'sine', 0.24);
  }

  // TV static burst + two-tone alert for news broadcasts
  function sfxNewsAlert() {
    ensureCtx();
    if (!ctx) return;
    // short noise burst (TV static)
    const sr  = ctx.sampleRate;
    const buf = ctx.createBuffer(1, Math.floor(sr * 0.18), sr);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.35;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.22, ctx.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    src.connect(ng);
    ng.connect(sfxGain);
    src.start();
    // attention double-tone after static
    tone(880, 0.25, 0.18, 'square', 0.20);
    tone(660, 0.30, 0.14, 'square', 0.48);
  }

  // ominous triple-beep at cure milestones (25 / 50 / 75%)
  function sfxCureMilestone() {
    ensureCtx();
    tone(440, 0.13, 0.20, 'square');
    tone(440, 0.13, 0.20, 'square', 0.22);
    tone(330, 0.35, 0.18, 'square', 0.46);
  }

  function setMusicVolume(vol) { // vol 0-1
    if (!ctx) return;
    if (musicGain) musicGain.gain.setTargetAtTime(vol * 0.45, ctx.currentTime, 0.1);
    // Also update master if not muted
    if (!muted && masterGain) masterGain.gain.setTargetAtTime(vol > 0 ? 0.55 : 0, ctx.currentTime, 0.1);
  }

  function setSfxVolume(vol) { // vol 0-1
    if (!ctx || !sfxGain) return;
    sfxGain.gain.setTargetAtTime(vol * 0.9, ctx.currentTime, 0.1);
  }

  // ─── TOGGLE ───────────────────────────────────
  function toggle() {
    if (!ctx) init();
    muted = !muted;
    localStorage.setItem(MUTE_KEY, muted);
    if (masterGain) {
      masterGain.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.3);
    }
    return muted;
  }

  function isMuted() { return muted; }

  return {
    init, startMusic, stopMusic, toggle, isMuted,
    setMusicVolume, setSfxVolume,
    sfxNewCountry, sfxDNA, sfxAlert, sfxCure, sfxInfect, sfxWin, sfxLose,
    sfxPause, sfxUnpause, sfxCountryClick, sfxEvoOpen,
    sfxTraitPurchase, sfxTraitDevolve, sfxNewsAlert, sfxCureMilestone,
  };
})();

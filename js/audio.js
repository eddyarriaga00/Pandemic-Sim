// audio.js — Procedural ambient music + sound effects
// Web Audio API — no sound files needed

const AudioEngine = (() => {
  let ctx          = null;
  let masterGain   = null;
  let musicGain    = null;
  let sfxGain      = null;
  let musicRunning = false;
  let muted        = false;
  let drones       = [];
  let phraseTimer  = null;
  let pulseTimer   = null;
  let tensionGain  = null;   // fades in as cure advances
  let tensionOscs  = [];
  let _tension     = 0;      // 0-1, set from outside

  const MUTE_KEY = 'pathogen_muted';

  function init() {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn('Web Audio API not supported');
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

    muted = localStorage.getItem(MUTE_KEY) === 'true';
    if (muted) masterGain.gain.value = 0;

    // Apply saved volume preferences immediately
    const savedMusic = parseFloat(localStorage.getItem('pm_music_vol') ?? '55') / 100;
    const savedSfx   = parseFloat(localStorage.getItem('pm_sfx_vol')   ?? '90') / 100;
    musicGain.gain.value = savedMusic * 0.45;
    sfxGain.gain.value   = savedSfx   * 0.9;

    return true;
  }

  function ensureCtx() {
    if (!ctx) init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // ─── BACKGROUND MUSIC ─────────────────────────
  // Architecture:
  //   Layer 1 — drone cluster (A1, E2, A2) — always present
  //   Layer 2 — rhythmic pulse (bass throb at 60BPM)
  //   Layer 3 — melodic phrases from Am natural minor
  //   Layer 4 — tension layer (dissonant cluster, grows with cure)

  function startMusic() {
    if (musicRunning) return;
    ensureCtx();
    if (!ctx) return;
    musicRunning = true;
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => _buildMusic());
      return;
    }
    _buildMusic();
  }

  function _buildMusic() {
    if (!musicRunning || !ctx) return;

    // Drone cluster — A1(55), E2(82.4), A2(110), C3(130.8)
    // These form a minor chord: Am = A E A C
    addDrone(55,    0.20, 'sine',     0.05, 3.0);  // root — deep sub
    addDrone(82.4,  0.11, 'sine',     0.04, 4.5);  // 5th — gives fullness
    addDrone(110,   0.07, 'triangle', 0.06, 6.0);  // octave
    addDrone(130.8, 0.04, 'triangle', 0.03, 7.5);  // minor 3rd — dark colour

    // Filtered noise bed — very subtle texture
    addFilteredNoise();

    // Rhythmic bass pulse — heartbeat at ~56 BPM
    schedulePulse();

    // Melodic phrases with reverb
    schedulePhrases();

    // Tension layer — builds as cure advances
    buildTensionLayer();
  }

  function stopMusic() {
    musicRunning = false;
    if (phraseTimer) { clearTimeout(phraseTimer); phraseTimer = null; }
    if (pulseTimer)  { clearTimeout(pulseTimer);  pulseTimer  = null; }
    drones.forEach(({ osc, lfo, gain }) => {
      try {
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
        osc.stop(ctx.currentTime + 1.5);
        if (lfo) lfo.stop(ctx.currentTime + 1.5);
      } catch (_) {}
    });
    drones = [];
    tensionOscs.forEach(o => { try { o.stop(ctx.currentTime + 1); } catch (_) {} });
    tensionOscs = [];
  }

  // ─── DRONE LAYER ──────────────────────────────
  function addDrone(freq, amp, type, lfoDepth, fadeTime) {
    if (!ctx) return;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.05 + Math.random() * 0.07; // very slow wobble

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = freq * lfoDepth;
    lfo.connect(lfoGain);

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    lfoGain.connect(osc.frequency);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 0.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(amp, ctx.currentTime + (fadeTime || 4));

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(musicGain);

    osc.start();
    lfo.start();
    drones.push({ osc, lfo, gain, filter });
  }

  function addFilteredNoise() {
    if (!ctx) return;
    const sr  = ctx.sampleRate;
    const buf = ctx.createBuffer(1, sr * 4, sr);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop   = true;

    const bp = ctx.createBiquadFilter();
    bp.type  = 'bandpass';
    bp.frequency.value = 80;
    bp.Q.value = 0.8;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.03, ctx.currentTime + 6);

    src.connect(bp);
    bp.connect(gain);
    gain.connect(musicGain);
    src.start();
  }

  // ─── RHYTHMIC PULSE ───────────────────────────
  // A low bass thud at 56 BPM gives a heartbeat feel.
  // Uses scheduled sine bursts rather than a running oscillator.
  const BEAT_MS = 1071; // 56 BPM

  function schedulePulse() {
    if (!musicRunning || !ctx) return;

    function beatStep() {
      if (!musicRunning || !ctx) return;

      const t = ctx.currentTime;
      // kick-style: sine burst from ~80Hz decaying quickly
      const osc   = ctx.createOscillator();
      osc.type    = 'sine';
      osc.frequency.setValueAtTime(80, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.18);

      const gain  = ctx.createGain();
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

      osc.connect(gain);
      gain.connect(musicGain);
      osc.start(t);
      osc.stop(t + 0.32);

      pulseTimer = setTimeout(beatStep, BEAT_MS);
    }

    // Delay first beat so drones have time to fade in
    pulseTimer = setTimeout(beatStep, 5000 + Math.random() * 1000);
  }

  // ─── MELODIC PHRASES ──────────────────────────
  // A natural minor: A B C D E F G
  // Frequencies across two usable octaves (A3-A4 range — haunting vocal register)
  const SCALE_FREQS = [
    220.0,  // A3
    246.9,  // B3
    261.6,  // C4
    293.7,  // D4
    329.6,  // E4
    349.2,  // F4
    392.0,  // G4
    440.0,  // A4
    493.9,  // B4
    523.3,  // C5
    587.3,  // D5
  ];

  // Phrases: arrays of [scaleIndex, durationSec, ampMod]
  // Each gives a different emotional texture
  const PHRASES = [
    // Descending lament — classic minor fall A→E→C→A
    [[7,0.7,1],[4,0.7,0.8],[2,1.0,0.7],[0,2.0,0.5]],
    // Slow rising tension
    [[0,0.5,0.6],[2,0.5,0.7],[4,0.6,0.8],[7,1.5,1.0]],
    // Haunting high motif
    [[9,0.6,0.7],[8,0.5,0.6],[7,0.8,0.8],[4,1.8,0.5]],
    // Long single sustain — A4
    [[7,4.0,0.9]],
    // Long sustain — E4 (5th)
    [[4,3.5,0.7]],
    // Falling triplet
    [[10,0.4,0.8],[9,0.4,0.7],[7,0.4,0.7],[4,2.0,0.5]],
    // Ascending then drop
    [[2,0.4,0.6],[4,0.4,0.7],[7,0.4,0.8],[9,0.6,1.0],[7,0.8,0.7],[4,2.0,0.5]],
    // Eerie tremolo on F4 (bVI — most unsettling)
    [[5,3.0,0.85]],
    // Two note call-and-response
    [[7,0.5,0.9],[5,0.5,0.7],[7,0.5,0.9],[4,2.0,0.6]],
  ];

  let _phraseIdx = 0;

  function schedulePhrases() {
    if (!musicRunning || !ctx) return;

    function playPhrase() {
      if (!musicRunning || !ctx) return;

      const phrase = PHRASES[_phraseIdx % PHRASES.length];
      _phraseIdx++;
      // Occasionally shuffle to avoid predictability
      if (Math.random() < 0.3) _phraseIdx = Math.floor(Math.random() * PHRASES.length);

      let offset = 0;

      for (const [si, dur, ampMod] of phrase) {
        const freq = SCALE_FREQS[Math.min(si, SCALE_FREQS.length - 1)];
        const amp  = 0.065 * (ampMod || 1);
        const t    = ctx.currentTime + offset;

        const osc  = ctx.createOscillator();
        osc.type   = 'sine';
        osc.frequency.value = freq;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(amp, t + 0.09);
        gain.gain.setValueAtTime(amp * 0.75, t + dur * 0.6);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.15);

        const rev = makeReverb(2.5);
        osc.connect(gain);
        gain.connect(rev);
        rev.connect(musicGain);

        osc.start(t);
        osc.stop(t + dur + 0.3);

        offset += dur;
      }

      // Gap between phrases: 5-14 seconds
      const gap = 5000 + Math.random() * 9000;
      phraseTimer = setTimeout(playPhrase, (offset * 1000) + gap);
    }

    // Initial delay — let the drones settle first
    phraseTimer = setTimeout(playPhrase, 4000 + Math.random() * 3000);
  }

  // ─── TENSION LAYER ────────────────────────────
  // Adds a high, dissonant tremolo that grows with cure progress.
  // Evokes urgency without being distracting at low levels.
  function buildTensionLayer() {
    if (!ctx) return;

    tensionGain = ctx.createGain();
    tensionGain.gain.value = 0;
    tensionGain.connect(musicGain);

    // Slightly detuned pair — creates beating/shimmer
    const freqPairs = [[349.2, 353.0], [523.3, 527.5]];
    for (const [f1, f2] of freqPairs) {
      for (const f of [f1, f2]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = 0.5;
        o.connect(g);
        g.connect(tensionGain);
        o.start();
        tensionOscs.push(o);
      }
    }
  }

  function setTension(t) {
    // t = 0-1 (cure progress / 100)
    _tension = Math.max(0, Math.min(1, t));
    if (!tensionGain || !ctx) return;
    // Only audible above ~40% tension
    const audible = Math.max(0, (_tension - 0.4) / 0.6);
    tensionGain.gain.setTargetAtTime(audible * 0.045, ctx.currentTime, 1.5);
  }

  // ─── REVERB ────────────────────────────────────
  function makeReverb(duration) {
    const conv = ctx.createConvolver();
    const len  = Math.floor(ctx.sampleRate * duration);
    const buf  = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
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

  function sfxNewCountry() {
    ensureCtx();
    tone(55,  0.6,  0.30, 'sine');
    tone(82.4,0.45, 0.15, 'triangle', 0.12);
    tone(165, 0.30, 0.09, 'sine',     0.25);
  }

  function sfxDNA() {
    ensureCtx();
    tone(1047, 0.14, 0.18, 'sine');
    tone(1319, 0.20, 0.12, 'sine', 0.09);
  }

  function sfxAlert() {
    ensureCtx();
    tone(220, 0.10, 0.22, 'square');
    tone(185, 0.32, 0.18, 'square', 0.14);
  }

  function sfxCure() {
    ensureCtx();
    tone(440, 0.09, 0.12, 'sine');
    tone(523, 0.18, 0.09, 'sine', 0.10);
    tone(659, 0.25, 0.07, 'sine', 0.20);
  }

  function sfxInfect() {
    ensureCtx();
    tone(75, 0.35, 0.13, 'sine');
  }

  function sfxWin() {
    ensureCtx();
    // Ominous descending minor chord hit
    [55, 65.4, 82.4, 110].forEach((f, i) => tone(f, 2.5, 0.22, 'sine', i * 0.18));
  }

  function sfxLose() {
    ensureCtx();
    // Hopeful resolution — ascending
    [330, 392, 440, 523, 659].forEach((f, i) => tone(f, 1.8, 0.16, 'sine', i * 0.22));
  }

  function sfxPause() {
    ensureCtx();
    tone(180, 0.18, 0.14, 'sine');
    tone(120, 0.30, 0.10, 'sine', 0.08);
  }

  function sfxUnpause() {
    ensureCtx();
    tone(130, 0.12, 0.10, 'sine');
    tone(195, 0.18, 0.12, 'sine', 0.08);
  }

  function sfxCountryClick() {
    ensureCtx();
    tone(900,  0.06, 0.07, 'sine');
    tone(1200, 0.09, 0.05, 'sine', 0.04);
  }

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

  function sfxTraitPurchase() {
    ensureCtx();
    tone(523, 0.14, 0.15, 'sine');
    tone(659, 0.18, 0.13, 'sine', 0.09);
    tone(784, 0.24, 0.11, 'sine', 0.18);
  }

  function sfxTraitDevolve() {
    ensureCtx();
    tone(784, 0.12, 0.11, 'sine');
    tone(523, 0.22, 0.09, 'sine', 0.12);
    tone(330, 0.30, 0.08, 'sine', 0.24);
  }

  function sfxNewsAlert() {
    ensureCtx();
    if (!ctx) return;
    const sr  = ctx.sampleRate;
    const buf = ctx.createBuffer(1, Math.floor(sr * 0.18), sr);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.35;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.20, ctx.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    src.connect(ng);
    ng.connect(sfxGain);
    src.start();
    tone(880, 0.25, 0.16, 'square', 0.20);
    tone(660, 0.30, 0.12, 'square', 0.48);
  }

  function sfxCureMilestone() {
    ensureCtx();
    tone(440, 0.12, 0.20, 'square');
    tone(440, 0.12, 0.20, 'square', 0.22);
    tone(330, 0.35, 0.18, 'square', 0.46);
  }

  // ─── VOLUME ────────────────────────────────────
  function setMusicVolume(vol) {
    if (!ctx || !musicGain) return;
    musicGain.gain.setTargetAtTime(vol * 0.45, ctx.currentTime, 0.1);
  }

  function setSfxVolume(vol) {
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
    init, startMusic, stopMusic, toggle, isMuted, setTension,
    setMusicVolume, setSfxVolume,
    sfxNewCountry, sfxDNA, sfxAlert, sfxCure, sfxInfect, sfxWin, sfxLose,
    sfxPause, sfxUnpause, sfxCountryClick, sfxEvoOpen,
    sfxTraitPurchase, sfxTraitDevolve, sfxNewsAlert, sfxCureMilestone,
  };
})();

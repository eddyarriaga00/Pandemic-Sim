/* ═══════════════════════════════════════════════
   PATHOGEN v3 - Audio
   Everything is synthesised with the Web Audio API; there are no sound files.

   Music is an adaptive score, not a loop. A clock schedules it bar by bar
   from the state of the game:
     - undetected:  sparse pad and bells, slow
     - identified:  a plucked ostinato joins, harmony darkens
     - cure nears:  ticking, a second kick, the tempo climbs
     - mass death:  the high parts thin out, a low drone and a heartbeat
                    take over, the tempo sinks
   Pausing muffles it; hiding the tab suspends it.

   All sound is built by createGraph(ctx), which works on any audio
   context. The live engine uses a real one; selfTest() renders the same
   graph offline and measures it, since levels can't be judged by reading.
   ═══════════════════════════════════════════════ */

const AudioEngine = (() => {
  const MUTE_KEY = 'pathogen_muted';
  const hz = n => 440 * Math.pow(2, (n - 69) / 12); // MIDI note to frequency
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ─── HARMONY ──────────────────────────────────
  // A minor. Each chord: bass note, then pad voices. Two bars per chord.
  const CHORDS = {
    Am9:   { bass: 33, pad: [57, 60, 64, 71] },
    Fmaj7: { bass: 41, pad: [53, 57, 60, 64] },
    Em7:   { bass: 40, pad: [52, 55, 59, 62] },
    Am:    { bass: 33, pad: [57, 60, 64, 69] },
    F:     { bass: 41, pad: [53, 57, 60, 65] },
    Dm7:   { bass: 38, pad: [53, 57, 60, 62] },
    E:     { bass: 40, pad: [52, 56, 59, 64] },
    Bb:    { bass: 34, pad: [53, 58, 62, 65] },
    Gm:    { bass: 31, pad: [55, 58, 62, 67] },
  };
  const PROGRESSIONS = {
    calm:   ['Am9', 'Fmaj7', 'Am9', 'Em7'],
    spread: ['Am', 'F', 'Dm7', 'E'],
    dying:  ['Am', 'Bb', 'Am', 'Gm'],   // flat second: the floor drops out
  };
  const SCALES = {
    calm:   [69, 71, 72, 74, 76, 77, 79, 81],
    spread: [69, 71, 72, 74, 76, 77, 79, 81],
    dying:  [57, 58, 60, 62, 64, 65, 67, 69],
  };

  // ─── GRAPH ────────────────────────────────────
  function createGraph(ctx) {
    // Output: everything meets at a gentle limiter so stacked sounds can't clip
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -16; limiter.knee.value = 12; limiter.ratio.value = 8;
    limiter.attack.value = 0.004;  limiter.release.value = 0.22;
    limiter.connect(master); master.connect(ctx.destination);

    // One shared reverb. Music and effects each have a dry and a wet input,
    // with matching volume controls, so the sliders scale their tails too.
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx, 3.4);
    reverb.connect(limiter);

    const musicTone = ctx.createBiquadFilter(); // closes when the game is paused
    musicTone.type = 'lowpass'; musicTone.frequency.value = 18000; musicTone.Q.value = 0.3;
    musicTone.connect(limiter);

    const mVol = ctx.createGain(), mVolWet = ctx.createGain();
    const sVol = ctx.createGain(), sVolWet = ctx.createGain();
    mVol.connect(musicTone); mVolWet.connect(reverb);
    sVol.connect(limiter);   sVolWet.connect(reverb);

    const mDry = ctx.createGain(), mWet = ctx.createGain();
    const sDry = ctx.createGain(), sWet = ctx.createGain();
    mDry.connect(mVol); mWet.connect(mVolWet);
    sDry.connect(sVol); sWet.connect(sVolWet);
    mWet.gain.value = 0.55; sWet.gain.value = 0.5;

    // Echo for the plucked line
    const echo = ctx.createDelay(1.5), echoFb = ctx.createGain(), echoTone = ctx.createBiquadFilter();
    echo.delayTime.value = 0.42; echoFb.gain.value = 0.32;
    echoTone.type = 'lowpass'; echoTone.frequency.value = 2200;
    echo.connect(echoTone); echoTone.connect(echoFb); echoFb.connect(echo);
    echoTone.connect(mDry); echoTone.connect(mWet);

    // Pad voices share one filter that opens and closes with the mood
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass'; padFilter.frequency.value = 900; padFilter.Q.value = 0.7;
    padFilter.connect(mDry); padFilter.connect(mWet);

    const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    {
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }

    // ── Building blocks ──
    function osc(type, freq, t, dur, dest, peak, attack, release, detune) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (detune) o.detune.value = detune;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.setValueAtTime(peak, Math.max(t + attack, t + dur - release));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      for (const d of [].concat(dest)) g.connect(d);
      o.start(t); o.stop(t + dur + 0.05);
      return o;
    }

    // A struck or plucked note: instant attack, exponential decay.
    function pluck(type, freq, t, decay, dests, peak, sweepTo) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + decay * 0.8);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g);
      for (const d of [].concat(dests)) g.connect(d);
      o.start(t); o.stop(t + decay + 0.05);
    }

    // A burst of filtered noise. sweepTo slides the filter for whooshes.
    function noise(t, dur, dests, peak, filterType, freq, q, sweepTo) {
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = noiseBuf; src.loop = true;
      f.type = filterType; f.frequency.setValueAtTime(freq, t); f.Q.value = q || 1;
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + Math.min(0.02, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g);
      for (const d of [].concat(dests)) g.connect(d);
      src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    }

    // A bell: a fundamental plus two inharmonic partials.
    function bell(freq, t, decay, dests, peak) {
      pluck('sine', freq, t, decay, dests, peak);
      pluck('sine', freq * 2.76, t, decay * 0.45, dests, peak * 0.28);
      pluck('sine', freq * 5.4, t, decay * 0.2, dests, peak * 0.1);
    }

    // ── Layers that are always running, faded by the state of the game ──
    const shimmer = ctx.createGain(); shimmer.gain.value = 0; shimmer.connect(mDry); shimmer.connect(mWet);
    const drone   = ctx.createGain(); drone.gain.value = 0;
    const droneLp = ctx.createBiquadFilter(); droneLp.type = 'lowpass'; droneLp.frequency.value = 240;
    drone.connect(droneLp); droneLp.connect(mDry); droneLp.connect(mWet);
    const wind    = ctx.createGain(); wind.gain.value = 0;
    const windBp  = ctx.createBiquadFilter(); windBp.type = 'bandpass'; windBp.frequency.value = 420; windBp.Q.value = 0.9;
    wind.connect(mDry); wind.connect(mWet);

    let started = false;
    function startLayers() {
      if (started) return;
      started = true;
      const t = ctx.currentTime;
      const hold = (type, freq, dest, gain, detune) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.value = freq; o.detune.value = detune || 0; g.gain.value = gain;
        o.connect(g); g.connect(dest); o.start(t);
      };
      // High, slightly mistuned pairs: beating that reads as unease
      hold('sine', hz(84), shimmer, 0.5, -9); hold('sine', hz(84), shimmer, 0.5, 9);
      hold('sine', hz(89), shimmer, 0.35, -7); hold('sine', hz(89), shimmer, 0.35, 8);
      // Low fifth
      hold('sawtooth', hz(33), drone, 0.5, -5); hold('sawtooth', hz(33), drone, 0.5, 6);
      hold('sawtooth', hz(40), drone, 0.3, 0);
      // Wind
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      src.connect(windBp); windBp.connect(wind); src.start(t);
    }

    // ── Music clock ──
    const state = { scene: 'menu', infected: 0, dead: 0, cure: 0, detected: false, paused: false };
    let beat = 0, nextBeat = 0, chordIx = 0, mood = 'calm', melodyUntil = 0, arpStep = 0;

    const moodNow = () => state.scene === 'aftermath' ? 'dying'
      : state.dead > 0.2 ? 'dying'
      : state.detected && state.scene === 'game' ? 'spread' : 'calm';

    const tempo = () => clamp(60 + 16 * Math.pow(state.cure, 1.5) - 14 * state.dead, 46, 78);

    function scheduleBeat(t, len) {
      const inGame = state.scene === 'game';
      const alive  = 1 - state.dead;               // fades the busy parts as the world dies
      const tense  = inGame ? state.cure : 0;

      // New chord every two bars
      if (beat % 8 === 0) {
        mood = moodNow();
        const prog = PROGRESSIONS[mood];
        const chord = CHORDS[prog[chordIx % prog.length]];
        chordIx++;
        const span = len * 8;
        padFilter.frequency.setTargetAtTime(clamp(700 + 1100 * (inGame ? state.infected : 0.2) * alive, 380, 1800), t, 2);
        for (const n of chord.pad) {
          osc('sawtooth', hz(n), t, span + 2.5, padFilter, 0.028, 2.4, 3.2, -6);
          osc('sawtooth', hz(n), t, span + 2.5, padFilter, 0.028, 2.4, 3.2, 7);
        }
        osc('sine', hz(chord.bass), t, span + 0.6, mDry, 0.1, 0.6, 1.4);
        osc('triangle', hz(chord.bass + 12), t, span + 0.6, mDry, 0.03, 0.8, 1.4);
        scheduleBeat.chord = chord;
      }
      const chord = scheduleBeat.chord;

      // Pulse. A plain kick while the world is alive; a heartbeat once it is dying.
      if (mood === 'dying') {
        if (beat % 2 === 0) {
          pluck('sine', 72, t, 0.3, mDry, 0.3, 40);
          pluck('sine', 62, t + len * 0.3, 0.26, mDry, 0.18, 38);
        }
      } else if (inGame && (beat % 4 === 0 || (tense > 0.5 && beat % 4 === 2))) {
        pluck('sine', 96, t, 0.34, mDry, beat % 4 === 0 ? 0.28 : 0.18, 44);
      }

      // Plucked ostinato once the world knows: chord tones, eighth notes
      if (mood !== 'calm' && state.scene !== 'aftermath') {
        const density = clamp(0.45 + 0.5 * tense, 0, 1) * clamp(alive * 1.6 - 0.2, 0, 1);
        const notes = [...chord.pad, chord.pad[0] + 12, chord.pad[2] + 12];
        for (let i = 0; i < 2; i++) {
          arpStep++;
          if (Math.random() > density) continue;
          const n = notes[(arpStep * 3) % notes.length] + (arpStep % 8 === 7 ? 12 : 0);
          pluck('triangle', hz(n), t + i * len / 2, 0.38, [mDry, echo], 0.11 * (i ? 0.75 : 1));
        }
      }

      // The cure as a clock: ticks, doubling as it closes in
      if (tense > 0.6) {
        const div = tense > 0.85 ? 4 : 2;
        for (let i = 0; i < div; i++) {
          noise(t + i * len / div, 0.045, mDry, 0.16 * (i % 2 ? 0.6 : 1), 'highpass', 6500, 0.7);
        }
      }

      // A bell phrase now and then, more often when it is quiet
      if (beat % 4 === 0 && t > melodyUntil && Math.random() < (mood === 'calm' ? 0.5 : 0.28)) {
        const scale = SCALES[mood];
        let ix = Math.floor(Math.random() * scale.length), at = t;
        const count = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
          const dur = len * (i === count - 1 ? 3 : (Math.random() < 0.5 ? 1 : 2));
          bell(hz(scale[ix]), at, 2.6, [mDry, mWet], 0.06);
          at += dur;
          ix = clamp(ix + (Math.random() < 0.6 ? -1 : 1) * (1 + Math.floor(Math.random() * 2)), 0, scale.length - 1);
        }
        melodyUntil = at + len * 4;
      }
    }

    // Schedule everything that starts before `until` (seconds on the audio clock).
    function schedule(until) {
      startLayers();
      if (nextBeat < ctx.currentTime) nextBeat = ctx.currentTime + 0.05; // first run, or after a long stall
      while (nextBeat < until) {
        const len = 60 / tempo();
        scheduleBeat(nextBeat, len);
        beat++;
        nextBeat += len;
      }
    }

    // Move the always-on layers and the pause filter toward the current state.
    function applyState() {
      const t = ctx.currentTime;
      const inGame = state.scene === 'game';
      const tense  = inGame ? state.cure : 0;
      const after  = state.scene === 'aftermath';
      shimmer.gain.setTargetAtTime(clamp((tense - 0.35) / 0.65, 0, 1) * 0.022, t, 2);
      drone.gain.setTargetAtTime(after ? 0.06 : clamp(state.dead * 1.4, 0, 1) * 0.07, t, 3);
      wind.gain.setTargetAtTime(after ? 0.26 : 0.07 + 0.2 * state.dead, t, 3);
      windBp.frequency.setTargetAtTime(380 + 500 * state.dead, t, 4);
      musicTone.frequency.setTargetAtTime(state.paused ? 420 : 18000, t, state.paused ? 0.12 : 0.25);
    }

    // ── Sound effects ──
    const both = [sDry, sWet];
    const sfx = {
      click(t)        { noise(t, 0.03, sDry, 0.05, 'highpass', 3800, 0.8); pluck('sine', 1500, t, 0.045, sDry, 0.035); },
      countryClick(t) { pluck('sine', 720, t, 0.09, both, 0.07, 980); },
      // A new country falls: a low drop and a breath of air
      newCountry(t, v) {
        const base = 98 * Math.pow(2, ((v || 0) % 5) / 12);
        pluck('sine', base, t, 0.7, sDry, 0.26, base * 0.45);
        noise(t, 0.5, both, 0.3, 'bandpass', 900, 0.8, 220);
        bell(hz(64 + ((v || 0) % 3) * 3), t + 0.08, 1.2, both, 0.05);
      },
      dna(t, v) {
        const n = 76 + [0, 3, 7, 10, 12][(v || 0) % 5];
        pluck('triangle', hz(n), t, 0.2, both, 0.11);
        pluck('triangle', hz(n + 7), t + 0.07, 0.26, both, 0.09);
      },
      bubble(t)       { pluck('sine', 320, t, 0.14, sDry, 0.22, 1100); bell(hz(91), t + 0.06, 0.6, both, 0.05); },
      purchase(t) {
        [57, 64, 69, 76].forEach((n, i) => pluck('triangle', hz(n), t + i * 0.055, 0.42, both, 0.11));
        pluck('sine', 82, t, 0.4, sDry, 0.2, 46);
      },
      devolve(t)      { [72, 67, 60].forEach((n, i) => pluck('triangle', hz(n), t + i * 0.07, 0.3, both, 0.085)); },
      evoOpen(t)      { noise(t, 0.3, both, 0.5, 'bandpass', 380, 1.4, 2600); },
      evoClose(t)     { noise(t, 0.22, both, 0.4, 'bandpass', 2200, 1.4, 340); },
      pause(t)        { pluck('sine', 440, t, 0.3, sDry, 0.12, 110); },
      unpause(t)      { pluck('sine', 180, t, 0.22, sDry, 0.11, 520); },
      // Governments acting: a dull, muted knock
      warn(t)         { pluck('triangle', 196, t, 0.22, both, 0.13, 150); noise(t, 0.08, sDry, 0.12, 'lowpass', 900, 0.7); },
      // Milestones: a low swell rather than a beep
      alert(t) {
        osc('sawtooth', hz(45), t, 0.9, lowpassTo(both, 700), 0.11, 0.08, 0.6);
        osc('sawtooth', hz(46), t + 0.02, 0.9, lowpassTo(both, 700), 0.08, 0.08, 0.6);
        pluck('sine', 70, t, 0.5, sDry, 0.2, 42);
      },
      // The cure is the one clean, bright sound in the game
      cure(t)         { bell(hz(84), t, 1.1, both, 0.08); bell(hz(88), t + 0.12, 1.3, both, 0.07); },
      cureMilestone(t) { [84, 88, 91].forEach((n, i) => bell(hz(n), t + i * 0.14, 1.4, both, 0.085)); },
      news(t) {
        for (let i = 0; i < 4; i++) noise(t + i * 0.06, 0.03, sDry, 0.14, 'highpass', 2600, 0.8);
        pluck('triangle', hz(69), t + 0.3, 0.5, both, 0.07);
      },
      // A decision: an unresolved chord left hanging
      decision(t) {
        [57, 62, 64, 69].forEach((n, i) => osc('triangle', hz(n), t + i * 0.03, 1.8, both, 0.05, 0.25, 1.3));
        pluck('sine', 110, t, 0.5, sDry, 0.22, 55);
      },
      operation(t)    { noise(t, 0.45, both, 0.45, 'bandpass', 300, 1.2, 3200); pluck('sine', 130, t + 0.32, 0.5, sDry, 0.24, 48); },
      synergy(t)      { [76, 79, 83, 88, 91].forEach((n, i) => bell(hz(n), t + i * 0.07, 0.9, both, 0.06)); },
      achievement(t)  { [69, 73, 76, 81].forEach((n, i) => pluck('triangle', hz(n), t + i * 0.11, 0.6, both, 0.11)); bell(hz(93), t + 0.44, 1.6, both, 0.06); },
      // Humanity is gone: a low chord that never resolves, and the air going out
      win(t) {
        [33, 40, 45, 48].forEach((n, i) => {
          osc('sawtooth', hz(n), t + i * 0.12, 4.5, lowpassTo(both, 520), 0.11, 0.9, 3);
        });
        pluck('sine', 60, t, 1.6, sDry, 0.5, 30);
        noise(t + 0.4, 4, both, 0.3, 'bandpass', 1400, 0.6, 160);
      },
      // The cure wins: bells in a major key, the only ones in the game
      lose(t)         { [72, 76, 79, 84, 88].forEach((n, i) => bell(hz(n), t + i * 0.2, 2.4, both, 0.09)); },
      // Burnout: a heartbeat that slows and stops
      burnout(t) {
        let at = t;
        for (let i = 0; i < 6; i++) {
          pluck('sine', 70, at, 0.3, sDry, 0.4 - i * 0.05, 40);
          pluck('sine', 60, at + 0.2, 0.25, sDry, 0.24 - i * 0.03, 38);
          at += 0.6 + i * 0.22;
        }
      },
    };

    // A throwaway low-pass in front of the given outputs (for brass-like swells)
    function lowpassTo(dests, freq) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = 0.6;
      for (const d of [].concat(dests)) f.connect(d);
      return f;
    }

    return {
      ctx, state, schedule, applyState, sfx, master,
      setMusicVolume(v) { mVol.gain.setTargetAtTime(v * 0.5, ctx.currentTime, 0.1); mVolWet.gain.setTargetAtTime(v * 0.5, ctx.currentTime, 0.1); },
      setSfxVolume(v)   { sVol.gain.setTargetAtTime(v, ctx.currentTime, 0.1); sVolWet.gain.setTargetAtTime(v, ctx.currentTime, 0.1); },
    };
  }

  // Reverb impulse: decaying noise, darker toward the tail.
  function impulse(ctx, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let prev = 0;
      for (let i = 0; i < len; i++) {
        const p = i / len;
        const white = (Math.random() * 2 - 1) * Math.pow(1 - p, 2.6);
        prev += (white - prev) * (0.75 - 0.6 * p); // one-pole low-pass that closes over time
        d[i] = prev * 0.5;
      }
    }
    return buf;
  }

  // ─── LIVE ENGINE ──────────────────────────────
  let live = null, timer = null, muted = false, musicOn = false;
  const lastPlayed = {};
  let dnaRun = 0, countryRun = 0;

  const pref = (key, dflt) => { try { return parseFloat(localStorage.getItem(key) ?? dflt) / 100; } catch { return dflt / 100; } };

  function init() {
    if (live) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { live = createGraph(new AC()); } catch (e) { live = null; return false; }
    try { muted = localStorage.getItem(MUTE_KEY) === 'true'; } catch {}
    live.master.gain.value = muted ? 0 : 0.9;
    live.setMusicVolume(pref('pm_music_vol', 55));
    live.setSfxVolume(pref('pm_sfx_vol', 90));
    return true;
  }

  function resume() {
    if (!live && !init()) return false;
    if (live.ctx.state === 'suspended' && !document.hidden) live.ctx.resume();
    return true;
  }

  function startMusic() {
    if (!resume() || musicOn) return;
    musicOn = true;
    const tick = () => {
      if (live.ctx.state !== 'running') return;
      live.schedule(live.ctx.currentTime + 0.6);
      live.applyState();
    };
    tick();
    timer = setInterval(tick, 150);
  }

  function stopMusic() {
    musicOn = false;
    if (timer) { clearInterval(timer); timer = null; }
  }

  // The game tells the score what is going on. Fractions are 0 to 1.
  function setState(patch) {
    if (!live) return;
    Object.assign(live.state, patch);
    live.applyState();
  }

  // Which screen is showing decides the scene.
  function setScreen(id) {
    setState({
      scene: id === 'screen-game' ? 'game' : id === 'screen-gameover' ? 'aftermath' : 'menu',
      paused: false,
    });
  }

  // Play an effect, at most once per `gap` ms so fast-forward doesn't machine-gun it.
  function play(name, gap, arg) {
    if (!resume() || muted) return;
    const now = performance.now();
    if (gap && now - (lastPlayed[name] || 0) < gap) return;
    lastPlayed[name] = now;
    live.sfx[name](live.ctx.currentTime + 0.01, arg);
  }

  function toggle() {
    if (!init()) return muted;
    muted = !muted;
    try { localStorage.setItem(MUTE_KEY, muted); } catch {}
    live.master.gain.setTargetAtTime(muted ? 0 : 0.9, live.ctx.currentTime, 0.2);
    return muted;
  }

  // Silence completely while the tab is hidden; pick up where it left off.
  document.addEventListener('visibilitychange', () => {
    if (!live) return;
    if (document.hidden) live.ctx.suspend();
    else if (musicOn) live.ctx.resume();
  });

  // ─── SELF TEST ────────────────────────────────
  // Renders the music in several game states, and every effect, through an
  // offline context and reports peak and RMS level for each. Run from the
  // console: `await AudioEngine.selfTest()`.
  async function selfTest(opts) {
    const o = { seconds: 24, music: true, sfx: true, ...(opts || {}) };
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const measure = buf => {
      // brightDb is the level of sample-to-sample change: a crude measure
      // of how much high-frequency content there is.
      let peak = 0, sum = 0, hf = 0, n = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < d.length; i++) {
          const a = Math.abs(d[i]); if (a > peak) peak = a;
          sum += d[i] * d[i]; n++;
          if (i) hf += (d[i] - d[i - 1]) ** 2;
        }
      }
      const db = v => +(20 * Math.log10(Math.max(v, 1e-9))).toFixed(1);
      return { peakDb: db(peak), rmsDb: db(Math.sqrt(sum / n)), brightDb: db(Math.sqrt(hf / n)) };
    };
    const out = { music: {}, sfx: {} };
    const scenes = {
      menu:      { scene: 'menu' },
      early:     { scene: 'game', infected: 0.01 },
      spreading: { scene: 'game', infected: 0.5, detected: true, cure: 0.3 },
      cureClose: { scene: 'game', infected: 0.9, detected: true, cure: 0.92 },
      dying:     { scene: 'game', infected: 0.4, dead: 0.6, detected: true, cure: 0.5 },
      aftermath: { scene: 'aftermath', dead: 1 },
      paused:    { scene: 'game', infected: 0.5, detected: true, cure: 0.3, paused: true },
    };
    for (const name in (o.music ? scenes : {})) {
      const secs = o.seconds;
      const g = createGraph(new OAC(2, 44100 * secs, 44100));
      g.setMusicVolume(0.55);
      Object.assign(g.state, scenes[name]);
      g.schedule(secs);
      g.applyState();
      out.music[name] = measure(await g.ctx.startRendering());
    }
    for (const name of (o.sfx ? Object.keys(createGraph(new OAC(2, 44100, 44100)).sfx) : [])) {
      const g = createGraph(new OAC(2, 44100 * 5, 44100));
      g.setSfxVolume(0.9);
      g.sfx[name](0.05, 0);
      out.sfx[name] = measure(await g.ctx.startRendering());
    }
    return out;
  }

  // ─── PUBLIC ───────────────────────────────────
  return {
    init, startMusic, stopMusic, toggle, isMuted: () => muted,
    setState, setScreen, selfTest,
    // For checking from the console that sound is actually running
    status: () => live ? { context: live.ctx.state, time: +live.ctx.currentTime.toFixed(2), musicOn, muted, ...live.state } : { context: 'none' },
    setMusicVolume: v => live && live.setMusicVolume(v),
    setSfxVolume:   v => live && live.setSfxVolume(v),

    sfxClick:         () => play('click', 40),
    sfxCountryClick:  () => play('countryClick', 60),
    sfxNewCountry:    () => play('newCountry', 220, countryRun++),
    sfxDNA:           () => play('dna', 140, dnaRun++),
    sfxBubble:        () => play('bubble', 60),
    sfxTraitPurchase: () => play('purchase', 80),
    sfxTraitDevolve:  () => play('devolve', 80),
    sfxEvoOpen:       () => play('evoOpen', 150),
    sfxEvoClose:      () => play('evoClose', 150),
    sfxPause:         () => play('pause', 100),
    sfxUnpause:       () => play('unpause', 100),
    sfxWarn:          () => play('warn', 900),
    sfxAlert:         () => play('alert', 1200),
    sfxCure:          () => play('cure', 600),
    sfxCureMilestone: () => play('cureMilestone', 600),
    sfxNewsAlert:     () => play('news', 600),
    sfxDecision:      () => play('decision', 300),
    sfxOperation:     () => play('operation', 200),
    sfxSynergy:       () => play('synergy', 300),
    sfxAchievement:   () => play('achievement', 300),
    sfxWin:           () => play('win'),
    sfxLose:          reason => play(reason === 'burnout' ? 'burnout' : 'lose'),
  };
})();

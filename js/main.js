/* ═══════════════════════════════════════════════
   PATHOGEN v3 - Main Entry Point
   Screen flow, wiring, game bootstrap
   ═══════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── PAUSE MENU ───────────────────────────────
  const PauseMenu = (() => {
    let visible = false;
    const menu = () => document.getElementById('pause-menu');
    const card = () => document.getElementById('pm-card');

    function show() {
      if (visible) return;
      visible = true;
      const m = menu();
      if (!m) return;
      m.classList.remove('hidden');
      document.body.classList.add('pm-open');

      const gs = Game.getState();
      // Fill stats
      document.getElementById('pm-disease-name').textContent = gs.diseaseName || 'PATHOGEN';
      const typeLabels = {
        bacteria: 'BACTERIAL STRAIN', virus: 'VIRAL STRAIN', fungus: 'FUNGAL STRAIN',
        parasite: 'PARASITIC STRAIN', prion: 'PRION STRAIN', 'nano-virus': 'SYNTHETIC STRAIN',
      };
      document.getElementById('pm-disease-type').textContent = typeLabels[gs.diseaseType] || '';
      document.getElementById('pm-day').textContent      = gs.day;
      document.getElementById('pm-infected').textContent = UI.fmt(gs.totalInfected);
      document.getElementById('pm-dead').textContent     = UI.fmt(gs.totalDead);
      document.getElementById('pm-cure-pct').textContent = gs.cureProgress.toFixed(1) + '%';

      // Restore saved volume values
      const savedMusic = parseInt(localStorage.getItem('pm_music_vol') ?? '55');
      const savedSfx   = parseInt(localStorage.getItem('pm_sfx_vol')   ?? '90');
      const musicSlider = document.getElementById('pm-music-vol');
      const sfxSlider   = document.getElementById('pm-sfx-vol');
      if (musicSlider) { musicSlider.value = savedMusic; document.getElementById('pm-music-val').textContent = savedMusic; }
      if (sfxSlider)   { sfxSlider.value   = savedSfx;   document.getElementById('pm-sfx-val').textContent   = savedSfx; }

      // GSAP animate in
      if (typeof gsap !== 'undefined') {
        gsap.fromTo(m,    { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power2.out' });
        gsap.fromTo(card(), { opacity: 0, scale: 0.92, y: 12 }, { opacity: 1, scale: 1, y: 0, duration: 0.28, ease: 'back.out(1.6)' });
      }
    }

    function hide() {
      if (!visible) return;
      const m = menu();
      if (!m) return;
      document.body.classList.remove('pm-open');
      if (typeof gsap !== 'undefined') {
        gsap.to(card(), { opacity: 0, scale: 0.94, y: 8, duration: 0.18, ease: 'power2.in', onComplete: () => m.classList.add('hidden') });
      } else {
        m.classList.add('hidden');
      }
      visible = false;
    }

    function init() {
      document.getElementById('pm-resume')?.addEventListener('click', () => {
        hide();
        Game.setPaused(false);
        const pb = document.getElementById('btn-pause');
        if (pb) { pb.textContent = '⏸'; pb.classList.remove('active'); }
        if (typeof AudioEngine !== 'undefined') AudioEngine.sfxUnpause();
      });

      document.getElementById('pm-restart')?.addEventListener('click', () => {
        hide();
        const gs = Game.getState();
        Events.cleanup();
        if (gs.mode === 'daily') { startDaily(); return; }
        const name = document.getElementById('disease-name')?.value.trim() || gs.diseaseName;
        startNewGame(name, gs.diseaseType, gs.difficulty);
      });

      document.getElementById('pm-main-menu')?.addEventListener('click', () => {
        hide();
        Game.saveGame();
        Events.cleanup();
        UI.stopRenderLoop();
        UI.showScreen('screen-splash');
        refreshSaveButton();
      });

      document.getElementById('pm-save')?.addEventListener('click', () => {
        const ok = Game.saveGame();
        const btn = document.getElementById('pm-save');
        if (ok && btn) {
          btn.textContent = '✓ SAVED!';
          btn.style.borderColor = 'var(--green)';
          btn.style.color = 'var(--green)';
          setTimeout(() => {
            btn.textContent = '💾 SAVE GAME';
            btn.style.borderColor = '';
            btn.style.color = '';
          }, 2000);
        }
      });

      // Volume sliders
      document.getElementById('pm-music-vol')?.addEventListener('input', e => {
        const val = parseInt(e.target.value);
        document.getElementById('pm-music-val').textContent = val;
        localStorage.setItem('pm_music_vol', val);
        if (typeof AudioEngine !== 'undefined') AudioEngine.setMusicVolume(val / 100);
      });

      document.getElementById('pm-sfx-vol')?.addEventListener('input', e => {
        const val = parseInt(e.target.value);
        document.getElementById('pm-sfx-val').textContent = val;
        localStorage.setItem('pm_sfx_vol', val);
        if (typeof AudioEngine !== 'undefined') AudioEngine.setSfxVolume(val / 100);
      });

      // Close on backdrop click
      document.getElementById('pause-menu')?.addEventListener('click', e => {
        if (e.target === document.getElementById('pause-menu')) {
          document.getElementById('pm-resume')?.click();
        }
      });
    }

    return { show, hide, init };
  })();

  let selectedType       = 'bacteria';
  let selectedDifficulty = 'standard';
  let mapLoaded          = false;
  let originOverlay      = null;
  let confirmEl          = null;

  // ─── SPLASH ───────────────────────────────────
  // ─── SAVE GAME DETECTION ─────────────────────
  function refreshSaveButton() {
    if (typeof refreshDailyButton === 'function') refreshDailyButton();
    const meta = Game.getSaveMeta();
    const btn = document.getElementById('btn-load-save');
    if (!btn) return;
    if (meta) {
      btn.textContent = `💾 CONTINUE — ${meta.diseaseName} (Day ${meta.day})`;
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  }
  refreshSaveButton();

  document.getElementById('btn-load-save')?.addEventListener('click', async () => {
    if (!Game.loadSave()) { Game.clearSave(); refreshSaveButton(); return; }
    AudioEngine.init();
    AudioEngine.startMusic();
    _syncMusicBtn();
    const gs = Game.getState();
    await enterGameScreen();
    if (gs.originIso) WorldMap.setOrigin(gs.originIso);
    Events.syncMilestones(gs);
    NewsPopup.reset(gs.day);
    Events.startNewsTicker();
    setSpeedButton(gs.speed);
    Game.setPaused(false);
    UI.toast(`💾 Loaded: ${gs.diseaseName}, day ${gs.day}`, 'info');
    if (Game.getDilemma()) showDilemma();
  });

  document.getElementById('btn-start').addEventListener('click', () => {
    AudioEngine.init();
    AudioEngine.startMusic();
    _syncMusicBtn();
    showStoryScreen();
  });

  // story screen
  const STORY_TEXT = `CLASSIFICATION: OMEGA BLACK
RECIPIENT: OPERATIVE [REDACTED]
TRANSMISSION: SECURE CHANNEL 7

You have been selected.

Not for your morality. Not for your conscience.
For your intelligence — and your willingness to do
what those above you would not.

What you are about to receive access to is the
culmination of 20 years of classified biological
research. Funded by governments who will deny its
existence. Developed by scientists who vanished.

It is alive. It is patient. It is yours.

Your objective: demonstrate the fragility of
humanity's immune systems against an evolved
biological threat. Infect. Evolve. Observe.

The world holds nearly eight billion souls. None of them
know what is about to begin. They take planes,
shake hands, breathe shared air — blissfully
unaware that somewhere, something new has woken.

That something is you.

Choose your origin wisely.
The rest is biology.

— END TRANSMISSION —`;

  function showStoryScreen() {
    UI.showScreen('screen-story');
    const el = document.getElementById('story-body');
    el.textContent = '';
    let i = 0;
    function typeChar() {
      if (i < STORY_TEXT.length) {
        el.textContent += STORY_TEXT[i++];
        setTimeout(typeChar, i < 80 ? 18 : 10);
      }
    }
    typeChar();
  }

  document.getElementById('btn-story-continue').addEventListener('click', () => {
    UI.showScreen('screen-setup');
    const inp = document.getElementById('disease-name');
    if (!inp.value) inp.value = randName();
  });

  document.getElementById('btn-story-skip').addEventListener('click', () => {
    UI.showScreen('screen-setup');
    const inp = document.getElementById('disease-name');
    if (!inp.value) inp.value = randName();
  });

  PauseMenu.init();
  window.PauseMenu = PauseMenu; // expose for ui.js

  document.getElementById('btn-how-to-play').addEventListener('click', () => {
    document.getElementById('modal-howto').classList.remove('hidden');
  });
  document.getElementById('btn-close-howto').addEventListener('click', () => {
    document.getElementById('modal-howto').classList.add('hidden');
  });
  document.getElementById('modal-howto').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-howto'))
      document.getElementById('modal-howto').classList.add('hidden');
  });

  // ─── SETTINGS MODAL ───────────────────────────
  (function initSettings() {
    const modal   = document.getElementById('modal-settings');
    const musicSl = document.getElementById('set-music-vol');
    const sfxSl   = document.getElementById('set-sfx-vol');
    const musicVl = document.getElementById('set-music-val');
    const sfxVl   = document.getElementById('set-sfx-val');
    const motionCb  = document.getElementById('set-reduced-motion');
    const tooltipCb = document.getElementById('set-show-tooltips');

    function loadPrefs() {
      const mv = parseInt(localStorage.getItem('pm_music_vol') ?? '55');
      const sv = parseInt(localStorage.getItem('pm_sfx_vol')   ?? '90');
      const rm = localStorage.getItem('set_reduced_motion') === '1';
      const tt = localStorage.getItem('set_show_tooltips') !== '0';
      if (musicSl) { musicSl.value = mv; if (musicVl) musicVl.textContent = mv; }
      if (sfxSl)   { sfxSl.value   = sv; if (sfxVl)   sfxVl.textContent   = sv; }
      if (motionCb)  motionCb.checked  = rm;
      if (tooltipCb) tooltipCb.checked = tt;
    }

    document.getElementById('btn-settings')?.addEventListener('click', () => {
      loadPrefs();
      modal.classList.remove('hidden');
      if (typeof gsap !== 'undefined') {
        const mc = modal.querySelector('.modal-content');
        gsap.fromTo(mc, { opacity: 0, y: 14, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.25, ease: 'back.out(1.4)' });
      }
    });

    document.getElementById('btn-close-settings')?.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
    modal?.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

    musicSl?.addEventListener('input', e => {
      const val = parseInt(e.target.value);
      if (musicVl) musicVl.textContent = val;
      localStorage.setItem('pm_music_vol', val);
      if (typeof AudioEngine !== 'undefined') AudioEngine.setMusicVolume(val / 100);
    });
    sfxSl?.addEventListener('input', e => {
      const val = parseInt(e.target.value);
      if (sfxVl) sfxVl.textContent = val;
      localStorage.setItem('pm_sfx_vol', val);
      if (typeof AudioEngine !== 'undefined') AudioEngine.setSfxVolume(val / 100);
    });
    motionCb?.addEventListener('change', () => {
      localStorage.setItem('set_reduced_motion', motionCb.checked ? '1' : '0');
      document.body.classList.toggle('reduced-motion', motionCb.checked);
    });
    tooltipCb?.addEventListener('change', () => {
      localStorage.setItem('set_show_tooltips', tooltipCb.checked ? '1' : '0');
    });

    // Apply saved prefs on load
    loadPrefs();
    if (localStorage.getItem('set_reduced_motion') === '1') document.body.classList.add('reduced-motion');
  })();

  // ─── SETUP ────────────────────────────────────
  document.querySelectorAll('.type-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedType = card.dataset.type;
    });
  });

  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedDifficulty = btn.dataset.diff;
      showRecords();
    });
  });

  // Best winning run for each pathogen type at the chosen difficulty.
  function showRecords() {
    document.querySelectorAll('.type-card').forEach(card => {
      card.querySelector('.type-best')?.remove();
      const rec = UI.Records.get(card.dataset.type, selectedDifficulty);
      if (!rec) return;
      const badge = document.createElement('span');
      badge.className = 'type-best';
      badge.textContent = `★ ${rec.grade} · ${rec.days} days`;
      card.appendChild(badge);
    });
  }
  new MutationObserver(() => {
    if (document.getElementById('screen-setup').classList.contains('active')) showRecords();
  }).observe(document.getElementById('screen-setup'), { attributes: true, attributeFilter: ['class'] });

  document.getElementById('btn-back-setup').addEventListener('click', () => {
    Events.cleanup();
    UI.stopRenderLoop();
    UI.showScreen('screen-splash');
  });

  document.getElementById('btn-begin-game').addEventListener('click', () => {
    const name = document.getElementById('disease-name').value.trim() || randName();
    startNewGame(name, selectedType, selectedDifficulty);
  });

  // ─── GAME SCREEN WIRING ───────────────────────
  document.getElementById('btn-evolve').addEventListener('click', () => {
    Evolution.open();
  });

  document.getElementById('dna-display').addEventListener('click', () => {
    Evolution.open();
  });

  function _syncMusicBtn() {
    const btn = document.getElementById('btn-music');
    if (!btn) return;
    const muted = AudioEngine.isMuted();
    btn.classList.toggle('muted', muted);
    btn.textContent = muted ? '♪̶' : '♪';
  }

  document.getElementById('btn-music').addEventListener('click', () => {
    const muted = AudioEngine.toggle();
    const btn = document.getElementById('btn-music');
    btn.classList.toggle('muted', muted);
    btn.textContent = muted ? '♪̶' : '♪';
  });

  document.getElementById('cp-close').addEventListener('click', () => {
    UI.hideCountryPanel();
  });


  // ─── GAME OVER ────────────────────────────────
  document.getElementById('btn-play-again').addEventListener('click', () => {
    Events.cleanup();
    if (Game.getState().mode === 'daily') { startDaily(); return; }
    const name = document.getElementById('disease-name').value.trim() || randName();
    startNewGame(name, selectedType, selectedDifficulty);
  });

  document.getElementById('btn-share').addEventListener('click', async e => {
    const btn  = e.currentTarget;
    const text = UI.resultText();
    let done = false;
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) { await navigator.share({ text }); done = true; }
      else { await navigator.clipboard.writeText(text); done = true; }
    } catch { /* cancelled, or clipboard blocked */ }
    btn.textContent = done ? '✓ COPIED' : 'COULD NOT COPY';
    setTimeout(() => { btn.textContent = '⧉ SHARE RESULT'; }, 2000);
  });

  document.getElementById('btn-main-menu').addEventListener('click', () => {
    Events.cleanup();
    UI.stopRenderLoop();
    UI.showScreen('screen-splash');
    refreshSaveButton();
  });

  // ─── DISEASE BRIEFINGS ───────────────────────
  const DISEASE_BRIEFINGS = {
    bacteria: {
      icon: '🦠',
      codename: 'BACTERIAL STRAIN · BIOHAZARD LEVEL 4',
      text: `A gram-negative bacillus engineered for environmental resilience. It forms biofilms, resists standard antibiotic protocols, and thrives in crowded low-hygiene conditions.

Optimal vectors: contaminated water, soil, physical contact. Moderate transmission speed — but every evolution compounds exponentially.

Advantage: governments are slow to respond to bacterial threats. You have time to root yourself before detection triggers cure research.

Weakness: rich-nation healthcare systems will contain you aggressively once alerted. Spread to poor and middle-income countries first.

Choose your origin wisely. The incubation begins.`,
    },
    virus: {
      icon: '🔴',
      codename: 'VIRAL STRAIN · BIOHAZARD LEVEL 4',
      text: `A single-stranded RNA virus that was never meant to exist outside a laboratory. It hijacks cellular machinery with terrifying efficiency, replicating exponentially inside every host.

Air travel is your weapon. Dense urban populations are your fuel. This pathogen mutates randomly as it spreads — sometimes in your favour. Adapt fast.

Advantage: highest base transmission rate of any biological strain. One infected traveller can seed a continent.

Warning: immune responses evolve quickly. Governments detect viral threats faster. Your window is narrow — move before they coordinate a response.`,
    },
    fungus: {
      icon: '🍄',
      codename: 'FUNGAL STRAIN · BIOHAZARD LEVEL 3',
      text: `Not a virus. Not a bacterium. Something older. This organism reproduces via microscopic spores that survive UV radiation, extreme temperatures, and chemical sterilisation.

Conventional quarantine measures are nearly useless against airborne spore dispersal. The fungus is patient — it grows slowly but cannot be stopped once established in soil and air.

Advantage: random long-range spore bursts can seed distant continents without air travel routes. Truly unpredictable spread vectors.

Weakness: wet tropical climates slow sporulation significantly. Expand into arid and cold regions — there you are nearly unstoppable.`,
    },
    parasite: {
      icon: '🐛',
      codename: 'PARASITIC STRAIN · BIOHAZARD LEVEL 3',
      text: `A multicellular organism designed to live inside a human host indefinitely — and undetected. Governments won't begin cure research until visible severity threshold is crossed.

Your greatest advantage: invisibility. Spread silently through contaminated food and water sources. By the time symptoms appear, the infection is already global.

Optimal strategy: evolve transmission silently before investing in severity. Low lethality keeps hosts mobile — they continue spreading without knowing.

Disadvantage: inherently slower spread than viral strains. But the world won't see you coming.`,
    },
    prion: {
      icon: '🧠',
      codename: 'PRION STRAIN · BIOHAZARD LEVEL 4',
      text: `Not a living organism. A misfolded protein that cannot be destroyed by heat, radiation, or conventional biohazard protocols. Once it enters the nervous system, there is no cure — only progression.

Scientists cannot develop a treatment because there is nothing to kill. The cure research visible on screen is theoretical. Without your mistakes, they will never complete it.

Advantage: near-zero initial detection. Extremely high resistance to cure research by nature.

Disadvantage: transmission is the slowest of all strains. Every host must count. Infect dense, connected populations and let biology do the rest. Time is your greatest weapon.`,
    },
    'nano-virus': {
      icon: '⚙️',
      codename: 'SYNTHETIC STRAIN · BIOHAZARD LEVEL 5',
      text: `This is not natural. This is manufactured. A self-replicating synthetic pathogen from a covert laboratory program that officially does not exist. You are the only person alive who knows what has been released.

Detection is instantaneous: governments begin cure research from day one. This is a race. You must spread faster than their response systems can coordinate.

Advantage: highest raw transmission rate of any known pathogen. In optimal conditions it spreads faster than any containment measure can respond.

The cure clock is already running. Do not hesitate. Do not pause. The only way this pathogen wins is speed — and speed alone.`,
    },
  };

  // ─── DISEASE BRIEFING OVERLAY ────────────────
  function showDiseaseBriefing(type) {
    return new Promise(resolve => {
      const b = DISEASE_BRIEFINGS[type] || DISEASE_BRIEFINGS.bacteria;

      const overlay = document.createElement('div');
      overlay.id = 'briefing-overlay';
      overlay.innerHTML = `
        <div class="briefing-inner">
          <div class="briefing-icon">${b.icon}</div>
          <div class="briefing-code">${b.codename}</div>
          <pre class="briefing-text" id="briefing-text"></pre>
          <button class="briefing-skip" id="briefing-skip">skip ›</button>
          <button class="btn-primary briefing-go hidden" id="briefing-go">⚡ DEPLOY PATHOGEN</button>
        </div>
      `;
      document.getElementById('screen-game').appendChild(overlay);

      const textEl  = document.getElementById('briefing-text');
      const goBtn   = document.getElementById('briefing-go');
      const skipBtn = document.getElementById('briefing-skip');
      const text    = b.text;
      let i = 0, stopped = false;

      function finish() {
        stopped = true;
        textEl.textContent = text;
        goBtn.classList.remove('hidden');
        skipBtn.classList.add('hidden');
      }

      function typeChar() {
        if (stopped) return;
        if (i < text.length) {
          textEl.textContent += text[i++];
          setTimeout(typeChar, i < 60 ? 14 : 7);
        } else {
          goBtn.classList.remove('hidden');
          skipBtn.classList.add('hidden');
        }
      }
      typeChar();

      skipBtn.addEventListener('click', finish);
      goBtn.addEventListener('click', () => { overlay.remove(); resolve(); });
    });
  }

  // ─── ENTER GAME SCREEN ────────────────────────
  // Shared by new games and loaded saves.
  function setSpeedButton(speed) {
    document.querySelectorAll('.speed-btn[data-speed]').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-speed' + (speed || 1))?.classList.add('active');
    const pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) { pauseBtn.textContent = '⏸'; pauseBtn.classList.remove('active'); }
  }

  async function enterGameScreen() {
    // Show the screen first so the map container has a size to measure
    UI.showScreen('screen-game');
    setSpeedButton(1);
    const totalEl = document.getElementById('hud-countries-total');
    if (totalEl) totalEl.textContent = Game.getAllCountries().length;
    UI.initSpeedButtons();
    Evolution.init();
    Evolution.refreshTree();
    UI.resetHud();
    UI.startRenderLoop();
    if (!mapLoaded) {
      await WorldMap.load();
      mapLoaded = true;
    } else {
      WorldMap.reset();
    }
    WorldMap.updateColors();
  }

  // ─── INIT NEW GAME ────────────────────────────
  async function startNewGame(name, type, difficulty, extra) {
    Events.cleanup();
    UI.stopRenderLoop();
    NewsPopup.reset();
    removeOverlays();
    document.getElementById('briefing-overlay')?.remove();

    closeDilemma();
    Game.init({ name, type, difficulty, ...(extra || {}) });
    await enterGameScreen();

    await showDiseaseBriefing(type);
    if (extra && extra.origin) {
      // Daily outbreak: the starting country is part of the challenge
      WorldMap.highlightCountry(extra.origin);
      beginInfection(extra.origin);
    } else {
      showOriginOverlay();
    }
  }

  // ─── DAILY OUTBREAK ───────────────────────────
  // One fixed setup per calendar day (UTC): same pathogen, same starting
  // country and the same random seed for everyone who plays it.
  function dailySpec() {
    const date = new Date().toISOString().slice(0, 10);
    let s = +date.replace(/-/g, '');
    const next = () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
    next(); next();
    const types   = Object.keys(DISEASE_TYPES);
    // Big, not-rich countries only: every daily should be winnable
    const origins = COUNTRIES_DATA.filter(c => c.pop >= 20e6 && c.wealth !== 'rich');
    const type    = types[Math.floor(next() * types.length)];
    const origin  = origins[Math.floor(next() * origins.length)];
    return {
      date, type, origin, difficulty: 'standard',
      seed: Math.floor(next() * 2 ** 31),
      name: 'Strain ' + date.slice(5).replace('-', '/'),
    };
  }

  function refreshDailyButton() {
    const spec = dailySpec();
    const done = UI.Records.daily(spec.date);
    const sub  = document.getElementById('daily-sub');
    const what = `${DISEASE_TYPES[spec.type].name} · starts in ${spec.origin.name}`;
    sub.textContent = !done ? what
      : done.won ? `✓ Won in ${done.days} days, grade ${done.grade} · play again`
                 : `✗ Lost on day ${done.days} · try again`;
    document.getElementById('btn-daily').classList.toggle('done', !!(done && done.won));
  }
  refreshDailyButton();

  function startDaily() {
    const spec = dailySpec();
    AudioEngine.init();
    AudioEngine.startMusic();
    _syncMusicBtn();
    startNewGame(spec.name, spec.type, spec.difficulty,
      { seed: spec.seed, mode: 'daily', dailyDate: spec.date, origin: spec.origin.iso });
  }
  document.getElementById('btn-daily').addEventListener('click', startDaily);

  // ─── DILEMMAS ─────────────────────────────────
  const dilemmaModal = document.getElementById('modal-dilemma');
  let pausedForDilemma = false;

  function optionChips(o, cureActive) {
    const chips = [];
    if (o.dna)    chips.push([`${o.dna > 0 ? '+' : ''}${o.dna} DNA`, o.dna > 0 ? 'good' : 'bad']);
    if (o.detect) chips.push(cureActive
      ? [`cure ${o.detect > 0 ? '+' : ''}${Math.round(o.detect * 10)}%`, o.detect > 0 ? 'bad' : 'good']
      : [`detection ${o.detect > 0 ? '+' : ''}${Math.round(o.detect * 100)}%`, o.detect > 0 ? 'bad' : 'good']);
    if (o.cure)   chips.push([`cure ${o.cure > 0 ? '+' : ''}${o.cure}%`, o.cure > 0 ? 'bad' : 'good']);
    if (o.seed)   chips.push([`+${o.seed} country`, 'good']);
    if (o.mutate) chips.push(['random symptom', 'bad']);
    if (o.boost)  chips.push([`${UI.effectText(o.boost).join(', ')} · ${o.boost.days}d`, 'neutral']);
    return chips.map(([t, c]) => `<span class="dl-chip ${c}">${t}</span>`).join('');
  }

  function showDilemma() {
    const d = Game.getDilemma();
    if (!d) return;
    const gs = Game.getState();
    Evolution.close();
    document.getElementById('dl-day').textContent   = gs.day;
    document.getElementById('dl-icon').textContent  = d.icon;
    document.getElementById('dl-title').textContent = d.title;
    document.getElementById('dl-text').textContent  = d.text;
    document.getElementById('dl-options').innerHTML = d.options.map((o, i) => `
      <button class="dl-option" data-i="${i}" ${o.affordable ? '' : 'disabled'}>
        <span class="dl-label">${o.label}</span>
        <span class="dl-note">${o.affordable ? o.note : 'Not enough DNA'}</span>
        <span class="dl-chips">${optionChips(o, gs.cureActive)}</span>
      </button>`).join('');
    if (!gs.paused) { pausedForDilemma = true; Game.setPaused(true); }
    dilemmaModal.classList.remove('hidden');
    document.body.classList.add('pm-open'); // toasts and news cards wait
    AudioEngine.sfxNewsAlert();
  }

  function closeDilemma() {
    if (dilemmaModal.classList.contains('hidden')) return;
    dilemmaModal.classList.add('hidden');
    document.body.classList.remove('pm-open');
    if (pausedForDilemma) { pausedForDilemma = false; Game.setPaused(false); }
    UI.syncPauseButton();
  }

  document.getElementById('dl-options').addEventListener('click', e => {
    const btn = e.target.closest('.dl-option');
    if (!btn || btn.disabled) return;
    if (Game.resolveDilemma(+btn.dataset.i).ok) { AudioEngine.sfxTraitPurchase(); closeDilemma(); }
  });

  // ─── ORIGIN PICKER OVERLAY ────────────────────
  function showOriginOverlay() {
    removeOverlays();

    originOverlay = document.createElement('div');
    originOverlay.className = 'origin-overlay';
    originOverlay.id = 'origin-overlay';
    originOverlay.innerHTML = `
      <div class="origin-pulse-ring"></div>
      <div class="origin-inner">
        <div class="origin-icon">☣</div>
        <h3>SELECT ORIGIN</h3>
        <p>Tap a country to place Patient Zero</p>
        <div class="origin-btns">
          <button id="btn-origin-list" class="origin-back-btn">☰ COUNTRY LIST</button>
          <button id="btn-origin-back" class="origin-back-btn">← BACK</button>
        </div>
      </div>
    `;
    document.getElementById('screen-game').appendChild(originOverlay);
    document.getElementById('btn-origin-list').addEventListener('click', openCountryList);

    document.getElementById('btn-origin-back').addEventListener('click', () => {
      removeOverlays();
      Events.cleanup();
      UI.stopRenderLoop();
      UI.showScreen('screen-setup');
    });

    if (WorldMap.setPick) WorldMap.setPick(true);
  }

  // ─── COUNTRY LIST ─────────────────────────────
  // Picking a small country by tapping a phone-sized world map is fiddly,
  // so the origin can also be chosen from a searchable list.
  const listModal  = document.getElementById('modal-countries');
  const listSearch = document.getElementById('country-search');
  const listEl     = document.getElementById('country-list');

  function renderCountryList() {
    const q = listSearch.value.trim().toLowerCase();
    const rows = Game.getAllCountries()
      .filter(c => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => b.pop - a.pop);
    listEl.innerHTML = rows.map(c => `
      <button class="country-row" data-iso="${c.iso}">
        <span class="cr-name">${c.name}</span>
        <span class="cr-meta">${UI.fmt(c.pop)} · ${c.climate} · ${c.wealth}</span>
      </button>`).join('') || '<div class="country-empty">No country matches</div>';
  }

  function openCountryList() {
    listSearch.value = '';
    renderCountryList();
    listModal.classList.remove('hidden');
  }
  function closeCountryList() { listModal.classList.add('hidden'); }

  listSearch.addEventListener('input', renderCountryList);
  document.getElementById('btn-close-countries').addEventListener('click', closeCountryList);
  listModal.addEventListener('click', e => { if (e.target === listModal) closeCountryList(); });
  listEl.addEventListener('click', e => {
    const row = e.target.closest('.country-row');
    if (!row) return;
    const iso = +row.dataset.iso;
    closeCountryList();
    WorldMap.zoomToCountry(iso, 3, 0.4);
    window.onMapCountryPick(iso, Game.getCountry(iso));
  });

  document.getElementById('btn-map-reset').addEventListener('click', () => WorldMap.resetZoom());

  // ─── KEEP THE SCREEN AWAKE WHILE PLAYING ──────
  let wakeLock = null;
  async function holdScreenAwake() {
    if (wakeLock || !('wakeLock' in navigator) || document.hidden) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch { /* denied or unsupported: not worth telling the player */ }
  }

  // Map country tap callback (registered as window hook for map.js)
  window.onMapCountryPick = function(iso, country) {
    if (Game.getState().phase !== 'idle') return;
    removeConfirm();

    confirmEl = document.createElement('div');
    confirmEl.className = 'country-confirm';
    confirmEl.innerHTML = `
      <div class="cc-name">${country.name}</div>
      <div class="cc-info">
        Pop: ${UI.fmt(country.pop)} &nbsp;•&nbsp;
        ${country.climate} &nbsp;•&nbsp; ${country.wealth}
      </div>
      <div class="cc-btns">
        <button class="cc-yes" id="cc-yes">✓ CONFIRM</button>
        <button class="cc-no"  id="cc-no">✕ CANCEL</button>
      </div>
    `;
    document.getElementById('screen-game').appendChild(confirmEl);

    WorldMap.highlightCountry(iso);

    document.getElementById('cc-yes').addEventListener('click', () => {
      removeOverlays();
      beginInfection(iso);
    });
    document.getElementById('cc-no').addEventListener('click', () => {
      removeConfirm();
    });
  };

  function beginInfection(iso) {
    if (WorldMap.setPick) WorldMap.setPick(false);
    Game.startInCountry(iso);
    holdScreenAwake();
    WorldMap.zoomToCountry(iso);
    WorldMap.setOrigin(iso);
    setTimeout(() => WorldMap.pulseCountry(iso), 500);
    Events.startNewsTicker();
    NewsPopup.reset();
  }

  // ─── ENGINE EVENTS ────────────────────────────
  // The simulation knows nothing about the page; everything it does that
  // the player should see or hear arrives here.
  const GOV_NEWS = {
    airports: c => `${c.name} grounds all international flights`,
    ports:    c => `${c.name} closes its sea ports to foreign vessels`,
    borders:  c => `${c.name} shuts its land borders`,
    lockdown: c => `${c.name} orders a national lockdown`,
    sealed:   c => `${c.name} seals itself off from the outside world`,
    collapse: c => `Reports of total government collapse in ${c.name}`,
  };

  Game.on((type, d) => {
    const gs = Game.getState();
    switch (type) {
      case 'toast':
        UI.toast(d.msg, d.type);
        break;
      case 'dna':
        UI.showDnaPopup(d.amount);
        UI.updateDnaDisplay();
        UI.checkEvoAvailable();
        if (d.amount >= 2) AudioEngine.sfxDNA();
        break;
      case 'country':
        AudioEngine.sfxNewCountry();
        WorldMap.pulseCountry(d.iso);
        WorldMap.setEntry(d.iso, d.srcIso, d.method);
        if (d.srcIso != null) WorldMap.showTravelRoute(d.srcIso, d.iso, d.method);
        break;
      case 'news':
        Events.triggerNews(d.category);
        break;
      case 'gov': {
        const c = Game.getCountry(d.iso);
        if (c && GOV_NEWS[d.kind]) UI.setNewsText(GOV_NEWS[d.kind](c));
        WorldMap.updateGovIcons();
        break;
      }
      case 'traits':
        UI.updateDnaDisplay();
        UI.checkEvoAvailable();
        Evolution.refreshTree();
        break;
      case 'step':
        WorldMap.updateColors(d.dirty);
        break;
      case 'events':
        UI.updateDock();
        break;
      case 'dilemma':
        showDilemma();
        break;
      case 'ops':
        UI.updateDnaDisplay();
        UI.checkEvoAvailable();
        break;
      case 'day':
        UI.updateDock();
        if (Evolution.isOpen()) Evolution.renderOps(); // cooldowns tick down
        Events.onTick(gs);
        if (d.day % 30 === 0) Events.onMonthTick();
        NewsPopup.check(d.day);
        break;
      case 'end':
        closeDilemma();
        d.won ? AudioEngine.sfxWin() : AudioEngine.sfxLose();
        Events.cleanup();
        NewsPopup.reset();
        setTimeout(() => UI.showGameOver(d.won, gs, d.reason), 1200);
        break;
    }
  });


  // ─── CLEANUP HELPERS ──────────────────────────
  function removeOverlays() {
    removeOriginOverlay();
    removeConfirm();
  }
  function removeOriginOverlay() {
    const el = document.getElementById('origin-overlay');
    if (el) el.remove();
    originOverlay = null;
  }
  function removeConfirm() {
    if (confirmEl) { confirmEl.remove(); confirmEl = null; }
  }

  // ─── RANDOM NAME ──────────────────────────────
  function randName() {
    const pre = ['Neo','Alpha','Omega','Sigma','Crimson','Black','Silent','Void','Shadow',
                 'Phantom','Scarlet','Azure','Pale','Iron','Dark','Venom'];
    const suf = ['Plague','Fever','Rot','Blight','Death','Creep','Worm','Flux',
                 'Tide','Storm','Rift','Decay','Pox','Shroud','Veil','Void'];
    return pre[Math.floor(Math.random() * pre.length)] + ' ' +
           suf[Math.floor(Math.random() * suf.length)];
  }

  // ─── MOBILE: PREVENT SCROLL BOUNCE ───────────
  // The page itself never scrolls. Let a touch scroll only if it started
  // inside something that genuinely can.
  function canScroll(node) {
    for (let n = node; n && n !== document.body; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight + 1) {
        const oy = getComputedStyle(n).overflowY;
        if (oy === 'auto' || oy === 'scroll') return true;
      }
    }
    return false;
  }
  document.addEventListener('touchmove', e => {
    if (e.target.type === 'range') return; // volume sliders
    if (!canScroll(e.target)) e.preventDefault();
  }, { passive: false });

  // ─── ORIENTATION ──────────────────────────────
  window.addEventListener('orientationchange', () => setTimeout(() => WorldMap.resize(), 300));

  // ─── TAB VISIBILITY ───────────────────────────
  document.addEventListener('visibilitychange', () => {
    const gs = Game.getState();
    if (document.hidden && gs.phase === 'spreading' && !gs.paused) {
      Game.setPaused(true);
      Game.saveGame();
      UI.syncPauseButton();
    } else if (!document.hidden && gs.phase === 'spreading') {
      holdScreenAwake();
    }
  });

  // ─── KEYBOARD SHORTCUTS ───────────────────────
  document.addEventListener('keydown', e => {
    const gs = Game.getState();
    if (gs.phase !== 'spreading') return;
    if (!dilemmaModal.classList.contains('hidden')) return; // a decision is pending
    if (e.key === ' ') {
      e.preventDefault();
      document.getElementById('btn-pause').click();
    }
    if (e.key === '1') document.getElementById('btn-speed1')?.click();
    if (e.key === '2') document.getElementById('btn-speed2')?.click();
    if (e.key === '3') document.getElementById('btn-speed3')?.click();
    if (e.key === 'e' || e.key === 'E') {
      if (!document.getElementById('modal-evolution').classList.contains('hidden')) {
        Evolution.close();
      } else {
        Evolution.open();
      }
    }
    if (e.key === 'Escape') {
      Evolution.close();
      UI.hideCountryPanel();
      // If paused, resume
      const pauseMenuEl = document.getElementById('pause-menu');
      if (pauseMenuEl && !pauseMenuEl.classList.contains('hidden')) {
        document.getElementById('pm-resume')?.click();
      }
    }
  });

  // ─── SPLASH PARTICLES ─────────────────────────
  // floating cell-like particles on the splash screen
  (function initSplashParticles() {
    const canvas = document.getElementById('splash-canvas');
    if (!canvas) return;
    const ctx2 = canvas.getContext('2d');
    const particles = [];
    const N = 28;

    function resize() {
      canvas.width  = canvas.offsetWidth  || window.innerWidth;
      canvas.height = canvas.offsetHeight || window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < N; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: 2 + Math.random() * 6,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -0.1 - Math.random() * 0.3,
        opacity: 0.1 + Math.random() * 0.25,
        pulse: Math.random() * Math.PI * 2,
      });
    }

    let splashRaf;
    function drawParticles() {
      const w = canvas.width, h = canvas.height;
      ctx2.clearRect(0, 0, w, h);
      const now = Date.now() * 0.001;
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.y < -20) { p.y = h + 10; p.x = Math.random() * w; }
        if (p.x < -20) p.x = w + 10;
        if (p.x > w + 20) p.x = -10;
        const alpha = p.opacity * (0.7 + 0.3 * Math.sin(now * 1.5 + p.pulse));
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx2.fillStyle = `rgba(248,81,73,${alpha})`;
        ctx2.fill();
        // draw a tiny ring around each particle
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, p.r * 2.2, 0, Math.PI * 2);
        ctx2.strokeStyle = `rgba(248,81,73,${alpha * 0.3})`;
        ctx2.lineWidth = 0.5;
        ctx2.stroke();
      }
      splashRaf = requestAnimationFrame(drawParticles);
    }
    drawParticles();

    // Stop when leaving splash
    document.getElementById('btn-start').addEventListener('click', () => {
      cancelAnimationFrame(splashRaf);
    }, { once: true });
  })();

  console.log('%c☣ PATHOGEN v3 READY ☣', 'color:#00ff41;font-size:18px;font-weight:900;text-shadow:0 0 10px #00ff41');
})();

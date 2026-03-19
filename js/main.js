/* ═══════════════════════════════════════════════
   PATHOGEN v2 - Main Entry Point
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

      const gs = Game.getState();
      // Fill stats
      document.getElementById('pm-disease-name').textContent = gs.diseaseName || 'PATHOGEN';
      const typeLabels = {
        bacteria: 'BACTERIAL STRAIN', virus: 'VIRAL STRAIN', fungus: 'FUNGAL STRAIN',
        parasite: 'PARASITIC STRAIN', prion: 'PRION STRAIN', 'nano-virus': 'SYNTHETIC NANO-VIRUS',
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
        const name = document.getElementById('disease-name')?.value.trim() || gs.diseaseName;
        startNewGame(name, gs.diseaseType, gs.difficulty);
      });

      document.getElementById('pm-main-menu')?.addEventListener('click', () => {
        hide();
        Events.cleanup();
        UI.stopRenderLoop();
        mapLoaded = false;
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
  let selectedDifficulty = 'normal';
  let mapLoaded          = false;
  let originOverlay      = null;
  let confirmEl          = null;

  // ─── SPLASH ───────────────────────────────────
  // ─── SAVE GAME DETECTION ─────────────────────
  function refreshSaveButton() {
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
    if (!Game.hasSave()) return;
    AudioEngine.init();
    AudioEngine.startMusic();
    if (!Game.loadSave()) return;
    UI.showScreen('screen-game');
    const gs = Game.getState();
    document.querySelectorAll('.speed-btn[data-speed]').forEach(b => b.classList.remove('active'));
    const sp1 = document.getElementById('btn-speed1');
    if (sp1) sp1.classList.add('active');
    const pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) { pauseBtn.textContent = '⏸'; pauseBtn.classList.remove('active'); }
    const totalEl = document.getElementById('hud-countries-total');
    if (totalEl) totalEl.textContent = Object.keys(gs.countries).length;
    UI.initSpeedButtons();
    Evolution.init();
    UI.startRenderLoop();
    if (!mapLoaded) {
      await Map.load();
      mapLoaded = true;
    } else {
      Map.updateColors();
      Map.resetZoom();
    }
    if (gs.originIso) Map.setOrigin(gs.originIso);
    NewsPopup.reset();
    if (_dayWatcher) { clearInterval(_dayWatcher); _dayWatcher = null; }
    _dayWatcher = setInterval(() => {
      const s = Game.getState();
      NewsPopup.check(s.day);
      Events.onTick(s);
    }, 800);
    Game.setPaused(false);
    Game.setSpeed(gs.speed || 1);
    const speedBtn = document.getElementById('btn-speed' + (gs.speed || 1));
    if (speedBtn) { document.querySelectorAll('.speed-btn[data-speed]').forEach(b => b.classList.remove('active')); speedBtn.classList.add('active'); }
    toast(`💾 Loaded: ${gs.diseaseName} — Day ${gs.day}`, 'info');
  });

  document.getElementById('btn-start').addEventListener('click', () => {
    AudioEngine.init();
    AudioEngine.startMusic();
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

The world holds 8.1 billion souls. None of them
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
    });
  });

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

  document.getElementById('btn-music').addEventListener('click', () => {
    const muted = AudioEngine.toggle();
    document.getElementById('btn-music').classList.toggle('muted', muted);
    document.getElementById('btn-music').textContent = muted ? '♪̶' : '♪';
  });

  document.getElementById('cp-close').addEventListener('click', () => {
    UI.hideCountryPanel();
  });


  // ─── GAME OVER ────────────────────────────────
  document.getElementById('btn-play-again').addEventListener('click', () => {
    Events.cleanup();
    const name = document.getElementById('disease-name').value.trim() || randName();
    startNewGame(name, selectedType, selectedDifficulty);
  });

  document.getElementById('btn-main-menu').addEventListener('click', () => {
    Events.cleanup();
    mapLoaded = false;
    UI.showScreen('screen-splash');
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
      codename: 'SYNTHETIC NANO-VIRUS · BIOHAZARD LEVEL 5',
      text: `This is not natural. This is manufactured. A self-replicating synthetic pathogen from a covert laboratory program that officially does not exist. You are the only person alive who knows what has been released.

Detection is instantaneous — governments begin cure research from Day 1. This is a race. You must spread faster than their response systems can coordinate.

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

  // ─── INIT NEW GAME ────────────────────────────
  async function startNewGame(name, type, difficulty) {
    // Tear down previous game
    Events.cleanup();
    UI.stopRenderLoop();
    NewsPopup.reset();
    if (_dayWatcher) { clearInterval(_dayWatcher); _dayWatcher = null; }
    removeOverlays();

    // Remove any leftover briefing overlay
    const old = document.getElementById('briefing-overlay');
    if (old) old.remove();

    // Init game logic
    Game.init({ name, type, difficulty });

    // Show game screen FIRST so map container has size
    UI.showScreen('screen-game');

    // Reset speed buttons
    document.querySelectorAll('.speed-btn[data-speed]').forEach(b => b.classList.remove('active'));
    const sp1 = document.getElementById('btn-speed1');
    if (sp1) sp1.classList.add('active');
    const pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) { pauseBtn.textContent = '⏸'; pauseBtn.classList.remove('active'); }

    // Update countries total
    const totalEl = document.getElementById('hud-countries-total');
    if (totalEl) totalEl.textContent = Object.keys(Game.getState().countries).length;

    // Wire buttons (safe to call multiple times)
    UI.initSpeedButtons();
    Evolution.init();
    UI.startRenderLoop();

    // Load map (first time only)
    if (!mapLoaded) {
      await Map.load();
      mapLoaded = true;
    } else {
      Map.updateColors();
      Map.resetZoom();
    }

    // Show disease-specific briefing, then origin picker
    await showDiseaseBriefing(type);
    showOriginOverlay();
  }

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
        <p>Click any country to place Patient Zero</p>
        <button id="btn-origin-back" class="origin-back-btn">← CHANGE PATHOGEN</button>
      </div>
    `;
    document.getElementById('screen-game').appendChild(originOverlay);

    document.getElementById('btn-origin-back').addEventListener('click', () => {
      removeOverlays();
      Events.cleanup();
      UI.stopRenderLoop();
      UI.showScreen('screen-setup');
    });

    if (typeof Map !== 'undefined' && Map.setPick) Map.setPick(true);
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

    Map.highlightCountry(iso);

    document.getElementById('cc-yes').addEventListener('click', () => {
      removeOverlays();
      beginInfection(iso);
    });
    document.getElementById('cc-no').addEventListener('click', () => {
      removeConfirm();
    });
  };

  function beginInfection(iso) {
    if (typeof Map !== 'undefined' && Map.setPick) Map.setPick(false);
    Game.startInCountry(iso);
    Map.zoomToCountry(iso);
    Map.setOrigin(iso);
    setTimeout(() => Map.pulseCountry(iso), 500);
    Events.startNewsTicker();
    NewsPopup.reset();
    startDayWatcher();
  }

  let _dayWatcher = null;
  function startDayWatcher() {
    if (_dayWatcher) clearInterval(_dayWatcher);
    _dayWatcher = setInterval(() => {
      const gs = Game.getState();
      if (gs.phase !== 'spreading') return;
      NewsPopup.check(gs.day);
    }, 3000);
  }


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
  document.addEventListener('touchmove', e => {
    const scrollable = e.target.closest(
      '.evo-tab-content, .country-list-grid, .setup-content, .modal-content, #screen-pick-country, #screen-setup, #screen-gameover'
    );
    if (!scrollable) e.preventDefault();
  }, { passive: false });

  // ─── ORIENTATION ──────────────────────────────
  window.addEventListener('orientationchange', () => setTimeout(() => Map.resize(), 300));

  // ─── TAB VISIBILITY ───────────────────────────
  document.addEventListener('visibilitychange', () => {
    const gs = Game.getState();
    if (document.hidden && gs.phase === 'spreading' && !gs.paused) {
      Game.setPaused(true);
      const pb = document.getElementById('btn-pause');
      if (pb) { pb.textContent = '▶'; pb.classList.add('active'); }
    }
  });

  // ─── KEYBOARD SHORTCUTS ───────────────────────
  document.addEventListener('keydown', e => {
    const gs = Game.getState();
    if (gs.phase !== 'spreading') return;
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
    document.getElementById('btn-how-to-play').addEventListener('click', () => {});
  })();

  console.log('%c☣ PATHOGEN v2 READY ☣', 'color:#00ff41;font-size:18px;font-weight:900;text-shadow:0 0 10px #00ff41');
})();

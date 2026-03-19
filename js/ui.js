/* ═══════════════════════════════════════════════
   PATHOGEN v2 - UI Manager
   ═══════════════════════════════════════════════ */

const UI = (() => {
  // ─── FORMAT ───────────────────────────────────
  function fmt(n) {
    n = Math.max(0, Math.floor(n));
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toString();
  }

  function pct(v) { return (Math.min(100, v * 100)).toFixed(1) + '%'; }

  // ─── SCREENS ──────────────────────────────────
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => {
      s.classList.remove('active');
      s.style.display = 'none';
    });
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.add('active');
    el.style.display = 'flex';
    // GSAP fade-in if available
    if (typeof gsap !== 'undefined') {
      gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'power2.out' });
    }
  }

  // ─── HUD UPDATE ───────────────────────────────
  function updateHud() {
    const s = Game.getStats();

    el('hud-dead',     fmt(s.totalDead));
    el('hud-infected', fmt(s.totalInfected));
    el('hud-healthy',  fmt(s.totalHealthy));
    el('hud-cure',     s.cureProgress.toFixed(1) + '%');
    el('hud-day',      s.day);
    el('hud-dna',      s.dna);
    el('hud-countries', s.countriesInfected);

    // Pulse dead counter when significant
    if (s.totalDead > 100000) {
      const deadEl = document.getElementById('hud-dead');
      if (deadEl) deadEl.style.color = '#ff0033';
    }
  }

  function updateDnaDisplay() {
    const dna = Game.getState().dna;
    el('hud-dna',       dna);
    el('evo-dna-count', dna);
  }

  function updateCureBar(pctVal) {
    const bar = document.getElementById('cure-bar');
    const lbl = document.getElementById('cure-label');
    if (!bar) return;
    bar.style.width = pctVal + '%';

    if (pctVal > 75) {
      bar.style.background = 'linear-gradient(90deg, #cc2200, #ff0000)';
      bar.style.boxShadow  = '0 0 12px rgba(255,0,0,0.9)';
      if (lbl) { lbl.textContent = '⚠ CURE CLOSE'; lbl.classList.add('visible'); }
    } else if (pctVal > 40) {
      bar.style.background = 'linear-gradient(90deg, #cc7700, #ffbb00)';
      bar.style.boxShadow  = '0 0 10px rgba(255,180,0,0.7)';
      if (lbl) { lbl.textContent = '🔬 CURE ADVANCING'; lbl.classList.add('visible'); }
    } else {
      bar.style.background = 'linear-gradient(90deg, #00aacc, #00ddff)';
      bar.style.boxShadow  = '0 0 10px rgba(0,180,255,0.8)';
      if (lbl) lbl.classList.remove('visible');
    }
  }

  function updateStatBars() {
    const gs = Game.getState();
    setBar('infectivity', gs.infectivity, 'pct-infectivity');
    setBar('severity',    gs.severity,    'pct-severity');
    setBar('lethality',   gs.lethality,   'pct-lethality');
    setBar('cureresist',  gs.cureResist,  'pct-cureresist');
  }

  function setBar(id, val, pctId) {
    const fill = document.getElementById(`bar-${id}`);
    const pctEl = document.getElementById(pctId);
    if (fill) fill.style.width = Math.min(100, val * 100) + '%';
    if (pctEl) pctEl.textContent = Math.round(val * 100) + '%';
  }

  // ─── DNA POPUP ────────────────────────────────
  let dnaPopTimer = null;
  function showDnaPopup(amount) {
    const container = document.getElementById('map-container');
    if (!container) return;

    const popup = document.createElement('div');
    popup.style.cssText = `
      position: absolute;
      left: ${12 + Math.random() * 55}%;
      top:  ${58 + Math.random() * 22}%;
      background: rgba(63,185,80,0.9);
      color: #0d1117;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 100px;
      pointer-events: none;
      z-index: 50;
      animation: dnaPop 1.2s ease-out forwards;
      white-space: nowrap;
      letter-spacing: 0.04em;
    `;
    popup.textContent = `+${amount} DNA`;

    // Inject animation if not present
    if (!document.getElementById('dna-anim-style')) {
      const style = document.createElement('style');
      style.id = 'dna-anim-style';
      style.textContent = `
        @keyframes dnaPop {
          0%   { opacity:1; transform: translateY(0) scale(1); }
          70%  { opacity:1; transform: translateY(-35px) scale(1.1); }
          100% { opacity:0; transform: translateY(-55px) scale(0.8); }
        }
      `;
      document.head.appendChild(style);
    }

    container.appendChild(popup);
    setTimeout(() => popup.remove(), 1300);
  }

  // ─── TOAST NOTIFICATIONS ──────────────────────
  const toastQueue = [];
  let toastBusy = false;

  function toast(msg, type = 'info') {
    toastQueue.push({ msg, type });
    if (!toastBusy) drainToastQueue();
  }

  function drainToastQueue() {
    if (!toastQueue.length) { toastBusy = false; return; }
    toastBusy = true;

    const { msg, type } = toastQueue.shift();
    const container = document.getElementById('toast-container');
    if (!container) { setTimeout(drainToastQueue, 50); return; }

    // Limit visible toasts
    const existing = container.querySelectorAll('.toast');
    if (existing.length >= 4) existing[0].remove();

    if (typeof AudioEngine !== 'undefined') {
      if (type === 'alert') AudioEngine.sfxAlert();
      else if (type === 'cure') AudioEngine.sfxCure();
    }
    const t = document.createElement('div');
    const typeClass = {
      info: '', warn: 'toast-warn', alert: 'toast-alert',
      cure: 'toast-cure', dna: 'toast-dna',
    }[type] || '';
    t.className = `toast ${typeClass}`.trim();
    t.textContent = msg;
    container.appendChild(t);

    // Auto-dismiss
    const delay = type === 'alert' ? 5000 : 3500;
    setTimeout(() => {
      t.classList.add('toast-out');
      setTimeout(() => { t.remove(); }, 300);
    }, delay);

    // Also update news ticker
    setNewsText(msg);

    setTimeout(drainToastQueue, 600);
  }

  // Also expose as showNotification for backwards compat
  function showNotification(msg) { toast(msg, 'info'); }

  // ─── NEWS TEXT ────────────────────────────────
  function setNewsText(msg) {
    const el = document.getElementById('news-text');
    if (!el) return;
    el.textContent = msg;
    el.style.animation = 'none';
    el.offsetHeight;  // reflow
    el.style.animation = '';
  }

  // ─── COUNTRY PANEL ────────────────────────────
  let _selectedIso = null;

  function showCountryPanel(country) {
    _selectedIso = country.iso;
    if (typeof AudioEngine !== 'undefined') AudioEngine.sfxCountryClick();
    const panel = document.getElementById('country-panel');

    // Static fields — only set once on open
    el('cp-name',       country.name);
    el('cp-pop',        fmt(country.pop));
    el('cp-climate',    country.climate.charAt(0).toUpperCase() + country.climate.slice(1));
    el('cp-wealth',     country.wealth.charAt(0).toUpperCase() + country.wealth.slice(1));
    el('cp-healthcare', Math.round(country.healthcare * 100) + '%');

    // Live fields (also refreshed by render loop)
    _refreshCpLive(country);

    panel.classList.remove('hidden');
  }

  function _refreshCpLive(country) {
    const totalAlive = country.pop - country.dead;
    const infPct     = totalAlive > 0 ? (country.infected / totalAlive) * 100 : 0;
    const deadPct    = (country.dead / country.pop) * 100;
    const healthPct  = Math.max(0, 100 - infPct - deadPct);

    el('cp-infected', fmt(country.infected));
    el('cp-dead',     fmt(country.dead));
    el('cp-healthy',  fmt(Math.max(0, country.healthy)));
    const airportStr = country.airports > 0
      ? country.airports + (country.airportClosed ? ' (CLOSED ✈)' : ' (OPEN)')
      : 'None';
    const lockStr = country.lockdown ? ' | 🔒 LOCKDOWN' : '';
    el('cp-airports', airportStr + lockStr);

    setWidth('cp-bar-inf',     Math.min(100, infPct));
    setWidth('cp-bar-dead',    Math.min(100, deadPct));
    setWidth('cp-bar-healthy', Math.min(100, healthPct));

    // Country status badge
    const statusEl = document.getElementById('cp-status');
    if (statusEl) {
      const infPct2 = country.infected / country.pop;
      const deadPct2 = country.dead / country.pop;
      let status, cls;
      if (deadPct2 > 0.5) {
        status = '💀 DEVASTATED'; cls = 'status-lost';
      } else if (infPct2 > 0.3 || deadPct2 > 0.1) {
        status = '🔴 CRITICAL'; cls = 'status-critical';
      } else if (infPct2 > 0.05) {
        status = '🟠 SPREADING'; cls = 'status-spreading';
      } else if (infPct2 > 0) {
        status = '🟡 EMERGING'; cls = 'status-emerging';
      } else {
        status = '🟢 CLEAR'; cls = 'status-clear';
      }
      statusEl.textContent = status;
      statusEl.className = 'cp-status-badge ' + cls;
    }
  }

  function hideCountryPanel() {
    _selectedIso = null;
    document.getElementById('country-panel').classList.add('hidden');
  }

  // ─── SPEED BUTTONS ────────────────────────────
  function initSpeedButtons() {
    const pauseBtn = document.getElementById('btn-pause');

    pauseBtn.onclick = () => {
      const gs = Game.getState();
      const nowPaused = !gs.paused;
      Game.setPaused(nowPaused);
      pauseBtn.textContent = nowPaused ? '▶' : '⏸';
      pauseBtn.classList.toggle('active', nowPaused);
      if (typeof AudioEngine !== 'undefined') {
        nowPaused ? AudioEngine.sfxPause() : AudioEngine.sfxUnpause();
      }
      if (typeof PauseMenu !== 'undefined') {
        if (nowPaused) PauseMenu.show();
        else           PauseMenu.hide();
      }
    };

    [1, 2, 3].forEach(s => {
      const btn = document.getElementById(`btn-speed${s}`);
      if (!btn) return;
      btn.onclick = () => {
        Game.setSpeed(s);
        document.querySelectorAll('.speed-btn[data-speed]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (Game.getState().paused) {
          Game.setPaused(false);
          pauseBtn.textContent = '⏸';
          pauseBtn.classList.remove('active');
        }
      };
    });
  }

  // ─── EVO AVAILABLE DOT ───────────────────────
  function checkEvoAvailable() {
    const gs  = Game.getState();
    const dot = document.getElementById('evo-available-dot');
    if (!dot) return;
    // Show dot if any affordable non-locked trait exists
    const allTraits = Game.getAllTraits();
    const canBuy = allTraits.some(t =>
      !gs.traits.has(t.id) &&
      t.requires.every(r => gs.traits.has(r)) &&
      gs.dna >= t.cost
    );
    dot.classList.toggle('hidden', !canBuy);
  }

  // ─── GAME OVER ────────────────────────────────
  function showGameOver(won, gs) {
    const icon  = document.getElementById('gameover-icon');
    const title = document.getElementById('gameover-title');
    const sub   = document.getElementById('gameover-subtitle');

    icon.textContent = won ? '☣' : '🔬';
    icon.className   = 'gameover-icon ' + (won ? 'win' : 'lose');
    title.textContent = won ? 'HUMANITY FALLS' : 'CURE DEPLOYED';
    title.className   = won ? 'win-title' : 'lose-title';
    sub.textContent   = won
      ? `${gs.diseaseName} has exterminated all life on Earth.`
      : `Scientists completed a cure before ${gs.diseaseName} could finish its work.`;

    el('go-days',       gs.day);
    el('go-total-inf',  fmt(gs.peakInfected));
    el('go-total-dead', fmt(gs.totalDead));
    el('go-cure',       gs.cureProgress.toFixed(1) + '%');
    el('go-countries',  gs.countriesInfected + ' / ' + Object.keys(gs.countries).length);
    el('go-dna-spent',  gs.dnaSpent);

    const scoreEl = document.getElementById('gameover-score-label');
    const gradeEl = document.getElementById('gameover-grade');

    if (won) {
      const score = Math.max(0, Math.floor(20000 - gs.day * 10 - gs.cureProgress * 30));
      scoreEl.textContent = `BIOHAZARD SCORE: ${score.toLocaleString()}`;
      scoreEl.style.color = '#ff2244';
      const grade = score > 15000 ? 'S' : score > 10000 ? 'A' : score > 6000 ? 'B' : 'C';
      gradeEl.textContent = grade;
      gradeEl.style.color = { S: '#ffdd00', A: '#00ff41', B: '#ff8c00', C: '#aaaaaa' }[grade];
    } else {
      scoreEl.textContent = 'HUMANITY SURVIVES';
      scoreEl.style.color = '#00aaff';
      gradeEl.textContent = 'F';
      gradeEl.style.color = '#00aaff';
    }

    showScreen('screen-gameover');
    // Render epidemic curve with Chart.js
    setTimeout(() => renderEpidemicChart(won), 200);
  }

  let _chartInstance = null;
  function renderEpidemicChart(won) {
    const canvas = document.getElementById('epidemic-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const history = typeof Game !== 'undefined' ? Game.getHistory() : [];
    if (!history.length) return;

    if (_chartInstance) { _chartInstance.destroy(); _chartInstance = null; }

    const labels   = history.map(d => `Day ${d.day}`);
    const infected = history.map(d => d.infected);
    const dead     = history.map(d => d.dead);

    // Thin the data if too many points
    const step = Math.max(1, Math.floor(history.length / 60));
    const thin = (arr) => arr.filter((_, i) => i % step === 0);

    _chartInstance = new Chart(canvas, {
      type: 'line',
      data: {
        labels: thin(labels),
        datasets: [
          {
            label: 'Infected',
            data: thin(infected),
            borderColor: '#e3b341',
            backgroundColor: 'rgba(227,179,65,0.08)',
            borderWidth: 1.5,
            pointRadius: 0,
            fill: true,
            tension: 0.4,
          },
          {
            label: 'Dead',
            data: thin(dead),
            borderColor: '#f85149',
            backgroundColor: 'rgba(248,81,73,0.1)',
            borderWidth: 1.5,
            pointRadius: 0,
            fill: true,
            tension: 0.4,
          },
        ],
      },
      options: {
        responsive: false,
        animation: { duration: 800, easing: 'easeInOutQuart' },
        plugins: {
          legend: {
            display: true,
            labels: { color: '#8b949e', font: { size: 10 }, boxWidth: 10, padding: 10 },
          },
          tooltip: { enabled: false },
        },
        scales: {
          x: {
            ticks: { color: '#484f58', font: { size: 9 }, maxTicksLimit: 6 },
            grid:  { color: 'rgba(255,255,255,0.04)' },
          },
          y: {
            ticks: {
              color: '#484f58', font: { size: 9 }, maxTicksLimit: 4,
              callback: v => v >= 1e9 ? (v/1e9).toFixed(1)+'B' : v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : v,
            },
            grid: { color: 'rgba(255,255,255,0.04)' },
          },
        },
      },
    });
  }

  // ─── HELPERS ──────────────────────────────────
  function el(id, val) {
    const node = document.getElementById(id);
    if (node) node.textContent = val;
  }
  function setWidth(id, pctVal) {
    const node = document.getElementById(id);
    if (node) node.style.width = pctVal + '%';
  }

  // ─── SMOOTH RENDER LOOP ───────────────────────
  let _raf  = null;
  let _disp = { dead: 0, infected: 0, healthy: 0, cure: 0 };

  function startRenderLoop() {
    // Snap display to current state so there's no initial count-up from 0
    const init = Game.getState();
    _disp.dead     = init.totalDead;
    _disp.infected = init.totalInfected;
    _disp.healthy  = init.totalHealthy;
    _disp.cure     = init.cureProgress;

    // Cache DOM refs — queried once, reused every frame
    // pause menu is handled by PauseMenu module
    const cureMilestones = new Set(); // track 25 / 50 / 75% per game

    function frame() {
      const gs = Game.getState();

      if (gs.phase === 'spreading' || gs.phase === 'won' || gs.phase === 'lost') {
        const K = 0.11;
        _disp.dead     += (gs.totalDead     - _disp.dead)     * K;
        _disp.infected += (gs.totalInfected - _disp.infected) * K;
        _disp.healthy  += (gs.totalHealthy  - _disp.healthy)  * K;
        _disp.cure     += (gs.cureProgress  - _disp.cure)     * 0.055;

        el('hud-dead',      fmt(_disp.dead));
        el('hud-infected',  fmt(_disp.infected));
        el('hud-healthy',   fmt(_disp.healthy));
        el('hud-cure',      _disp.cure.toFixed(1) + '%');
        el('hud-day',       gs.day);
        el('hud-countries', gs.countriesInfected);
        el('hud-dna',       gs.dna);
        el('evo-dna-count', gs.dna);
        updateCureBar(_disp.cure);

        if (gs.totalDead > 50000) {
          const deadEl = document.getElementById('hud-dead');
          if (deadEl) deadEl.style.color = '#ff2244';
        }

        // Daily rate display (computed from last 2 history snapshots)
        const hist = Game.getHistory();
        if (hist.length >= 2) {
          const prev = hist[hist.length - 2];
          const curr = hist[hist.length - 1];
          const infDelta  = curr.infected - prev.infected;
          const deadDelta = curr.dead     - prev.dead;
          const cureDelta = curr.cure     - prev.cure;

          const infRateEl  = document.getElementById('hud-inf-rate');
          const deadRateEl = document.getElementById('hud-dead-rate');
          const cureRateEl = document.getElementById('hud-cure-rate');

          if (infRateEl)  infRateEl.textContent  = infDelta  >= 0 ? `+${fmt(infDelta)}/d`  : `${fmt(infDelta)}/d`;
          if (deadRateEl) deadRateEl.textContent = deadDelta >= 0 ? `+${fmt(deadDelta)}/d` : '';
          if (cureRateEl && gs.cureActive) cureRateEl.textContent = cureDelta > 0 ? `+${cureDelta.toFixed(1)}%/d` : '';
          else if (cureRateEl && !gs.cureActive) cureRateEl.textContent = '';
        }

        // Stealth badge — shown when cure not yet triggered
        const stealthEl = document.getElementById('stealth-badge');
        if (stealthEl) {
          if (!gs.cureActive && gs.phase === 'spreading' && gs.totalInfected > 0) {
            stealthEl.classList.remove('hidden');
          } else {
            stealthEl.classList.add('hidden');
          }
        }

        // Cure milestone sounds at 25 / 50 / 75 %
        for (const m of [25, 50, 75]) {
          if (_disp.cure >= m && !cureMilestones.has(m)) {
            cureMilestones.add(m);
            if (typeof AudioEngine !== 'undefined') AudioEngine.sfxCureMilestone();
          }
        }

        // Update threat level bar
        const threatPct = gs.totalPop > 0
          ? Math.min(100, ((gs.totalInfected + gs.totalDead * 2) / gs.totalPop) * 100)
          : 0;
        const threatFill = document.getElementById('threat-fill');
        if (threatFill) {
          threatFill.style.width = threatPct + '%';
          // Shift gradient color based on threat level
          threatFill.style.backgroundPositionX = (100 - threatPct) + '%';
        }

        // Add has-deaths class to dead stat when deaths start
        if (gs.totalDead > 0) {
          const deadStat = document.querySelector('.dead-stat');
          if (deadStat) deadStat.classList.add('has-deaths');
        }

        // Pause menu handled by PauseMenu module
      }

      // Live country panel — refresh every frame while open
      if (_selectedIso) {
        const country = Game.getCountry(_selectedIso);
        if (country) _refreshCpLive(country);
      }

      _raf = requestAnimationFrame(frame);
    }
    if (_raf) cancelAnimationFrame(_raf);
    _raf = requestAnimationFrame(frame);
  }

  function stopRenderLoop() {
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  }

  return {
    showScreen, updateHud, updateDnaDisplay, updateCureBar,
    updateStatBars, showDnaPopup, toast, showNotification,
    showCountryPanel, hideCountryPanel, setNewsText,
    initSpeedButtons, checkEvoAvailable, showGameOver,
    startRenderLoop, stopRenderLoop, fmt, pct,
  };
})();

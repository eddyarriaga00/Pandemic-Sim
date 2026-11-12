/* ═══════════════════════════════════════════════
   PATHOGEN v3 - UI Manager
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

  // ─── HUD ──────────────────────────────────────
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

  // ─── SCREEN FLASH ─────────────────────────────
  // Brief color overlay on milestone events — high drama, low cost
  let _flashTimeout = null;
  function flashScreen(color) {
    const overlay = document.getElementById('flash-overlay');
    if (!overlay) return;
    if (_flashTimeout) { clearTimeout(_flashTimeout); overlay.style.opacity = '0'; }
    const colours = {
      red:    'rgba(248,81,73,0.18)',
      amber:  'rgba(227,179,65,0.18)',
      green:  'rgba(63,185,80,0.18)',
    };
    overlay.style.background = colours[color] || colours.red;
    overlay.style.opacity    = '1';
    overlay.style.transition = 'opacity 0s';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.style.transition = 'opacity 0.7s ease-out';
        overlay.style.opacity    = '0';
      });
    });
    _flashTimeout = setTimeout(() => { _flashTimeout = null; }, 800);
  }

  // ─── TOAST NOTIFICATIONS ──────────────────────
  const toastQueue = [];
  let toastBusy = false;

  function toast(msg, type = 'info') {
    // At high speed events can arrive faster than they can be read; keep
    // the backlog short by dropping the oldest routine messages.
    if (toastQueue.length >= 5) {
      const i = toastQueue.findIndex(t => t.type === 'info' || t.type === 'dna');
      toastQueue.splice(i === -1 ? 0 : i, 1);
    }
    toastQueue.push({ msg, type });
    if (!toastBusy) drainToastQueue();
  }

  function drainToastQueue() {
    if (!toastQueue.length) { toastBusy = false; return; }
    toastBusy = true;

    const { msg, type } = toastQueue.shift();
    const container = document.getElementById('toast-container');
    if (!container) { setTimeout(drainToastQueue, 50); return; }

    // Limit visible toasts: a phone screen has room for two
    const maxVisible = window.innerWidth <= 540 || window.innerHeight <= 500 ? 2 : 4;
    const existing = container.querySelectorAll('.toast');
    for (let i = 0; i <= existing.length - maxVisible; i++) existing[i].remove();

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

  // Drop everything queued or on screen (game over, new game).
  function clearToasts() {
    toastQueue.length = 0;
    document.getElementById('toast-container')?.replaceChildren();
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
    // Dismiss rich hover tooltip (it lingers on mobile after tap)
    const rtt = document.getElementById('map-rich-tooltip');
    if (rtt) { rtt.classList.add('hidden'); rtt.classList.remove('rtt-visible'); }
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

  // Track per-country previous snapshot for rate display
  const _cpPrev = {};

  function _refreshCpLive(country) {
    const totalAlive = country.pop - country.dead;
    const infPct     = totalAlive > 0 ? (country.infected / totalAlive) * 100 : 0;
    const deadPct    = (country.dead / country.pop) * 100;
    const healthPct  = Math.max(0, 100 - infPct - deadPct);

    el('cp-infected', fmt(country.infected));
    el('cp-dead',     fmt(country.dead));
    el('cp-healthy',  fmt(Math.max(0, country.healthy)));

    // Daily change, sampled once per game day
    const day  = Game.getState().day;
    const prev = _cpPrev[country.iso];
    if (!prev || prev.day !== day) {
      if (prev && prev.day === day - 1) {
        const dInf  = country.infected - prev.infected;
        const dDead = country.dead - prev.dead;
        el('cp-inf-rate',  dInf  > 0 ? `+${fmt(dInf)}/d`  : dInf < 0 ? `-${fmt(-dInf)}/d` : '');
        el('cp-dead-rate', dDead > 0 ? `+${fmt(dDead)}/d` : '');
      } else {
        el('cp-inf-rate', ''); el('cp-dead-rate', '');
      }
      _cpPrev[country.iso] = { day, infected: country.infected, dead: country.dead };
    }

    el('cp-airports', govSummary(country));
    el('cp-routes',   routeSummary(country));
    const trend = trendFor(country);
    const trendEl = document.getElementById('cp-trend');
    if (trendEl) { trendEl.textContent = trend.text; trendEl.style.color = trend.color; }

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

  // ─── COUNTRY SUMMARIES (panel + tooltip) ──────
  function govSummary(c) {
    if (c.collapsed) return 'Collapsed';
    const parts = [];
    if (c.lockdown)      parts.push('Lockdown');
    if (c.borderClosed)  parts.push('Borders shut');
    if (c.airportClosed && c.airports > 0) parts.push('No flights');
    if (c.portClosed && c.ports > 0)       parts.push('Ports shut');
    return parts.length ? parts.join(' · ') : 'Open';
  }

  function routeSummary(c) {
    const parts = [];
    if (c.airports > 0) parts.push(`✈ ${c.airports}`);
    if (c.ports > 0)    parts.push(`⚓ ${c.ports}`);
    parts.push(`🛣 ${c.borders.length}`);
    return parts.join('  ');
  }

  // Is the outbreak in this country growing or killing itself off?
  function trendFor(c) {
    if (c.infected <= 0) {
      if (c.dead > 0 && c.healthy > 0) return { text: 'Died out, survivors remain', color: 'var(--blue)' };
      return { text: c.healthy > 0 ? 'Not infected' : 'No survivors', color: 'var(--tx-2)' };
    }
    if (c.healthy <= 0) return { text: 'Everyone infected', color: 'var(--amber)' };
    const r = Game.reproductionFor(c);
    if (r === Infinity) return { text: 'Spreading freely', color: 'var(--green)' };
    if (r >= 1.5)       return { text: `Growing (R ${r.toFixed(1)})`, color: 'var(--green)' };
    if (r >= 1)         return { text: `Barely growing (R ${r.toFixed(1)})`, color: 'var(--amber)' };
    return { text: `Burning out (R ${r.toFixed(1)})`, color: 'var(--red)' };
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

  function syncPauseButton() {
    const btn = document.getElementById('btn-pause');
    if (!btn) return;
    const paused = Game.getState().paused;
    btn.textContent = paused ? '▶' : '⏸';
    btn.classList.toggle('active', paused);
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
  function showGameOver(won, gs, reason) {
    const icon  = document.getElementById('gameover-icon');
    const title = document.getElementById('gameover-title');
    const sub   = document.getElementById('gameover-subtitle');

    icon.textContent = won ? '☣' : '🔬';
    icon.className   = 'gameover-icon ' + (won ? 'win' : 'lose');
    const burnout = reason === 'burnout';
    if (burnout) icon.textContent = '🕯';
    title.textContent = won ? 'HUMANITY FALLS' : burnout ? 'PATHOGEN EXTINCT' : 'CURE DEPLOYED';
    title.className   = won ? 'win-title' : 'lose-title';
    sub.textContent   = won
      ? `${gs.diseaseName} has wiped out the human race.`
      : burnout
        ? `${gs.diseaseName} killed its last host while ${fmt(gs.totalHealthy)} people were still uninfected.`
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
      const diffBonus = { mild: 0.7, standard: 1, severe: 1.4, extinction: 2 }[gs.difficulty] || 1;
      const score = Math.max(0, Math.floor((20000 - gs.day * 14 - gs.cureProgress * 60) * diffBonus));
      scoreEl.textContent = `BIOHAZARD SCORE: ${score.toLocaleString()}`;
      scoreEl.style.color = '#ff2244';
      const grade = score > 15000 ? 'S' : score > 10000 ? 'A' : score > 6000 ? 'B' : 'C';
      gradeEl.textContent = grade;
      gradeEl.style.color = { S: '#ffdd00', A: '#00ff41', B: '#ff8c00', C: '#aaaaaa' }[grade];
      if (Records.save(gs, score, grade)) scoreEl.textContent += '  ★ NEW BEST';
    } else {
      scoreEl.textContent = `HUMANITY SURVIVES: ${fmt(gs.totalHealthy)} ALIVE`;
      scoreEl.style.color = '#00aaff';
      gradeEl.textContent = 'F';
      gradeEl.style.color = '#00aaff';
    }

    clearToasts();
    showScreen('screen-gameover');
    // Render epidemic curve with Chart.js
    setTimeout(() => renderEpidemicChart(won), 200);
  }

  let _chartInstance = null;
  function renderEpidemicChart(won) {
    const canvas = document.getElementById('epidemic-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const history = Game.getHistory();
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
  // The render loop calls these every frame. Only touch the DOM when the
  // value actually changed, so idle frames cost nothing (matters on phones).
  const _nodes = {}, _lastText = {}, _lastWidth = {};
  function node(id) { return _nodes[id] || (_nodes[id] = document.getElementById(id)); }
  function el(id, val) {
    val = String(val);
    if (_lastText[id] === val) return;
    const n = node(id);
    if (n) { n.textContent = val; _lastText[id] = val; }
  }
  function setWidth(id, pctVal) {
    const w = pctVal.toFixed(2) + '%';
    if (_lastWidth[id] === w) return;
    const n = node(id);
    if (n) { n.style.width = w; _lastWidth[id] = w; }
  }

  // ─── TOP INFECTED COUNTRIES ───────────────────
  let _topCountriesFrames = 0;
  function updateTopCountries() {
    const panel = document.getElementById('top-countries-list');
    if (!panel) return;
    const gs = Game.getState();
    if (gs.phase !== 'spreading') return;

    const sorted = Game.getAllCountries()
      .filter(c => c.reached && c.infected > 0)
      .sort((a, b) => (b.infected + b.dead) - (a.infected + a.dead))
      .slice(0, 5);

    const html = sorted.map(c => {
      const infPct = (c.infected / c.pop * 100).toFixed(0);
      const dead   = c.dead > 0 ? ` ☠${fmt(c.dead)}` : '';
      const lockIcon = c.collapsed ? ' 🏚' : c.lockdown ? ' 🔒' : c.airportClosed ? ' ✈' : '';
      return `<button class="top-country-row" data-iso="${c.iso}">
        <span class="tc-name">${c.name}${lockIcon}</span>
        <span class="tc-stats"><span class="tc-inf">${fmt(c.infected)}</span><span class="tc-dead">${dead}</span></span>
        <div class="tc-bar-wrap"><div class="tc-bar-inf" style="width:${Math.min(100, infPct)}%"></div></div>
      </button>`;
    }).join('') || '<div class="dock-empty">No outbreaks yet</div>';
    if (html !== _lastTopHtml) { panel.innerHTML = html; _lastTopHtml = html; }
  }
  let _lastTopHtml = '';

  // ─── DASHBOARD ────────────────────────────────
  function initDock() {
    const dock = document.getElementById('dock');
    if (!dock || dock.dataset.ready) return;
    dock.dataset.ready = '1';
    dock.querySelectorAll('.dock-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        dock.querySelectorAll('.dock-tab').forEach(t => t.classList.toggle('active', t === tab));
        for (const name of ['world', 'hot', 'events']) {
          document.getElementById('dock-' + name).classList.toggle('hidden', name !== tab.dataset.dock);
        }
        if (tab.dataset.dock === 'world') drawSpark();
      });
    });
    // Hotspot rows jump to that country
    document.getElementById('top-countries-list').addEventListener('click', e => {
      const row = e.target.closest('.top-country-row');
      if (row) WorldMap.focusCountry(+row.dataset.iso);
    });
    window.addEventListener('resize', () => setTimeout(drawSpark, 200));
  }

  // Live epidemic curve: infected and dead as a share of the world,
  // cure progress on its own 0 to 100% scale.
  function drawSpark() {
    const canvas = document.getElementById('spark');
    if (!canvas || !canvas.clientWidth) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h / 2 + 0.5); ctx.lineTo(w, h / 2 + 0.5); ctx.stroke();

    const hist = Game.getHistory();
    if (hist.length < 2) return;
    const pop  = Game.getState().totalPop;
    const step = Math.max(1, Math.floor(hist.length / w));
    const line = (valueOf, color, fill) => {
      ctx.beginPath();
      let lastX = 0;
      for (let i = 0; i < hist.length; i += step) {
        const x = lastX = (i / (hist.length - 1)) * w;
        const y = h - 1 - valueOf(hist[i]) * (h - 3);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
      if (fill) { ctx.lineTo(lastX, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); }
    };
    line(d => d.infected / pop, '#e3b341', 'rgba(227,179,65,0.10)');
    line(d => d.dead / pop,     '#f85149', 'rgba(248,81,73,0.14)');
    line(d => d.cure / 100,     '#58a6ff');
  }

  const EFFECT_TEXT = [
    ['infectivityBoost', v => `+${Math.round(v * 100)}% spread`],
    ['travelMult',       v => `travel ×${v}`],
    ['cureResist',       v => `cure −${Math.round(v * 100)}%`],
    ['lethalityBoost',   () => 'more deaths'],
    ['severityMask',     () => 'symptoms hidden'],
    ['climateBoost',     () => 'climate shift'],
  ];
  const pretty = id => id.replace(/^op_/, '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

  function updateDock() {
    const gs = Game.getState();
    const a  = gs.advice;
    el('ds-sealed', a.sealed); el('ds-lock', a.lockdowns);
    el('ds-collapsed', a.collapsed); el('ds-burning', a.burning);
    document.getElementById('ds-burning')?.parentElement.classList.toggle('warn', a.burning >= 3);

    const list = document.getElementById('dock-events-list');
    if (list) {
      const html = gs.activeEvents.map(ev => {
        const fx = EFFECT_TEXT.filter(([k]) => ev.effect[k]).map(([k, f]) => f(ev.effect[k])).join(' · ');
        const mine = ev.id.startsWith('op_');
        return `<div class="dock-event${mine ? ' mine' : ''}">
          <span class="de-name">${ev.name || pretty(ev.id)}</span>
          <span class="de-fx">${fx}</span>
          <span class="de-days">${ev.remaining}d</span>
        </div>`;
      }).join('') || '<div class="dock-empty">Nothing in effect. World events and your operations show up here.</div>';
      if (list.dataset.html !== html) { list.innerHTML = html; list.dataset.html = html; }
    }
    const count = document.getElementById('dock-events-count');
    if (count) { count.textContent = gs.activeEvents.length; count.classList.toggle('hidden', !gs.activeEvents.length); }

    if (!document.getElementById('dock-world').classList.contains('hidden')) drawSpark();
  }

  // ─── RECORDS ──────────────────────────────────
  // Best winning run per pathogen type and difficulty, kept on this device.
  const RECORDS_KEY = 'pathogen_records_v1';
  const Records = {
    all() { try { return JSON.parse(localStorage.getItem(RECORDS_KEY)) || {}; } catch { return {}; } },
    get(type, difficulty) { return this.all()[type + '|' + difficulty] || null; },
    // Returns true if this run beat the previous best.
    save(gs, score, grade) {
      const all = this.all(), key = gs.diseaseType + '|' + gs.difficulty;
      const prev = all[key];
      const wins = (prev ? prev.wins : 0) + 1;
      const better = !prev || score > prev.score;
      all[key] = better ? { score, grade, days: gs.day, wins } : { ...prev, wins };
      try { localStorage.setItem(RECORDS_KEY, JSON.stringify(all)); } catch {}
      return better;
    },
  };

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

      {
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

        // Daily change
        const r = gs.rates;
        el('hud-inf-rate',  r.infected > 0 ? `+${fmt(r.infected)}/d` : r.infected < 0 ? `-${fmt(-r.infected)}/d` : '');
        el('hud-dead-rate', r.dead > 0 ? `+${fmt(r.dead)}/d` : '');
        el('hud-cure-rate', gs.cureActive && r.cure > 0 ? `+${r.cure.toFixed(2)}%/d` : '');

        // Detection meter: how close the world is to noticing
        const meter = document.getElementById('detect-meter');
        if (meter) {
          const detected = gs.cureActive;
          meter.classList.toggle('detected', detected);
          el('detect-label', detected ? 'IDENTIFIED' : `UNDETECTED ${Math.round(gs.detection * 100)}%`);
          setWidth('detect-fill', detected ? 100 : gs.detection * 100);
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

        // Top infected countries panel (every ~60 frames)
        _topCountriesFrames = (_topCountriesFrames + 1) % 60;
        if (_topCountriesFrames === 0) updateTopCountries();

        // Feed cure progress into audio tension system
        if (_topCountriesFrames === 30 && typeof AudioEngine !== 'undefined') {
          AudioEngine.setTension(gs.cureProgress / 100);
        }

        // Cure bar urgency pulse when >80%
        const cureBarEl = document.getElementById('cure-bar');
        if (cureBarEl) {
          if (_disp.cure > 80) {
            cureBarEl.classList.add('cure-critical');
          } else {
            cureBarEl.classList.remove('cure-critical');
          }
        }
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

  // Clear anything a previous game left on the HUD.
  function resetHud() {
    document.querySelector('.dead-stat')?.classList.remove('has-deaths');
    ['hud-inf-rate', 'hud-dead-rate', 'hud-cure-rate', 'cp-inf-rate', 'cp-dead-rate'].forEach(id => el(id, ''));
    for (const k in _cpPrev) delete _cpPrev[k];
    _lastTopHtml = '';
    const list = document.getElementById('top-countries-list');
    if (list) list.innerHTML = '';
    initDock();
    updateDock();
    hideCountryPanel();
    clearToasts();
    updateCureBar(0);
    setNewsText('Monitoring global health conditions...');
    checkEvoAvailable();
  }

  function stopRenderLoop() {
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  }

  return {
    showScreen, updateDnaDisplay, updateCureBar,
    updateStatBars, showDnaPopup, toast, showNotification,
    showCountryPanel, hideCountryPanel, setNewsText,
    initSpeedButtons, checkEvoAvailable, showGameOver,
    startRenderLoop, stopRenderLoop, fmt, pct,
    flashScreen, updateTopCountries, resetHud, clearToasts, syncPauseButton,
    updateDock, Records, govSummary, trendFor,
  };
})();

/* ═══════════════════════════════════════════════
   PATHOGEN v3 - News ticker & milestones
   (World events themselves live in the engine: see WORLD_EVENTS in data.js)
   ═══════════════════════════════════════════════ */

const Events = (() => {
  let newsTimer    = null;
  let newsPool     = [];
  let newsIndex    = 0;

  // ─── MILESTONE TRACKING ───────────────────────
  const _milestones = {
    infected:  new Set(),
    dead:      new Set(),
    countries: new Set(),
    dna:       new Set(),
  };

  const INF_MILESTONES = [
    { val: 1e6,   msg: '🌍 1 million people infected worldwide',              type: 'alert' },
    { val: 10e6,  msg: '🌍 10 million infected — outbreak accelerating',      type: 'alert' },
    { val: 100e6, msg: '🌍 100 million infected — global pandemic confirmed',  type: 'alert' },
    { val: 500e6, msg: '🌍 500 million infected — half a billion souls',       type: 'alert' },
    { val: 1e9,   msg: '🌍 1 BILLION infected — civilisation under siege',    type: 'alert' },
    { val: 3e9,   msg: '🌍 3 BILLION — the majority of humanity is infected',  type: 'alert' },
    { val: 6e9,   msg: '🌍 6 BILLION — almost all of humanity is infected',   type: 'alert' },
  ];

  const DEAD_MILESTONES = [
    { val: 100000, msg: '☠ 100,000 deaths confirmed globally',                           type: 'alert' },
    { val: 1e6,    msg: '☠ 1 million dead — world leaders declare day of mourning',      type: 'alert' },
    { val: 10e6,   msg: '☠ 10 million dead — worse than any war in human history',       type: 'alert' },
    { val: 100e6,  msg: '☠ 100 million dead — civilisation fracturing at its seams',     type: 'alert' },
    { val: 500e6,  msg: '☠ 500 million dead — the Great Die-Off has begun',              type: 'alert' },
    { val: 1e9,    msg: '☠ 1 BILLION dead — extinction protocol begins',                 type: 'alert' },
    { val: 4e9,    msg: '☠ Over half of humanity has perished',                          type: 'alert' },
    { val: 7e9,    msg: '☠ The last broadcasts fade. Silence covers the Earth.',         type: 'alert' },
  ];

  // ─── NEWS TEMPLATES ───────────────────────────
  const TEMPLATES = {
    early: [
      'Health officials report unusual illness cluster in {country}',
      'Doctors puzzled by mysterious symptoms in {country}',
      'WHO monitors unidentified pathogen detected in {country}',
      'Local hospitals see unexplained admissions surge in {country}',
      '{country}: patients admitted with unknown fever-like illness',
      'Epidemiologists warn of "concerning" new reports from {country}',
      'Unexplained pathogen appears resistant to standard treatment in {country}',
    ],
    spreading: [
      '{country} declares public health emergency',
      'Pathogen now detected in {count} countries',
      'Global infection count passes {number}',
      'Airlines implement passenger screening at {count} airports',
      'Schools close in multiple cities across {country}',
      'Stock markets tumble on pandemic fears',
      'WHO raises global alert level to highest tier',
      'Travel advisories issued for {country} and surrounding regions',
      '{country} announces emergency quarantine measures',
      'Border crossings restricted between {country} and neighbours',
      'Military deployed to enforce health checkpoints in {country}',
      'Supermarket shelves emptying across {country} as panic spreads',
      'Scientists struggling to characterise unusual pathogen properties',
      'UN convenes emergency session — {count} nations represented',
      'International travel down 60% as governments restrict movement',
      '{country} declares state of emergency — civil liberties suspended',
      'Hospitals turning away non-critical patients in {country}',
      'ICU capacity exceeded in {count} countries simultaneously',
      'Scientists warn new variant could be even more transmissible',
      'Contact tracing abandoned in {country} — too many cases to track',
    ],
    cure: [
      'Breakthrough made in understanding pathogen genome structure',
      'Promising drug candidate enters human trial phase',
      'Emergency funding allocated for cure research worldwide',
      'International lab collaboration accelerates cure timeline',
      'Cure research {pct}% complete — scientists cautiously optimistic',
      '{country} contributes $4B to global cure effort',
      'Lab results show partial efficacy against pathogen',
      'Race against time: cure teams working 24-hour shifts',
      'WHO announces new cure taskforce across {count} nations',
      'Controversial fast-track approval sought for experimental treatment',
      'Cure trials show 40% efficacy — researchers push for more funding',
      'Phase 3 trials begin with {number} volunteer participants worldwide',
    ],
    lethality: [
      'Death toll climbs past {number} worldwide',
      'Morgues overwhelmed in {country} — mass burials begin',
      'Healthcare system on verge of collapse in {country}',
      'Power grid failures reported in {country} as workers die',
      'Last government broadcasts going dark in {country}',
      'Satellite images show mass exodus from major cities',
      'Looting reported across {country} as order breaks down',
      'Military enforces shoot-on-sight curfew in {country}',
      'Internet connectivity failing as infrastructure collapses',
      'Emergency services non-functional in {count} major cities',
      'Food distribution networks collapse — famine fears in {country}',
      'Final transmission from {country}: "God help us all"',
      'Riots in {country} as citizens demand government action',
      'Mass grave sites visible in satellite imagery over {country}',
      'Water treatment plants shut down — disease vectors multiply in {country}',
    ],
    events: [
      'International aid flights suspended indefinitely',
      'Conspiracy theories spreading faster than the disease',
      'Doomsday preppers claim vindication from undisclosed bunkers',
      '"This is fine" meme resurfaces as civilization crumbles',
      'Scientists discover pathogen is evolving faster than expected',
      'Last known social media post: "anyone else feeling ok?"',
      'WHO emergency session ends without consensus',
      'Population density accelerating urban spread patterns',
      'Cold weather front may slow spread in northern hemispheres',
      'Underground bunkers selling out across wealthy nations',
      '{country} government declares national state of emergency',
      'Curfew imposed across {count} major cities',
      'Supply chain disruptions leave hospitals without PPE',
      'Black markets emerge for unproven treatments in {country}',
      'Satellite imagery reveals mass graves near {country} cities',
      'Global GDP projected to fall 22% — economists alarmed',
      'Last commercial flight lands as airports worldwide go dark',
      'Billionaires reportedly evacuated to private islands',
      'Religious pilgrimages blamed for accelerating spread to {country}',
      'Global internet traffic down 30% as servers go unmaintained',
      'Amateur radio operators become last communication link in {country}',
      'Major cities now ghost towns — surveillance footage goes viral',
      '"Patient Zero" identified in {country} — family unreachable',
      'Pharmaceutical company announces cure breakthrough — shares surge',
      'Blackout zones expanding across {country} as grid fails',
    ],
  };

  // ─── ON TICK: MILESTONES ──────────────────────
  function onTick(gs) {
    if (!gs || gs.phase !== 'spreading') return;

    // Infection milestones
    for (const m of INF_MILESTONES) {
      if (!_milestones.infected.has(m.val) && gs.totalInfected >= m.val) {
        _milestones.infected.add(m.val);
        UI.toast(m.msg, m.type);
        UI.flashScreen('red');
        triggerNews('spreading');
      }
    }

    // Death milestones
    for (const m of DEAD_MILESTONES) {
      if (!_milestones.dead.has(m.val) && gs.totalDead >= m.val) {
        _milestones.dead.add(m.val);
        UI.toast(m.msg, m.type);
        UI.flashScreen('red');
        if (gs.totalDead >= 1e6) triggerNews('lethality');
      }
    }

    // Country infection milestones
    const totalCountries = Object.keys(gs.countries).length;
    if (totalCountries > 0) {
      const infectedPct = gs.countriesInfected / totalCountries;
      const countryMilestones = [
        { pct: 0.25, key: 25,  dna: 2,  msg: n => `🌐 ${n} now in 25% of the world's nations` },
        { pct: 0.50, key: 50,  dna: 3,  msg: n => `🌐 ${n} detected in half the world — containment failing` },
        { pct: 0.75, key: 75,  dna: 4, msg: n => `🌐 ${n} in 75% of nations — is anything left to stop it?` },
        { pct: 1.00, key: 100, dna: 6, msg: n => `🌐 ${n} has reached EVERY NATION ON EARTH` },
      ];
      for (const m of countryMilestones) {
        if (!_milestones.countries.has(m.key) && infectedPct >= m.pct) {
          _milestones.countries.add(m.key);
          UI.toast(m.msg(gs.diseaseName), 'alert');
          UI.flashScreen('red');
          Game.awardDna(m.dna);
          triggerNews('events');
        }
      }
    }

    // Cure milestones (toast only, audio handled by render loop)
    const cureCheck = [
      { pct: 25,  key: 'c25',  msg: '🔬 Cure 25% complete — scientists gaining ground' },
      { pct: 50,  key: 'c50',  msg: '🔬 Cure 50% complete — humanity fights back' },
      { pct: 75,  key: 'c75',  msg: '🔬 CURE 75% — deploy resistance upgrades NOW' },
      { pct: 90,  key: 'c90',  msg: '⚠ CURE 90% — critical window closing fast!' },
    ];
    for (const m of cureCheck) {
      if (!_milestones.dna.has(m.key) && gs.cureProgress >= m.pct) {
        _milestones.dna.add(m.key);
        UI.toast(m.msg, 'cure');
        triggerNews('cure');
      }
    }
  }

  // After loading a save: mark everything already passed as seen, silently.
  function syncMilestones(gs) {
    resetMilestones();
    for (const m of INF_MILESTONES)  if (gs.totalInfected >= m.val) _milestones.infected.add(m.val);
    for (const m of DEAD_MILESTONES) if (gs.totalDead >= m.val)     _milestones.dead.add(m.val);
    const share = gs.countriesInfected / Object.keys(gs.countries).length;
    for (const k of [25, 50, 75, 100]) if (share >= k / 100) _milestones.countries.add(k);
    for (const k of [25, 50, 75, 90])  if (gs.cureProgress >= k) _milestones.dna.add('c' + k);
  }

  function resetMilestones() {
    _milestones.infected.clear();
    _milestones.dead.clear();
    _milestones.countries.clear();
    _milestones.dna.clear();
  }

  // ─── START TICKER ─────────────────────────────
  function startNewsTicker() {
    buildPool();

    if (newsTimer) clearInterval(newsTimer);
    newsTimer = setInterval(() => {
      if (Game.getState().paused) return;
      buildPool();
      if (!newsPool.length) return;
      const item = newsPool[newsIndex % newsPool.length];
      newsIndex++;
      UI.setNewsText(item);
    }, 3500);
  }

  function buildPool() {
    newsPool = [];
    const gs = Game.getState();
    const countries = Object.values(gs.countries).filter(c => c.reached);
    const rc = () => {
      if (!countries.length) return 'the world';
      return countries[Math.floor(Math.random() * countries.length)].name;
    };
    const fill = t => t
      .replace(/{country}/g, rc())
      .replace(/{count}/g,   Math.max(1, countries.length))
      .replace(/{number}/g,  UI.fmt(gs.totalInfected + gs.totalDead))
      .replace(/{pct}/g,     gs.cureProgress.toFixed(0));

    // Until the disease is identified the world has no idea anything is
    // wrong, so the ticker only carries vague local reports.
    if (!gs.cureActive) {
      TEMPLATES.early.forEach(t => newsPool.push(fill(t)));
    } else {
      if (gs.totalDead > 10000) TEMPLATES.lethality.forEach(t => newsPool.push(fill(t)));
      if (gs.cureProgress > 0)  TEMPLATES.cure.forEach(t => newsPool.push(fill(t)));
      TEMPLATES.spreading.forEach(t => newsPool.push(fill(t)));
      TEMPLATES.events.forEach(t => newsPool.push(fill(t)));
    }
    // Shuffle to avoid repetitive ordering
    for (let i = newsPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newsPool[i], newsPool[j]] = [newsPool[j], newsPool[i]];
    }
  }

  // ─── TRIGGER NEWS ─────────────────────────────
  function triggerNews(category) {
    const gs = Game.getState();
    const templates = TEMPLATES[gs.cureActive ? category : 'early'];
    if (!templates) return;
    const countries = Object.values(gs.countries).filter(c => c.reached);
    const rc = () => countries.length ? countries[Math.floor(Math.random() * countries.length)].name : 'an unknown region';
    const t = templates[Math.floor(Math.random() * templates.length)];
    UI.setNewsText(
      t.replace(/{country}/g, rc())
       .replace(/{count}/g,   Math.max(1, countries.length))
       .replace(/{number}/g,  UI.fmt(gs.totalInfected + gs.totalDead))
       .replace(/{pct}/g,     gs.cureProgress.toFixed(0))
    );
  }

  // ─── MONTHLY EVENTS ───────────────────────────
  function onMonthTick() {
    const gs = Game.getState();
    if (gs.phase !== 'spreading') return;

    const infPct  = gs.totalInfected / gs.totalPop;
    const deadPct = gs.totalDead    / gs.totalPop;

    if (infPct > 0.5 && deadPct < 0.01) {
      UI.toast('🌍 Half the world now infected with ' + gs.diseaseName, 'alert');
      triggerNews('spreading');
    } else if (deadPct > 0.1) {
      UI.toast('☠ ' + UI.fmt(gs.totalDead) + ' confirmed dead worldwide', 'alert');
      triggerNews('lethality');
    } else if (gs.countriesInfected === Object.keys(gs.countries).length) {
      UI.toast('🌐 ' + gs.diseaseName + ' has reached every nation on Earth', 'alert');
    }

    if (Math.random() < 0.5) triggerNews('events');
  }

  // ─── CLEANUP ──────────────────────────────────
  function cleanup() {
    if (newsTimer)  { clearInterval(newsTimer);  newsTimer  = null; }
    newsPool  = [];
    newsIndex = 0;
    resetMilestones();
  }

  return { startNewsTicker, triggerNews, onMonthTick, onTick, syncMilestones, cleanup };
})();

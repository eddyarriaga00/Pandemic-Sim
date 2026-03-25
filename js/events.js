/* ═══════════════════════════════════════════════
   PATHOGEN v2 - Events & News System
   ═══════════════════════════════════════════════ */

const Events = (() => {
  let newsTimer    = null;
  let eventTimer   = null;
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
      'Stock markets tumble on pandemic fears — Dow drops 8%',
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
        { pct: 0.25, key: 25,  dna: 3,  msg: n => `🌐 ${n} now in 25% of the world's nations` },
        { pct: 0.50, key: 50,  dna: 6,  msg: n => `🌐 ${n} detected in half the world — containment failing` },
        { pct: 0.75, key: 75,  dna: 10, msg: n => `🌐 ${n} in 75% of nations — is anything left to stop it?` },
        { pct: 1.00, key: 100, dna: 15, msg: n => `🌐 ${n} has reached EVERY NATION ON EARTH` },
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

  function resetMilestones() {
    _milestones.infected.clear();
    _milestones.dead.clear();
    _milestones.countries.clear();
    _milestones.dna.clear();
  }

  // ─── RANDOM EVENTS ────────────────────────────
  const WORLD_EVENTS = [
    // Climate events
    {
      id:   'cold_snap',
      msg:  '❄️ Cold snap across northern hemisphere — disease surges in cold climates!',
      type: 'warn',
      effect: { climateBoost: { cold: 0.55, tropical: -0.30 }, duration: 90 },
      prob: 0.0008,
    },
    {
      id:   'heat_wave',
      msg:  '🌡 Extreme heat wave — disease thrives in arid zones, retreats from cold!',
      type: 'warn',
      effect: { climateBoost: { arid: 0.50, cold: -0.28 }, duration: 90 },
      prob: 0.0008,
    },
    {
      id:   'monsoon_season',
      msg:  '🌧 Monsoon season boosts waterborne spread across tropical regions',
      type: 'warn',
      effect: { climateBoost: { tropical: 0.40 }, duration: 80 },
      prob: 0.0007,
    },
    // Mutation events
    {
      id:   'mutation_burst',
      msg:  '🧬 Spontaneous mutation detected — infectivity temporarily spiked!',
      type: 'alert',
      effect: { infectivityBoost: 0.06, duration: 55 },
      prob: 0.002,
      types: ['virus'],
    },
    {
      id:   'antigenic_shift',
      msg:  '🧬 Antigenic shift — immune systems worldwide have no prior defence',
      type: 'alert',
      effect: { infectivityBoost: 0.08, cureResist: 0.06, duration: 70 },
      prob: 0.0008,
      types: ['virus'],
    },
    {
      id:   'genetic_drift',
      msg:  '🧬 Spontaneous genetic drift — pathogen evolves favourable adaptation (+4 DNA)',
      type: 'dna',
      effect: { dnaBonus: 4, duration: 0 },
      prob: 0.0012,
    },
    {
      id:   'dna_windfall',
      msg:  '⚡ Rapid viral replication detected — genetic windfall! (+6 DNA)',
      type: 'dna',
      effect: { dnaBonus: 6, duration: 0 },
      prob: 0.0007,
    },
    {
      id:   'host_adaptation',
      msg:  '⚡ Pathogen adapts more efficiently to human hosts (+5 DNA)',
      type: 'dna',
      effect: { dnaBonus: 5, duration: 0 },
      prob: 0.0009,
    },
    // Government/social events
    {
      id:   'flight_ban',
      msg:  '✈️ International flight bans imposed — travel reduced globally',
      type: 'warn',
      effect: { travelMult: 0.6, duration: 120 },
      prob: 0.0015,
    },
    {
      id:   'mass_protest',
      msg:  '👥 Mass protests against lockdowns increase transmission!',
      type: 'alert',
      effect: { infectivityBoost: 0.05, duration: 50 },
      prob: 0.002,
    },
    {
      id:   'media_panic',
      msg:  '📺 24/7 media coverage triggers mass hysteria and social breakdown',
      type: 'alert',
      effect: { infectivityBoost: 0.04, duration: 40 },
      prob: 0.002,
    },
    {
      id:   'political_paralysis',
      msg:  '🏛️ Political gridlock delays global response — cure research stalls',
      type: 'warn',
      effect: { cureResist: 0.09, duration: 60 },
      prob: 0.0012,
    },
    {
      id:   'failed_quarantine',
      msg:  '😷 Quarantine zones breached — containment measures collapse in multiple cities',
      type: 'alert',
      effect: { infectivityBoost: 0.07, travelMult: 1.3, duration: 45 },
      prob: 0.001,
    },
    {
      id:   'refugee_crisis',
      msg:  '🚶 Mass refugee movements spread pathogen to new regions',
      type: 'alert',
      effect: { travelMult: 1.35, duration: 60 },
      prob: 0.001,
    },
    {
      id:   'overcrowded_camps',
      msg:  '🏕 Overcrowded refugee camps become disease hotspots — spread accelerates',
      type: 'alert',
      effect: { infectivityBoost: 0.06, duration: 50 },
      prob: 0.001,
    },
    // Research/medical events
    {
      id:   'who_summit',
      msg:  '🌐 Emergency WHO summit coordinates global response — cure speeds up',
      type: 'cure',
      effect: { cureBoost: 15, duration: 0 },
      prob: 0.0008,
    },
    {
      id:   'vaccine_trial_fail',
      msg:  '💉 Promising vaccine candidate fails phase 3 trials — setback for science',
      type: 'warn',
      effect: { cureResist: 0.08, duration: 50 },
      prob: 0.001,
    },
    {
      id:   'antibiotic_fail',
      msg:  '💊 Standard treatments found completely ineffective — cure slows',
      type: 'alert',
      effect: { cureResist: 0.12, duration: 80 },
      prob: 0.001,
    },
    {
      id:   'black_market_cure',
      msg:  '🧪 Underground labs synthesise partial cure — small boost to research',
      type: 'cure',
      effect: { cureBoost: 8, duration: 0 },
      prob: 0.0006,
    },
    {
      id:   'anti_vax_movement',
      msg:  '📢 Anti-vaccine movement surges — public trust in medicine collapses',
      type: 'warn',
      effect: { cureResist: 0.10, duration: 70 },
      prob: 0.001,
    },
    {
      id:   'international_cooperation',
      msg:  '🤝 Unprecedented global cooperation — cure research significantly accelerated',
      type: 'cure',
      effect: { cureBoost: 12, duration: 0 },
      prob: 0.0007,
    },
    {
      id:   'lab_explosion',
      msg:  '💥 Biosafety lab explosion destroys cure samples — research set back weeks',
      type: 'alert',
      effect: { cureResist: 0.14, duration: 90 },
      prob: 0.0006,
    },
    // Infrastructure events
    {
      id:   'hospital_collapse',
      msg:  '🏥 Hospital systems overwhelmed — mortality surges in infected zones',
      type: 'alert',
      effect: { lethalityBoost: 0.0004, duration: 70 },
      prob: 0.0012,
    },
    {
      id:   'sewer_contamination',
      msg:  '🚰 Water infrastructure failures — sewage contamination boosts waterborne spread',
      type: 'alert',
      effect: { infectivityBoost: 0.04, duration: 80 },
      prob: 0.0009,
    },
    {
      id:   'natural_disaster',
      msg:  '🌊 Major natural disaster displaces millions — disease vectors spread rapidly',
      type: 'alert',
      effect: { infectivityBoost: 0.05, travelMult: 1.2, duration: 60 },
      prob: 0.0007,
    },
    {
      id:   'supply_chain_collapse',
      msg:  '📦 Global supply chain collapse — hospitals run out of critical supplies',
      type: 'alert',
      effect: { lethalityBoost: 0.0003, duration: 60 },
      prob: 0.0008,
    },
    // Special late-game events
    {
      id:   'military_quarantine',
      msg:  '🪖 Military quarantine zones established — travel between regions halted',
      type: 'warn',
      effect: { travelMult: 0.5, duration: 100 },
      prob: 0.0007,
    },
    {
      id:   'religious_gatherings',
      msg:  '⛪ Massive religious gatherings accelerate spread across continents',
      type: 'alert',
      effect: { infectivityBoost: 0.06, travelMult: 1.4, duration: 40 },
      prob: 0.0008,
    },
    {
      id:   'social_media_disinfo',
      msg:  '📱 Disinformation campaigns convince millions the disease is a hoax',
      type: 'alert',
      effect: { infectivityBoost: 0.05, duration: 55 },
      prob: 0.001,
    },
    {
      id:   'economic_collapse',
      msg:  '📉 Economic collapse causes healthcare funding cuts in 40+ nations',
      type: 'alert',
      effect: { lethalityBoost: 0.0003, cureResist: 0.05, duration: 80 },
      prob: 0.0007,
    },
  ];

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
    }, 3500); // 3.5s feels alive vs old 7s

    if (eventTimer) clearInterval(eventTimer);
    eventTimer = setInterval(checkWorldEvents, 4000);
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

    // Stack categories by relevance — more serious states get more news weight
    if (gs.totalDead > 10000)     TEMPLATES.lethality.forEach(t => newsPool.push(fill(t)));
    if (gs.cureProgress > 0)      TEMPLATES.cure.forEach(t => newsPool.push(fill(t)));
    if (countries.length > 0)     TEMPLATES.spreading.forEach(t => newsPool.push(fill(t)));
    if (countries.length < 5)     TEMPLATES.early.forEach(t => newsPool.push(fill(t)));
    TEMPLATES.events.forEach(t => newsPool.push(fill(t)));
    // Shuffle to avoid repetitive ordering
    for (let i = newsPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newsPool[i], newsPool[j]] = [newsPool[j], newsPool[i]];
    }
  }

  // ─── TRIGGER NEWS ─────────────────────────────
  function triggerNews(category) {
    const templates = TEMPLATES[category];
    if (!templates) return;
    const gs = Game.getState();
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

  // ─── WORLD EVENTS ─────────────────────────────
  function checkWorldEvents() {
    const gs = Game.getState();
    if (gs.phase !== 'spreading') return;

    // Throttle: no more than 1 event per check (prevents event spam)
    const candidates = WORLD_EVENTS.filter(ev => {
      if (ev.types && !ev.types.includes(gs.diseaseType)) return false;
      // Don't re-trigger active events of the same id
      if (gs.activeEvents.some(a => a.id === ev.id)) return false;
      return Math.random() < ev.prob * gs.speed;
    });
    if (candidates.length > 0) {
      // Pick one at random to avoid simultaneous triggers
      triggerWorldEvent(candidates[Math.floor(Math.random() * candidates.length)]);
    }
  }

  function triggerWorldEvent(ev) {
    const gs = Game.getState();
    UI.toast(ev.msg, ev.type);
    triggerNews('events');

    if (!ev.effect) return;

    if (ev.effect.cureBoost) {
      gs.cureProgress = Math.min(100, gs.cureProgress + ev.effect.cureBoost);
      return;
    }

    if (ev.effect.dnaBonus) {
      Game.awardDna(ev.effect.dnaBonus);
      return;
    }

    gs.activeEvents.push({
      id:        ev.id,
      effect:    ev.effect,
      remaining: ev.effect.duration,
    });
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
    if (eventTimer) { clearInterval(eventTimer); eventTimer = null; }
    newsPool  = [];
    newsIndex = 0;
    resetMilestones();
  }

  return { startNewsTicker, triggerNews, onMonthTick, onTick, cleanup };
})();

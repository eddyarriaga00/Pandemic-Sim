/* ═══════════════════════════════════════════════
   PATHOGEN v2 - Events & News System
   ═══════════════════════════════════════════════ */

const Events = (() => {
  let newsTimer    = null;
  let eventTimer   = null;
  let newsPool     = [];
  let newsIndex    = 0;

  // ─── NEWS TEMPLATES ───────────────────────────
  const TEMPLATES = {
    early: [
      'Health officials report unusual illness cluster in {country}',
      'Doctors puzzled by mysterious symptoms in {country}',
      'WHO monitors unidentified pathogen detected in {country}',
      'Local hospitals seeing unexplained admissions in {country}',
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
    ],
  };

  // ─── RANDOM EVENTS ────────────────────────────
  const WORLD_EVENTS = [
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
      id:   'mutation_burst',
      msg:  '🧬 Spontaneous mutation detected — infectivity temporarily spiked!',
      type: 'alert',
      effect: { infectivityBoost: 0.06, duration: 55 },
      prob: 0.002,
      types: ['virus'],
    },
    {
      id:   'antibiotic_fail',
      msg:  '💊 Standard treatments found completely ineffective — cure slows',
      type: 'alert',
      effect: { cureResist: 0.12, duration: 80 },
      prob: 0.001,
    },
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
      id:   'who_summit',
      msg:  '🌐 Emergency WHO summit coordinates global response — cure speeds up',
      type: 'cure',
      effect: { cureBoost: 15, duration: 0 },  // one-time boost
      prob: 0.0008,
    },
    {
      id:   'media_panic',
      msg:  '📺 24/7 media coverage triggers mass hysteria and social breakdown',
      type: 'alert',
      effect: { infectivityBoost: 0.04, duration: 40 },
      prob: 0.002,
    },
    {
      id:   'hospital_collapse',
      msg:  '🏥 Hospital systems overwhelmed — mortality surges in infected zones',
      type: 'alert',
      effect: { lethalityBoost: 0.0004, duration: 70 },
      prob: 0.0012,
    },
    {
      id:   'vaccine_trial_fail',
      msg:  '💉 Promising vaccine candidate fails phase 3 trials — setback for science',
      type: 'warn',
      effect: { cureResist: 0.08, duration: 50 },
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
      id:   'black_market_cure',
      msg:  '🧪 Underground labs synthesise partial cure — small boost to research',
      type: 'cure',
      effect: { cureBoost: 8, duration: 0 },
      prob: 0.0006,
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
    }, 7000);

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

    if (gs.totalDead > 10000)   TEMPLATES.lethality.forEach(t => newsPool.push(fill(t)));
    if (gs.cureProgress > 0)    TEMPLATES.cure.forEach(t => newsPool.push(fill(t)));
    if (countries.length > 0)   TEMPLATES.spreading.forEach(t => newsPool.push(fill(t)));
    TEMPLATES.events.forEach(t => newsPool.push(fill(t)));
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

    for (const ev of WORLD_EVENTS) {
      if (ev.types && !ev.types.includes(gs.diseaseType)) continue;
      if (Math.random() < ev.prob * gs.speed) {
        triggerWorldEvent(ev);
      }
    }
  }

  function triggerWorldEvent(ev) {
    const gs = Game.getState();
    UI.toast(ev.msg, ev.type);

    if (!ev.effect) return;

    if (ev.effect.cureBoost) {
      gs.cureProgress = Math.min(100, gs.cureProgress + ev.effect.cureBoost);
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

    // Possible monthly news items based on state
    const infPct = gs.totalInfected / gs.totalPop;
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

    // Random flavour event
    if (Math.random() < 0.4) triggerNews('events');
  }

  // ─── CLEANUP ──────────────────────────────────
  function cleanup() {
    if (newsTimer)  { clearInterval(newsTimer);  newsTimer  = null; }
    if (eventTimer) { clearInterval(eventTimer); eventTimer = null; }
    newsPool  = [];
    newsIndex = 0;
  }

  return { startNewsTicker, triggerNews, onMonthTick, cleanup };
})();

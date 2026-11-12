/* ═══════════════════════════════════════════════
   PATHOGEN v3 - Simulation engine

   Pure simulation: no DOM, no audio, no map. Everything the rest of the
   game needs to react to is published through Game.on(listener), so this
   file also runs under Node for the balance harness (tools/balance.js).

   Model, per country and per half-day step:
     S -> I   new cases  = beta_c * I * S / alive        (logistic)
     I -> D   new deaths = mu_c * I
     I -> R   only once the cure has been deployed
   Small counts are drawn from a Poisson distribution, so a handful of
   cases can stall or die out instead of growing on a fixed schedule.
   The random generator is seeded and saved with the game.
   ═══════════════════════════════════════════════ */

const Game = (() => {
  'use strict';

  const STEPS_PER_DAY = 2;
  const DT            = 1 / STEPS_PER_DAY;          // days per step
  const DAY_MS        = { 1: 1200, 2: 600, 3: 250 }; // real ms per game day
  const SAVE_KEY      = 'pathogen_save_v2';
  const SAVE_VERSION  = 2;
  const AUTOSAVE_DAYS = 20;

  // ─── TUNING ───────────────────────────────────
  const T = {
    betaBase: 0.03,  betaPerInf: 0.55,     // daily transmission rate = base + perInf * infectivity
    deathPerLeth: 0.06,                    // daily death rate of the infected at lethality 1
    collapseDeathMult: 4,                  // deaths speed up as a country's dead share grows
    detectThreshold: 150000,               // "noticed cases" needed before the world reacts
    cureBase: 1.75,                        // % per day at full effort and priority
    cureDeployRate: 0.40,                  // share of infected cured per day once deployed
    land: 0.035, air: 0.010, sea: 0.007,   // daily export chances per route
    leak: 0.04,                            // how much gets through a closed route
    seedMean: 3,
    wealthInf:   { poor: 1.30, middle: 1.05, rich: 0.75 },
    wealthCure:  { poor: 0.6,  middle: 1.5,  rich: 3.0 },
    alarmThresh: { rich: 0.0008, middle: 0.003, poor: 0.010 },
  };

  // ─── STATE ────────────────────────────────────
  const state = {
    diseaseName: '', diseaseType: 'bacteria', difficulty: 'standard',
    infectivity: 0, severity: 0, lethality: 0, cureResist: 0,
    totalPop: 0, totalInfected: 0, totalDead: 0, totalHealthy: 0,
    cureProgress: 0, cureActive: false, cureDeployed: false,
    detection: 0,
    day: 0, countriesInfected: 0,
    dna: 0, dnaSpent: 0, pendingDna: 0, cumCases: 0,
    traits: new Set(), freeTraits: new Set(),
    countries: {},
    phase: 'idle', endReason: null,
    speed: 1, paused: false,
    activeEvents: [],
    eventBoosts: emptyBoosts(),
    rates: { infected: 0, dead: 0, cure: 0 },
    peakInfected: 0, originIso: null,
    bubbles: [], nextBubbleId: 0,
    seed: 1,
  };

  let countryList = [];
  let mods        = emptyMods();
  let stepCount   = 0;
  let history     = [];
  let historyStride = 1;
  let rngState    = 1;
  let dirty       = new Set();
  let lastAutosaveDay = 0;

  function emptyBoosts() {
    return { infectivity: 0, cureResist: 0, travelMult: 1, lethality: 0, climateBoosts: {} };
  }
  function emptyMods() {
    return { air: 0, sea: 0, land: 0, cold: 0, heat: 0, tropical: 0, poor: 0, rich: 0,
             urban: 0, rural: 0, stealth: 0, dnaRate: 0, lockdownResist: 0, leak: 0,
             extremophile: 0 };
  }

  // ─── EVENTS OUT ───────────────────────────────
  const listeners = [];
  function on(fn) { listeners.push(fn); }
  function emit(type, data) {
    for (const fn of listeners) fn(type, data || {});
  }
  function toast(msg, type) { emit('toast', { msg, type: type || 'info' }); }

  // ─── SEEDED RANDOM ────────────────────────────
  function rand() { // mulberry32
    rngState = (rngState + 0x6D2B79F5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function poisson(lambda) {
    if (lambda <= 0) return 0;
    if (lambda > 30) { // normal approximation
      const u = rand() || 1e-12, v = rand();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return Math.max(0, Math.round(lambda + z * Math.sqrt(lambda)));
    }
    const limit = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= rand(); } while (p > limit);
    return k - 1;
  }
  // Number of events given an expected count, never more than `max`.
  function sample(expected, max) {
    if (expected <= 0 || max <= 0) return 0;
    const n = expected < 1e6 ? poisson(expected) : Math.round(expected);
    return Math.min(max, n);
  }

  // ─── TRAITS ───────────────────────────────────
  const TRAITS = {};
  const ALL_TRAITS = [
    ...EVOLUTION_TREE.transmissions,
    ...EVOLUTION_TREE.symptoms,
    ...EVOLUTION_TREE.abilities,
  ];
  for (const t of ALL_TRAITS) TRAITS[t.id] = t;

  function findTrait(id)  { return TRAITS[id] || null; }
  function getAllTraits() { return ALL_TRAITS; }

  // Disease stats and route/context modifiers are always rebuilt from the
  // owned trait set, so buying, devolving, mutating and loading can't drift.
  function recomputeStats() {
    const td = DISEASE_TYPES[state.diseaseType];
    let inf = 0.18 * td.infectivityMod;
    let sev = 0.04 * td.severityMod;
    let leth = 0, resist = 0;
    mods = emptyMods();

    for (const id of state.traits) {
      const t = TRAITS[id];
      if (!t) continue;
      const e = t.effects || {};
      inf    += e.infectivity || 0;
      sev    += e.severity    || 0;
      leth   += (e.lethality  || 0) * td.lethalityMod;
      resist += e.cureResist  || 0;
      if (t.mods) for (const k in t.mods) mods[k] = (mods[k] || 0) + t.mods[k];
    }
    state.infectivity = clamp(inf, 0, 1);
    state.severity    = clamp(sev, 0, 1);
    state.lethality   = clamp(leth, 0, 1);
    state.cureResist  = clamp(resist, 0, 0.9);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ─── INIT ─────────────────────────────────────
  function init(config) {
    stopLoop();
    state.diseaseName = config.name       || 'Unnamed';
    state.diseaseType = DISEASE_TYPES[config.type] ? config.type : 'bacteria';
    state.difficulty  = DIFFICULTIES[config.difficulty] ? config.difficulty : 'standard';
    state.seed        = (config.seed != null ? config.seed : Math.floor(Math.random() * 2 ** 31)) | 0;
    rngState          = state.seed;

    const td = DISEASE_TYPES[state.diseaseType];
    state.totalPop = state.totalInfected = state.totalDead = state.totalHealthy = 0;
    state.cureProgress = 0;
    state.cureActive   = !!td.instantCure;
    state.cureDeployed = false;
    state.detection    = td.instantCure ? 1 : 0;
    state.day = 0; state.countriesInfected = 0;
    state.dna = 0; state.dnaSpent = 0; state.pendingDna = 0; state.cumCases = 0;
    state.traits = new Set(); state.freeTraits = new Set();
    state.countries = {};
    state.phase = 'idle'; state.endReason = null;
    state.speed = 1; state.paused = false;
    state.activeEvents = []; state.eventBoosts = emptyBoosts();
    state.rates = { infected: 0, dead: 0, cure: 0 };
    state.peakInfected = 0; state.originIso = null;
    state.bubbles = []; state.nextBubbleId = 0;
    stepCount = 0; history = []; historyStride = 1; dirty = new Set();
    lastAutosaveDay = 0;

    for (const c of COUNTRIES_DATA) {
      state.countries[c.iso] = {
        ...c, borders: [],
        infected: 0, dead: 0, healthy: c.pop, immune: 0,
        reached: false,
        airportClosed: false, portClosed: false, borderClosed: false,
        lockdown: false, collapsed: false,
      };
      state.totalPop     += c.pop;
      state.totalHealthy += c.pop;
    }
    linkBorders();
    countryList = Object.values(state.countries);
    recomputeStats();
  }

  // Border lists in the data are hand-written and not always mutual, and
  // some point at territories the game doesn't track. Make them symmetric.
  function linkBorders() {
    for (const c of COUNTRIES_DATA) {
      for (const b of c.borders) {
        const a = state.countries[c.iso], d = state.countries[b];
        if (!d || a === d) continue;
        if (!a.borders.includes(d.iso)) a.borders.push(d.iso);
        if (!d.borders.includes(a.iso)) d.borders.push(a.iso);
      }
    }
  }

  function startInCountry(iso) {
    const c = state.countries[iso];
    if (!c || state.phase !== 'idle') return;
    state.originIso = iso;
    const seed = 12;
    c.infected = seed; c.healthy = c.pop - seed; c.reached = true;
    state.totalInfected = seed; state.totalHealthy = state.totalPop - seed;
    state.cumCases = seed;
    state.countriesInfected = 1;
    state.peakInfected = seed;
    state.phase = 'spreading';
    awardDna(3);
    toast(`☣ ${state.diseaseName} emerges in ${c.name}`, 'info');
    startLoop();
  }

  // ─── REAL-TIME DRIVER ─────────────────────────
  let timer = null, lastTs = 0, acc = 0;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function startLoop() {
    stopLoop();
    if (typeof setInterval === 'undefined') return;
    lastTs = now(); acc = 0;
    timer = setInterval(() => {
      const t = now();
      acc += Math.min(t - lastTs, 1000);
      lastTs = t;
      const stepMs = DAY_MS[state.speed] / STEPS_PER_DAY;
      let n = 0;
      while (acc >= stepMs && n < 6) { step(); acc -= stepMs; n++; }
      if (n === 6) acc = 0; // fell behind; don't try to catch up
    }, 30);
  }
  function stopLoop() {
    if (timer) { clearInterval(timer); timer = null; }
  }
  function setSpeed(s) { state.speed = DAY_MS[s] ? s : 1; }
  function setPaused(p) {
    state.paused = !!p;
    if (state.paused) stopLoop();
    else if (state.phase === 'spreading') startLoop();
  }

  // ─── PER-COUNTRY RATES ────────────────────────
  function climateMod(c) {
    let m = 1;
    if (c.climate === 'cold')          m = mods.cold >= 2 ? 1.25 : mods.cold >= 1 ? 0.80 : 0.30;
    else if (c.climate === 'arid')     m = mods.heat >= 2 ? 1.25 : mods.heat >= 1 ? 0.80 : 0.40;
    else if (c.climate === 'tropical') m = mods.heat >= 1 ? 1.10 : 0.90;
    if (mods.extremophile) m = Math.max(m, 1.10);
    if (c.climate === 'tropical') m *= 1 + mods.tropical;
    const boost = state.eventBoosts.climateBoosts[c.climate];
    if (boost) m *= Math.max(0.2, 1 + boost);
    return m;
  }

  // Daily transmission rate inside a country.
  function betaFor(c) {
    const inf = clamp(state.infectivity + state.eventBoosts.infectivity, 0, 1.1);
    let b = (T.betaBase + T.betaPerInf * inf) * climateMod(c) * T.wealthInf[c.wealth];
    if (c.wealth === 'poor') b *= 1 + mods.poor;
    if (c.wealth === 'rich') b *= 1 + mods.rich;
    if (c.pop >= 80e6)       b *= 1 + mods.urban;
    if (c.pop <  25e6)       b *= 1 + mods.rural;
    if (c.lockdown && !c.collapsed) b *= 0.55 + 0.45 * Math.min(1, mods.lockdownResist);
    return b;
  }

  // Daily death rate of the infected. Good healthcare saves people until
  // the system is swamped; a country that is mostly dead stops coping at all.
  function deathRateFor(c) {
    const leth = clamp(state.lethality + state.eventBoosts.lethality, 0, 1.2);
    if (leth <= 0) return 0;
    const deadFrac = c.dead / c.pop;
    const strain   = Math.min(1, deadFrac * 3 + (c.infected / c.pop) * 0.5);
    const care     = c.healthcare * (1 - strain);
    return T.deathPerLeth * leth * (1.3 - 0.8 * care) * (1 + T.collapseDeathMult * deadFrac);
  }

  // ─── STEP ─────────────────────────────────────
  function step() {
    if (state.phase !== 'spreading') return;
    stepCount++;
    const newDay = stepCount % STEPS_PER_DAY === 0;

    const sev = state.severity;
    let totI = 0, totD = 0, totS = 0, totR = 0, newCases = 0, newDeaths = 0, notice = 0;

    for (const c of countryList) {
      if (c.infected > 0) {
        const alive = c.pop - c.dead;
        if (!state.cureDeployed && c.healthy > 0) {
          const n = sample(betaFor(c) * c.infected * (c.healthy / alive) * DT, c.healthy);
          c.infected += n; c.healthy -= n; newCases += n;
        }
        const d = sample(deathRateFor(c) * c.infected * DT, c.infected);
        c.infected -= d; c.dead += d; newDeaths += d;

        if (state.cureDeployed && c.infected > 0) {
          const cured = Math.min(c.infected, Math.max(1, Math.ceil(c.infected * T.cureDeployRate * DT)));
          c.infected -= cured; c.immune += cured;
        }
        dirty.add(c.iso);
      }
      totI += c.infected; totD += c.dead; totS += c.healthy; totR += c.immune;
      notice += c.healthcare * (c.infected * (0.002 + sev * 0.5) + c.dead * 20);
    }

    state.totalInfected = totI;
    state.totalDead     = totD;
    state.totalHealthy  = totS + totR;
    state.cumCases     += newCases;
    if (totI > state.peakInfected) state.peakInfected = totI;

    earnDna(newCases, newDeaths);
    updateDetection(notice);
    if (state.cureActive && !state.cureDeployed) advanceCure();

    if (newDay) dayTick();

    checkEnd(totS);

    emit('step', { dirty });
    dirty = new Set();
  }

  function dayTick() {
    state.day++;
    tickEvents();
    spreadBetweenCountries();
    if (state.cureActive) governmentResponse();
    rollMutation();
    rollWorldEvent();
    if (state.day % 6 === 0) maybeSpawnBubble();
    recordHistory();
    emit('day', { day: state.day });
    if (state.day - lastAutosaveDay >= AUTOSAVE_DAYS) { lastAutosaveDay = state.day; saveGame(); }
  }

  // ─── DNA ──────────────────────────────────────
  // Income follows the order of magnitude of the outbreak rather than raw
  // case counts, so going from 1K to 10K cases is worth as much as 1B to 10B.
  function earnDna(newCases, newDeaths) {
    if (newCases <= 0 && newDeaths <= 0) return;
    const td   = DISEASE_TYPES[state.diseaseType];
    const diff = DIFFICULTIES[state.difficulty];
    const rate = (td.dnaMod || 1) * (1 + mods.dnaRate) * (diff.dnaMult || 1);
    const lg   = x => Math.log10(1 + x);
    const cum  = state.cumCases, dead = state.totalDead;
    state.pendingDna += rate * (
      2.5 * (lg(cum / 100)   - lg((cum - newCases)   / 100)) +
      1.5 * (lg(dead / 1000) - lg((dead - newDeaths) / 1000))
    );
    if (state.pendingDna >= 1) {
      const whole = Math.floor(state.pendingDna);
      state.pendingDna -= whole;
      awardDna(whole);
    }
  }

  function awardDna(amount) {
    if (amount <= 0) return;
    state.dna += amount;
    emit('dna', { amount });
  }

  // ─── DETECTION ────────────────────────────────
  // The world notices a disease through visible illness and deaths in places
  // with working healthcare. Mild pathogens get a long head start.
  function detectionThreshold() {
    const td   = DISEASE_TYPES[state.diseaseType];
    const diff = DIFFICULTIES[state.difficulty];
    return T.detectThreshold * diff.detectMult * (td.stealthy ? 2.5 : 1) * (1 + mods.stealth);
  }

  function updateDetection(notice) {
    if (state.cureActive) { state.detection = 1; return; }
    state.detection = Math.min(1, notice / detectionThreshold());
    if (state.detection >= 1) {
      state.cureActive = true;
      toast(`🔬 ${state.diseaseName} has been identified. Cure research begins.`, 'cure');
      emit('cureStart');
      emit('news', { category: 'cure' });
    }
  }

  // ─── CURE ─────────────────────────────────────
  function advanceCure() {
    const sev = state.severity;
    let effort = 0, maxEffort = 0;
    for (const c of countryList) {
      const w = c.healthcare * T.wealthCure[c.wealth] * Math.sqrt(c.pop);
      const working = Math.max(0, (c.pop - c.dead - c.infected * Math.min(1, sev * 1.5)) / c.pop);
      maxEffort += w;
      effort    += w * working * working;
    }
    // A disease nobody is dying from doesn't get wartime funding.
    const infFrac  = state.totalInfected / state.totalPop;
    const deadFrac = state.totalDead / state.totalPop;
    const priority = clamp(0.3 + 0.7 * Math.min(1, infFrac * sev * 4 + deadFrac * 30), 0.3, 1);

    const td     = DISEASE_TYPES[state.diseaseType];
    const diff   = DIFFICULTIES[state.difficulty];
    const resist = Math.min(0.92, state.cureResist + state.eventBoosts.cureResist);
    const perDay = T.cureBase * diff.cureSpeed * (td.cureMod || 1) *
                   (effort / maxEffort) * priority * (1 - resist);

    state.cureProgress = Math.min(100, state.cureProgress + perDay * DT);
    if (state.cureProgress >= 100) {
      state.cureDeployed = true;
      toast('💉 The cure is complete and being distributed worldwide.', 'cure');
      emit('news', { category: 'cure' });
    }
  }

  // ─── GOVERNMENT RESPONSE ──────────────────────
  function governmentResponse() {
    const diff = DIFFICULTIES[state.difficulty];
    const sev  = state.severity;
    const worldPanic = (state.totalDead / state.totalPop) * 20 +
                       (state.totalInfected / state.totalPop) * sev * 2;

    for (const c of countryList) {
      if (c.collapsed) continue;

      if (c.dead / c.pop > 0.5) { // nobody left to enforce anything
        c.collapsed = true;
        c.lockdown = false;
        emit('gov', { iso: c.iso, kind: 'collapse' });
        if (c.pop >= 50e6) toast(`🏚 Government of ${c.name} has collapsed`, 'alert');
        continue;
      }

      if (!c.reached) {
        // Untouched countries may seal themselves off once the world panics.
        if (worldPanic > 0.05 && !(c.airportClosed && c.portClosed)) {
          const wealthBias = c.wealth === 'rich' ? 1.5 : c.wealth === 'middle' ? 1 : 0.5;
          if (rand() < Math.min(0.05, worldPanic * 0.05) * diff.response * wealthBias) {
            c.airportClosed = true; c.portClosed = true;
            emit('gov', { iso: c.iso, kind: 'sealed' });
            toast(`🚫 ${c.name} seals its airports and ports`, 'warn');
          }
        }
        continue;
      }

      const alarm = (c.infected * (sev + 0.02) + c.dead * 10) / c.pop * diff.response;
      const thr   = T.alarmThresh[c.wealth];
      const loud  = c.pop >= 50e6;

      if (!c.airportClosed && c.airports > 0 && alarm > thr) {
        c.airportClosed = true;
        emit('gov', { iso: c.iso, kind: 'airports' });
        if (loud) toast(`✈️ ${c.name} closes its airports`, 'warn');
      }
      if (!c.portClosed && c.ports > 0 && alarm > thr * 2.5) {
        c.portClosed = true;
        emit('gov', { iso: c.iso, kind: 'ports' });
      }
      if (!c.borderClosed && alarm > thr * 4) {
        c.borderClosed = true;
        emit('gov', { iso: c.iso, kind: 'borders' });
      }
      if (!c.lockdown && alarm > thr * 8) {
        c.lockdown = true;
        emit('gov', { iso: c.iso, kind: 'lockdown' });
        if (loud) toast(`🔒 ${c.name} enters national lockdown`, 'warn');
      }
    }
  }

  // ─── SPREAD BETWEEN COUNTRIES ─────────────────
  const canReceive = c => c.infected === 0 && c.healthy > 0;

  function spreadBetweenCountries() {
    if (state.cureDeployed) return;
    const leak   = Math.min(0.5, T.leak + mods.leak);
    const travel = state.eventBoosts.travelMult;
    const td     = DISEASE_TYPES[state.diseaseType];

    let airTargets = null, seaTargets = null;

    for (const src of countryList) {
      if (src.infected < 50) continue;
      const prev     = src.infected / (src.pop - src.dead);
      const strength = Math.min(1, Math.sqrt(prev) * 1.6) * travel;
      const enforced = !src.collapsed;

      // Land
      const srcLand = src.borderClosed && enforced ? leak * 3 : 1;
      for (const iso of src.borders) {
        const dst = state.countries[iso];
        if (!canReceive(dst)) continue;
        const dstLand = dst.borderClosed && !dst.collapsed ? leak * 3 : 1;
        if (rand() < T.land * strength * (1 + mods.land) * srcLand * dstLand) {
          seedCountry(dst, 'land border', src.iso);
        }
      }

      // Air: collapsed countries have no functioning airlines
      if (src.airports > 0) {
        const gate = src.collapsed ? 0.1 : src.airportClosed ? leak : 1;
        if (rand() < T.air * src.airports * strength * (1 + mods.air) * gate) {
          airTargets = airTargets || countryList.filter(c => c.airports > 0 && canReceive(c));
          const dst = weightedPick(airTargets, c => c.airports * c.airports);
          if (dst && canReceive(dst) && (!dst.airportClosed || dst.collapsed || rand() < leak)) {
            seedCountry(dst, 'air travel', src.iso);
          }
        }
      }

      // Sea
      if (src.ports > 0) {
        const gate = src.collapsed ? 0.2 : src.portClosed ? leak : 1;
        if (rand() < T.sea * src.ports * strength * (1 + mods.sea) * gate) {
          seaTargets = seaTargets || countryList.filter(c => c.ports > 0 && canReceive(c));
          const dst = weightedPick(seaTargets, c => c.ports);
          if (dst && canReceive(dst) && (!dst.portClosed || dst.collapsed || rand() < leak)) {
            seedCountry(dst, 'sea route', src.iso);
          }
        }
      }
    }

    // Fungal spores ignore borders entirely.
    if (td.sporeBurst && rand() < 0.012) {
      const open    = countryList.filter(canReceive);
      const sources = countryList.filter(c => c.infected > 1000);
      if (open.length && sources.length) {
        seedCountry(open[Math.floor(rand() * open.length)], 'spore dispersal',
                    sources[Math.floor(rand() * sources.length)].iso);
      }
    }
  }

  function weightedPick(arr, weightOf) {
    let total = 0;
    for (const c of arr) total += weightOf(c);
    if (total <= 0) return null;
    let r = rand() * total;
    for (const c of arr) { r -= weightOf(c); if (r <= 0) return c; }
    return arr[arr.length - 1];
  }

  function seedCountry(dst, method, srcIso) {
    const seed = Math.min(dst.healthy, 1 + poisson(T.seedMean));
    dst.infected += seed; dst.healthy -= seed;
    state.cumCases += seed;
    dirty.add(dst.iso);
    if (dst.reached) return; // re-seeding a country where it died out

    dst.reached = true;
    state.countriesInfected++;
    toast(`🌍 ${state.diseaseName} reaches ${dst.name} via ${method}`, 'info');
    emit('country', { iso: dst.iso, method, srcIso });
    emit('news', { category: 'spreading' });
    awardDna(dst.pop >= 100e6 ? 2 : 1);
  }

  // ─── MUTATION ─────────────────────────────────
  // Uncontrolled mutation only ever produces symptoms: free, but they make
  // the disease easier to notice. They can be devolved for no refund.
  function rollMutation() {
    const td = DISEASE_TYPES[state.diseaseType];
    if (!td.mutationRate || rand() >= td.mutationRate) return;
    const options = EVOLUTION_TREE.symptoms.filter(t =>
      !state.traits.has(t.id) && t.requires.every(r => state.traits.has(r)));
    if (!options.length) return;
    const t = options[Math.floor(rand() * options.length)];
    state.traits.add(t.id);
    state.freeTraits.add(t.id);
    recomputeStats();
    toast(`🧬 ${state.diseaseName} mutated: ${t.name}`, 'dna');
    emit('traits', { mutated: t.id });
  }

  // ─── WORLD EVENTS ─────────────────────────────
  function rollWorldEvent() {
    const candidates = WORLD_EVENTS.filter(ev => {
      if (ev.types && !ev.types.includes(state.diseaseType)) return false;
      if (ev.effect.cureBoost && (!state.cureActive || state.cureDeployed)) return false;
      if (state.activeEvents.some(a => a.id === ev.id)) return false;
      return rand() < ev.prob;
    });
    if (!candidates.length) return;
    const ev = candidates[Math.floor(rand() * candidates.length)];

    toast(ev.msg, ev.type);
    emit('news', { category: 'events' });
    if (ev.effect.cureBoost) {
      state.cureProgress = Math.min(99, state.cureProgress + ev.effect.cureBoost);
    } else if (ev.effect.dnaBonus) {
      awardDna(ev.effect.dnaBonus);
    } else {
      state.activeEvents.push({ id: ev.id, effect: ev.effect, remaining: ev.effect.days });
      rebuildEventBoosts();
    }
  }

  function tickEvents() {
    if (!state.activeEvents.length) return;
    state.activeEvents = state.activeEvents.filter(ev => --ev.remaining > 0);
    rebuildEventBoosts();
  }

  function rebuildEventBoosts() {
    const b = emptyBoosts();
    for (const { effect: e } of state.activeEvents) {
      if (e.infectivityBoost) b.infectivity += e.infectivityBoost;
      if (e.cureResist)       b.cureResist  += e.cureResist;
      if (e.lethalityBoost)   b.lethality   += e.lethalityBoost;
      if (e.travelMult)       b.travelMult   = Math.max(0.1, b.travelMult * e.travelMult);
      if (e.climateBoost) {
        for (const k in e.climateBoost) b.climateBoosts[k] = (b.climateBoosts[k] || 0) + e.climateBoost[k];
      }
    }
    state.eventBoosts = b;
  }

  // ─── DNA BUBBLES ──────────────────────────────
  function maybeSpawnBubble() {
    state.bubbles = state.bubbles.filter(b => b.expiresDay > state.day);
    if (state.bubbles.length >= 4) return;
    const hosts = countryList.filter(c => c.infected > 5000);
    if (!hosts.length) return;
    const c      = hosts[Math.floor(rand() * hosts.length)];
    const infPct = c.infected / c.pop;
    const id     = state.nextBubbleId++;
    const angle  = (id * 137.508) % 360 * (Math.PI / 180); // golden angle keeps them apart
    const radius = 10 + (id % 3) * 5;
    state.bubbles.push({
      id, iso: c.iso,
      value: infPct > 0.2 ? 2 : 1,
      expiresDay: state.day + 12,
      dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius,
    });
  }

  function collectBubble(id) {
    const i = state.bubbles.findIndex(b => b.id === id);
    if (i === -1) return 0;
    const val = state.bubbles[i].value;
    state.bubbles.splice(i, 1);
    awardDna(val);
    return val;
  }

  function getBubbles() {
    return state.bubbles.filter(b => b.expiresDay > state.day);
  }

  // ─── HISTORY ──────────────────────────────────
  let prevSnap = null;
  function recordHistory() {
    const snap = { day: state.day, infected: state.totalInfected, dead: state.totalDead,
                   healthy: state.totalHealthy, cure: state.cureProgress };
    if (prevSnap) {
      state.rates = {
        infected: snap.infected - prevSnap.infected,
        dead:     snap.dead     - prevSnap.dead,
        cure:     snap.cure     - prevSnap.cure,
      };
    }
    prevSnap = snap;
    if (state.day % historyStride !== 0) return;
    history.push(snap);
    if (history.length > 720) { // halve the resolution rather than forget the start
      history = history.filter((_, i) => i % 2 === 1);
      historyStride *= 2;
    }
  }

  // ─── END CONDITIONS ───────────────────────────
  function checkEnd(susceptible) {
    if (state.totalInfected > 0) return;
    if (state.totalHealthy <= 0)      endGame(true,  'extinct');
    else if (state.cureDeployed)      endGame(false, 'cured');
    else if (susceptible > 0)         endGame(false, 'burnout');
  }

  function endGame(won, reason) {
    if (state.phase !== 'spreading') return;
    state.phase     = won ? 'won' : 'lost';
    state.endReason = reason;
    stopLoop();
    clearSave();
    emit('end', { won, reason });
  }

  // ─── BUY / DEVOLVE ────────────────────────────
  function buyTrait(id) {
    const trait = TRAITS[id];
    if (!trait)                return { ok: false, msg: 'Unknown trait' };
    if (state.traits.has(id))  return { ok: false, msg: 'Already owned' };
    if (trait.requires.some(r => !state.traits.has(r))) return { ok: false, msg: 'Requirements not met' };
    if (state.dna < trait.cost) return { ok: false, msg: 'Not enough DNA' };

    state.dna      -= trait.cost;
    state.dnaSpent += trait.cost;
    state.traits.add(id);
    recomputeStats();
    toast(`⚡ Evolved: ${trait.name}`, 'dna');
    emit('traits', { bought: id });
    return { ok: true };
  }

  function devolveTrait(id) {
    const trait = TRAITS[id];
    if (!trait || !state.traits.has(id)) return { ok: false, msg: 'Not owned' };
    const dependants = ALL_TRAITS.filter(t => t.requires.includes(id) && state.traits.has(t.id));
    if (dependants.length) {
      return { ok: false, msg: `Devolve ${dependants.map(d => d.name).join(', ')} first` };
    }
    const wasFree = state.freeTraits.has(id);
    const refund  = wasFree ? 0 : Math.max(1, Math.floor(trait.cost * 0.5));
    state.traits.delete(id);
    state.freeTraits.delete(id);
    state.dna      += refund;
    state.dnaSpent -= refund;
    recomputeStats();
    toast(`↩ Devolved: ${trait.name}${refund ? ` (+${refund} DNA)` : ''}`, 'warn');
    emit('traits', { devolved: id });
    return { ok: true };
  }

  // ─── SAVE / LOAD ──────────────────────────────
  function storage() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
  }

  function serialize() {
    return {
      version: SAVE_VERSION, savedAt: Date.now(),
      state: { ...state, traits: [...state.traits], freeTraits: [...state.freeTraits] },
      rngState, stepCount, history, historyStride,
    };
  }

  function saveGame() {
    const ls = storage();
    if (!ls || state.phase !== 'spreading') return false;
    try { ls.setItem(SAVE_KEY, JSON.stringify(serialize())); return true; }
    catch (e) { return false; }
  }

  function loadSave(data) {
    let d = data;
    if (!d) {
      const ls = storage();
      try { d = ls && JSON.parse(ls.getItem(SAVE_KEY)); } catch { d = null; }
    }
    if (!d || d.version !== SAVE_VERSION || !d.state || !DISEASE_TYPES[d.state.diseaseType]) return false;

    stopLoop();
    Object.assign(state, d.state);
    state.traits     = new Set(d.state.traits);
    state.freeTraits = new Set(d.state.freeTraits);
    state.paused     = true;
    rngState      = d.rngState;
    stepCount     = d.stepCount;
    history       = d.history || [];
    historyStride = d.historyStride || 1;
    prevSnap      = history[history.length - 1] || null;
    countryList   = Object.values(state.countries);
    dirty         = new Set();
    lastAutosaveDay = state.day;
    recomputeStats();
    rebuildEventBoosts();
    return true;
  }

  function hasSave()   { return !!getSaveMeta(); }
  function clearSave() { const ls = storage(); try { ls && ls.removeItem(SAVE_KEY); } catch {} }
  function getSaveMeta() {
    const ls = storage();
    try {
      const d = ls && JSON.parse(ls.getItem(SAVE_KEY));
      if (!d || d.version !== SAVE_VERSION) return null;
      return { day: d.state.day, diseaseName: d.state.diseaseName, savedAt: d.savedAt };
    } catch { return null; }
  }

  // ─── READ-ONLY HELPERS FOR THE UI ─────────────
  // How the outbreak is doing inside one country: >1 growing, <1 dying out.
  function reproductionFor(c) {
    const alive = c.pop - c.dead;
    if (alive <= 0) return 0;
    const growth = betaFor(c) * (c.healthy / alive);
    const loss   = deathRateFor(c);
    return loss > 0 ? growth / loss : Infinity;
  }

  function getStats() {
    return {
      totalPop: state.totalPop, totalInfected: state.totalInfected,
      totalDead: state.totalDead, totalHealthy: state.totalHealthy,
      cureProgress: state.cureProgress, day: state.day,
      dna: state.dna, dnaSpent: state.dnaSpent,
      countriesInfected: state.countriesInfected, peakInfected: state.peakInfected,
    };
  }

  return {
    init, startInCountry, setSpeed, setPaused, step, on,
    buyTrait, devolveTrait, findTrait, getAllTraits,
    awardDna, toast,
    getState: () => state, getStats,
    getCountry: iso => state.countries[iso] || null,
    getAllCountries: () => countryList,
    getHistory: () => history,
    getMods: () => mods,
    betaFor, deathRateFor, reproductionFor,
    getBubbles, collectBubble,
    saveGame, loadSave, hasSave, clearSave, getSaveMeta,
  };
})();

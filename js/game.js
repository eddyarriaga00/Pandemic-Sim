/* ═══════════════════════════════════════════════
   PATHOGEN v2 - Core Game Engine
   ═══════════════════════════════════════════════ */

const Game = (() => {
  // ─── STATE ────────────────────────────────────
  const state = {
    diseaseName: '', diseaseType: 'bacteria', difficulty: 'normal',

    // Disease stats (0–1, cumulative from traits)
    infectivity: 0.0,
    severity:    0.0,
    lethality:   0.0,
    cureResist:  0.0,

    // These are the BASE values before traits
    baseInfectivity: 0.0,
    baseSeverity:    0.0,

    // World totals
    totalPop:      0,
    totalInfected: 0,
    totalDead:     0,
    totalHealthy:  0,
    cureProgress:  0,
    cureActive:    false,
    day:           0,
    countriesInfected: 0,

    // DNA
    dna:        0,
    dnaSpent:   0,
    pendingDna: 0,
    traits: new Set(),

    // Country map: iso → country object
    countries: {},

    // Game flow
    phase:        'idle',
    speed:        1,
    paused:       false,
    tickInterval: null,

    // Events
    activeEvents: [],
    eventBoosts:  { infectivity: 0, cureResist: 0, travelMult: 1, lethality: 0, climateBoosts: {} },

    // Government response
    airportsOpen: true,   // governments can close airports
    bordersClosed: false, // land border lockdowns

    notifications: [],
    peakInfected: 0,
    originIso: null,
  };

  const BASE_TICK_MS  = 750;
  const TICKS_PER_DAY = 3;
  let tickCount = 0;
  let _history = []; // daily snapshots for epidemic curve

  // ─── INIT ─────────────────────────────────────
  function init(config) {
    state.diseaseName = config.name       || 'Unnamed';
    state.diseaseType = config.type       || 'bacteria';
    state.difficulty  = config.difficulty || 'normal';

    if (state.tickInterval) { clearInterval(state.tickInterval); state.tickInterval = null; }

    const td = DISEASE_TYPES[state.diseaseType];

    // Base disease stats from type modifiers
    state.baseInfectivity = 0.18 * td.infectivityMod;
    state.baseSeverity    = 0.04 * td.severityMod;
    state.infectivity     = state.baseInfectivity;
    state.severity        = state.baseSeverity;
    state.lethality       = 0.0;
    state.cureResist      = 0.0;

    state.totalPop = state.totalInfected = state.totalDead = state.totalHealthy = 0;
    state.cureProgress = 0;
    state.cureActive   = td.instantCure || false;
    state.day = 0;
    state.countriesInfected = 0;
    state.dna = 0; state.dnaSpent = 0; state.pendingDna = 0;
    state.traits = new Set();
    state.countries = {};
    state.phase = 'idle';
    state.speed = 1; state.paused = false;
    state.activeEvents = [];
    state.eventBoosts = { infectivity: 0, cureResist: 0, travelMult: 1, lethality: 0, climateBoosts: {} };
    state.airportsOpen = true; state.bordersClosed = false;
    state.peakInfected = 0;
    state.originIso = null;
    tickCount = 0;
    _history = [];

    for (const c of COUNTRIES_DATA) {
      state.countries[c.iso] = {
        ...c,
        infected: 0, dead: 0, healthy: c.pop,
        infected_pct: 0, dead_pct: 0,
        reached: false,
        // Government response
        airportClosed: false,
        bordersClosed: false,
        lockdown: false,
        cureContrib: c.healthcare * 0.012,
      };
      state.totalPop     += c.pop;
      state.totalHealthy += c.pop;
    }
  }

  // ─── START IN COUNTRY ─────────────────────────
  function startInCountry(iso) {
    state.originIso = iso;
    const c = state.countries[iso];
    if (!c) return;

    const seed = Math.max(5, Math.floor(c.pop * 0.0000008));
    c.infected = seed; c.healthy = c.pop - seed; c.reached = true;
    state.totalInfected = seed; state.totalHealthy = state.totalPop - seed;
    state.countriesInfected = 1;
    state.phase = 'spreading';
    state.peakInfected = seed;

    awardDna(3);
    toast(`☣ ${state.diseaseName} emerges in ${c.name}`, 'info');
    startLoop();
  }

  // ─── GAME LOOP ────────────────────────────────
  function startLoop() {
    if (state.tickInterval) clearInterval(state.tickInterval);
    state.tickInterval = setInterval(tick, Math.floor(BASE_TICK_MS / state.speed));
  }

  function setSpeed(s) {
    state.speed = s;
    if (state.phase === 'spreading' && !state.paused) startLoop();
  }

  function setPaused(p) {
    state.paused = p;
    if (p) { clearInterval(state.tickInterval); state.tickInterval = null; }
    else    { startLoop(); }
  }

  // ─── TICK ─────────────────────────────────────
  function tick() {
    if (state.paused || state.phase === 'won' || state.phase === 'lost') return;

    tickCount++;
    if (tickCount % TICKS_PER_DAY === 0) {
      state.day++;
      // Record daily snapshot for epidemic curve
      _history.push({
        day:      state.day,
        infected: state.totalInfected,
        dead:     state.totalDead,
        cure:     state.cureProgress,
      });
      if (_history.length > 300) _history.shift(); // cap at 300 days
      if (state.day % 30 === 0) Events.onMonthTick();
    }

    const diff = DIFFICULTIES[state.difficulty];
    const td   = DISEASE_TYPES[state.diseaseType];

    let newInfected = 0, newDead = 0;

    for (const iso in state.countries) {
      const c = state.countries[iso];
      if (!c.reached) { newInfected += c.infected; newDead += c.dead; continue; }

      // ── WITHIN-COUNTRY SPREAD ──
      const infRate = calcInfRate(c);
      const prevalence = c.infected / c.pop;

      // SIR-style: dI = beta * S * I/N — add exponential floor for small populations
      let newCases = Math.floor(c.healthy * infRate * (prevalence + 0.00003));
      newCases = Math.min(newCases, c.healthy);
      if (newCases < 0) newCases = 0;

      c.infected += newCases;
      c.healthy  -= newCases;

      // ── DEATHS ──
      const lethal = calcLethalRate(c);
      const deaths = Math.floor(c.infected * lethal);
      const actualDeaths = Math.min(deaths, c.infected);
      c.infected -= actualDeaths;
      c.dead     += actualDeaths;

      // Clamp
      c.infected = Math.max(0, c.infected);
      c.healthy  = Math.max(0, c.healthy);

      c.infected_pct = c.pop > 0 ? c.infected / c.pop : 0;
      c.dead_pct     = c.pop > 0 ? c.dead     / c.pop : 0;

      newInfected += c.infected;
      newDead     += c.dead;

      // DNA accrual
      if (newCases > 0) state.pendingDna += newCases / 800000;

      // Cure trigger
      if (!state.cureActive && state.severity > 0.10 && c.infected > c.pop * 0.0003) {
        state.cureActive = true;
        toast('🔬 Governments begin cure research!', 'cure');
        Events.triggerNews('cure');
      }

      // Government airport/border closure
      checkGovernmentResponse(c, diff);
    }

    state.totalInfected = newInfected;
    state.totalDead     = newDead;
    state.totalHealthy  = Math.max(0, state.totalPop - newInfected - newDead);
    state.peakInfected  = Math.max(state.peakInfected, newInfected);
    state.countriesInfected = Object.values(state.countries).filter(c => c.reached).length;

    // ── SPREAD TO NEW COUNTRIES ──
    if (tickCount % 2 === 0) spreadGlobal();

    // ── CURE RESEARCH ──
    if (state.cureActive) advanceCure(diff);

    // ── DNA ──
    if (state.pendingDna >= 1) {
      const e = Math.floor(state.pendingDna);
      state.pendingDna -= e;
      awardDna(e);
    }

    // ── VIRUS MUTATION ──
    if (td.mutationRate && Math.random() < td.mutationRate * state.speed) handleMutation();

    // ── EVENTS ──
    tickEvents();

    // ── CHECK WIN/LOSE ──
    checkEndConditions();

    // ── UI (map colors every 2 ticks, evo check every 4) ──
    if (tickCount % 2 === 0 && Map && Map.updateColors) Map.updateColors();
    if (tickCount % 4 === 0) UI.checkEvoAvailable();
  }

  // ─── INFECTIVITY for a country ────────────────
  function calcInfRate(c) {
    let inf = state.infectivity + state.eventBoosts.infectivity;

    // Climate resistance checks
    const coldLv = state.traits.has('cold_resist2') ? 2 : state.traits.has('cold_resist1') ? 1 : 0;
    const heatLv = state.traits.has('heat_resist2') ? 2 : state.traits.has('heat_resist1') ? 1 : 0;

    if (c.climate === 'cold') {
      if      (coldLv === 2) inf *= 1.35;
      else if (coldLv === 1) inf *= 0.85;
      else                   inf *= 0.30;  // very hard without resistance
    } else if (c.climate === 'arid') {
      if      (heatLv === 2) inf *= 1.30;
      else if (heatLv === 1) inf *= 0.80;
      else                   inf *= 0.38;
    } else if (c.climate === 'tropical') {
      inf *= heatLv > 0 ? 1.15 : 0.88;
    }

    // Wealth
    if (c.wealth === 'poor')   inf *= 1.35;
    if (c.wealth === 'middle') inf *= 1.08;
    if (c.wealth === 'rich')   inf *= 0.76;

    // Urban trait bonus for dense countries
    if (state.traits.has('urban_survival') && c.pop > 80000000) inf *= 1.12;

    // Government airport/border closures reduce internal spread (quarantine)
    if (c.airportClosed) inf *= 0.88;

    // Full lockdown — dramatically reduces spread
    if (c.lockdown) inf *= 0.58;

    // Climate event boosts (cold_snap, heat_wave, etc.)
    const cb = state.eventBoosts.climateBoosts[c.climate];
    if (cb) inf *= (1 + cb);

    return Math.max(0, Math.min(inf, 0.92));
  }

  // ─── LETHALITY for a country ──────────────────
  function calcLethalRate(c) {
    let leth = state.lethality + state.eventBoosts.lethality;
    if (leth <= 0) return 0;

    if (c.wealth === 'rich')   leth *= 0.35;
    if (c.wealth === 'middle') leth *= 0.65;
    if (c.wealth === 'poor')   leth *= 1.25;

    // Per-tick death rate (small fraction of infected die each tick)
    return Math.min(leth * 0.0012, 0.0025);
  }

  // ─── GOVERNMENT RESPONSE ──────────────────────
  function checkGovernmentResponse(c, diff) {
    // Close airports when infected % crosses threshold
    if (!c.airportClosed && c.airports > 0) {
      const threshold = c.wealth === 'rich'   ? 0.002 :
                        c.wealth === 'middle' ? 0.008 : 0.02;
      if (c.infected_pct > threshold * diff.cureSpeed) {
        c.airportClosed = true;
        toast(`✈️ ${c.name} closes its airports`, 'warn');
        Events.triggerNews('spreading');
      }
    }

    // Declare full lockdown at higher infection levels
    if (!c.lockdown) {
      const lockThreshold = c.wealth === 'rich'   ? 0.015 :
                            c.wealth === 'middle' ? 0.05  : 0.12;
      if (c.infected_pct > lockThreshold * diff.cureSpeed) {
        c.lockdown = true;
        toast(`🔒 ${c.name} enters full national lockdown`, 'warn');
        Events.triggerNews('spreading');
      }
    }
  }

  // ─── GLOBAL SPREAD ────────────────────────────
  function spreadGlobal() {
    const travelMult = state.eventBoosts.travelMult * (state.airportsOpen ? 1 : 0.4);

    for (const iso in state.countries) {
      const src = state.countries[iso];
      if (!src.reached || src.infected < 200) continue;

      const srcPrev = src.infected_pct;

      // ── LAND BORDERS ──
      if (!state.bordersClosed && !src.bordersClosed) {
        for (const bIso of src.borders) {
          const dst = state.countries[bIso];
          if (!dst || dst.reached) continue;
          const chance = 0.009 * Math.min(srcPrev * 6, 1) * travelMult;
          if (Math.random() < chance) infectNewCountry(dst, 'land border', src.iso);
        }
      }

      // ── AIR TRAVEL ──
      if (src.airports > 0 && !src.airportClosed) {
        const chance = 0.002 * src.airports * Math.min(srcPrev * 4, 1) * travelMult;
        if (Math.random() < chance) {
          const dst = pickUninfectedWithAirports();
          if (dst) infectNewCountry(dst, 'air travel', src.iso);
        }
      }

      // ── SEA TRAVEL ──
      if (src.ports > 0) {
        const chance = 0.0011 * src.ports * Math.min(srcPrev * 3, 1) * travelMult;
        if (Math.random() < chance) {
          const dst = pickUninfectedWithPorts();
          if (dst) infectNewCountry(dst, 'sea route', src.iso);
        }
      }
    }

    // Fungus spore burst (random long-range jump)
    if (DISEASE_TYPES[state.diseaseType].sporeBurst && Math.random() < 0.006 * state.speed) {
      const dst = pickUninfected();
      const infectedArr = Object.values(state.countries).filter(c => c.reached);
      const sporeSrc = infectedArr.length ? infectedArr[Math.floor(Math.random() * infectedArr.length)] : null;
      if (dst) { infectNewCountry(dst, 'spore dispersal', sporeSrc?.iso); }
    }
  }

  function infectNewCountry(dst, method, srcIso) {
    const seed = Math.max(8, Math.floor(dst.pop * 0.0000007));
    dst.infected = seed; dst.healthy = dst.pop - seed; dst.reached = true;
    state.countriesInfected++;
    toast(`🌍 ${state.diseaseName} spreads to ${dst.name} via ${method}`, 'info');
    if (typeof AudioEngine !== 'undefined') AudioEngine.sfxNewCountry();
    Events.triggerNews('spreading');
    awardDna(3);
    if (Map && Map.pulseCountry) Map.pulseCountry(dst.iso);
    if (Map && Map.showTravelRoute && srcIso != null) Map.showTravelRoute(srcIso, dst.iso);
  }

  function pickUninfected() {
    const arr = Object.values(state.countries).filter(c => !c.reached);
    return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
  }
  function pickUninfectedWithAirports() {
    const arr = Object.values(state.countries).filter(c => !c.reached && c.airports > 0 && !c.airportClosed);
    return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
  }
  function pickUninfectedWithPorts() {
    const arr = Object.values(state.countries).filter(c => !c.reached && c.ports > 0);
    return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
  }

  // ─── CURE RESEARCH ────────────────────────────
  function advanceCure(diff) {
    let rate = 0;
    for (const iso in state.countries) {
      const c = state.countries[iso];
      if (c.reached || c.dead > 0) {
        rate += c.cureContrib;
        // More countries aware = faster cure
        if (c.infected_pct > 0.01) rate += c.cureContrib * 0.5;
      }
    }

    // Severity awareness multiplier
    rate *= (1 + state.severity * 1.8);

    // Difficulty
    rate *= diff.cureSpeed;

    // Resistance
    const resist = Math.min(0.88, state.cureResist + state.eventBoosts.cureResist);
    rate *= (1 - resist);

    // Cap per tick
    rate = Math.min(rate, 0.10);
    state.cureProgress = Math.min(100, state.cureProgress + rate);

    UI.updateCureBar(state.cureProgress);
  }

  // ─── VIRUS MUTATION ───────────────────────────
  function handleMutation() {
    const allTraits = [
      ...EVOLUTION_TREE.transmissions,
      ...EVOLUTION_TREE.symptoms,
      ...EVOLUTION_TREE.abilities,
    ].filter(t => !state.traits.has(t.id) && t.requires.every(r => state.traits.has(r)));

    if (!allTraits.length) return;
    const t = allTraits[Math.floor(Math.random() * allTraits.length)];
    applyEffects(t, 0.25);
    toast(`🧬 Mutation! ${t.name} partially evolved`, 'dna');
    UI.updateStatBars();
  }

  // ─── EVENTS TICK ──────────────────────────────
  function tickEvents() {
    state.eventBoosts = { infectivity: 0, cureResist: 0, travelMult: 1, lethality: 0, climateBoosts: {} };
    state.activeEvents = state.activeEvents.filter(ev => {
      ev.remaining--;
      if (ev.remaining <= 0) return false;
      if (ev.effect.infectivityBoost) state.eventBoosts.infectivity  += ev.effect.infectivityBoost;
      if (ev.effect.cureResist)       state.eventBoosts.cureResist   += ev.effect.cureResist;
      if (ev.effect.travelMult)       state.eventBoosts.travelMult   *= ev.effect.travelMult;
      if (ev.effect.lethalityBoost)   state.eventBoosts.lethality    += ev.effect.lethalityBoost;
      if (ev.effect.climateBoost) {
        for (const [climate, val] of Object.entries(ev.effect.climateBoost)) {
          state.eventBoosts.climateBoosts[climate] = (state.eventBoosts.climateBoosts[climate] || 0) + val;
        }
      }
      return true;
    });
  }

  // ─── WIN / LOSE ───────────────────────────────
  function checkEndConditions() {
    // Win: everyone dead
    if (state.totalHealthy <= 0 && state.totalInfected <= 0 && state.totalDead > 0) {
      endGame(true); return;
    }

    // Also win if dead >= 99.9% of pop
    if (state.totalDead >= state.totalPop * 0.999) {
      endGame(true); return;
    }

    // Lose: cure complete → rapidly cure infected
    if (state.cureProgress >= 100) {
      if (state.totalInfected <= 0) { endGame(false); return; }
      deployCure();
    }
  }

  function deployCure() {
    // Rapidly cure remaining infected
    for (const iso in state.countries) {
      const c = state.countries[iso];
      if (c.infected <= 0) continue;
      const cured = Math.ceil(c.infected * 0.12);
      c.infected -= cured; c.healthy += cured;
      if (c.infected < 0) c.infected = 0;
    }
    state.totalInfected = Object.values(state.countries).reduce((a, c) => a + c.infected, 0);
    if (state.totalInfected <= 0) endGame(false);
  }

  function endGame(won) {
    if (state.phase === 'won' || state.phase === 'lost') return;
    state.phase = won ? 'won' : 'lost';
    clearInterval(state.tickInterval); state.tickInterval = null;
    if (typeof AudioEngine !== 'undefined') {
      won ? AudioEngine.sfxWin() : AudioEngine.sfxLose();
    }
    setTimeout(() => UI.showGameOver(won, state), 1200);
  }

  // ─── BUY / DEVOLVE TRAIT ─────────────────────
  function buyTrait(traitId) {
    const trait = findTrait(traitId);
    if (!trait) return { ok: false, msg: 'Unknown trait' };
    if (state.traits.has(traitId)) return { ok: false, msg: 'Already owned' };
    if (trait.requires.some(r => !state.traits.has(r))) return { ok: false, msg: 'Requirements not met' };
    if (state.dna < trait.cost) return { ok: false, msg: 'Not enough DNA' };

    state.dna      -= trait.cost;
    state.dnaSpent += trait.cost;
    state.traits.add(traitId);
    applyEffects(trait, 1.0);

    toast(`⚡ Evolved: ${trait.name}`, 'dna');
    UI.updateDnaDisplay();
    UI.updateStatBars();
    Evolution.refreshTree();
    return { ok: true };
  }

  function devolveTrait(traitId) {
    const trait = findTrait(traitId);
    if (!trait || !state.traits.has(traitId)) return { ok: false, msg: 'Not owned' };

    // Check nothing depends on this trait
    const allTraits = getAllTraits();
    const dependants = allTraits.filter(t =>
      t.requires.includes(traitId) && state.traits.has(t.id)
    );
    if (dependants.length > 0) {
      return { ok: false, msg: `Devolve ${dependants.map(d=>d.name).join(', ')} first` };
    }

    // Refund 50%
    const refund = Math.max(1, Math.floor(trait.cost * 0.5));
    state.traits.delete(traitId);
    reverseEffects(trait);

    state.dna      += refund;
    state.dnaSpent -= refund;

    toast(`↩ Devolved: ${trait.name} (+${refund} DNA)`, 'warn');
    UI.updateDnaDisplay();
    UI.updateStatBars();
    Evolution.refreshTree();
    return { ok: true };
  }

  function applyEffects(trait, mult) {
    const e = trait.effects || {};
    if (e.infectivity) state.infectivity = Math.min(0.95, state.infectivity + e.infectivity * mult);
    if (e.severity)    state.severity    = Math.min(1.00, state.severity    + e.severity    * mult);
    if (e.lethality)   state.lethality   = Math.min(1.00, state.lethality   + e.lethality   * mult);
    if (e.cureResist)  state.cureResist  = Math.min(0.90, state.cureResist  + e.cureResist  * mult);
  }

  function reverseEffects(trait) {
    // Rebuild stats from scratch from remaining traits
    state.infectivity = state.baseInfectivity;
    state.severity    = state.baseSeverity;
    state.lethality   = 0;
    state.cureResist  = 0;
    for (const id of state.traits) {
      const t = findTrait(id);
      if (t) applyEffects(t, 1.0);
    }
  }

  function findTrait(id) {
    return getAllTraits().find(t => t.id === id) || null;
  }
  function getAllTraits() {
    return [
      ...EVOLUTION_TREE.transmissions,
      ...EVOLUTION_TREE.symptoms,
      ...EVOLUTION_TREE.abilities,
    ];
  }

  // ─── DNA ──────────────────────────────────────
  function awardDna(amount) {
    state.dna += amount;
    UI.showDnaPopup(amount);
    UI.updateDnaDisplay();
    if (typeof AudioEngine !== 'undefined' && amount >= 2) AudioEngine.sfxDNA();
  }

  // ─── TOAST ────────────────────────────────────
  function toast(msg, type) {
    state.notifications.push(msg);
    UI.toast(msg, type);
  }

  // ─── SAVE / LOAD ──────────────────────────────
  const SAVE_KEY = 'pathogen_save_v1';

  function saveGame() {
    if (state.phase !== 'spreading') return false;
    try {
      const payload = {
        version: 1,
        savedAt: Date.now(),
        diseaseName:    state.diseaseName,
        diseaseType:    state.diseaseType,
        difficulty:     state.difficulty,
        infectivity:    state.infectivity,
        severity:       state.severity,
        lethality:      state.lethality,
        cureResist:     state.cureResist,
        baseInfectivity:state.baseInfectivity,
        baseSeverity:   state.baseSeverity,
        totalPop:       state.totalPop,
        totalInfected:  state.totalInfected,
        totalDead:      state.totalDead,
        cureProgress:   state.cureProgress,
        cureActive:     state.cureActive,
        day:            state.day,
        countriesInfected: state.countriesInfected,
        peakInfected:   state.peakInfected,
        dna:            state.dna,
        dnaSpent:       state.dnaSpent,
        traits:         [...state.traits],
        countries:      state.countries,
        airportsOpen:   state.airportsOpen,
        bordersClosed:  state.bordersClosed,
        activeEvents:   state.activeEvents,
        eventBoosts:    state.eventBoosts,
        originIso:      state.originIso,
        speed:          state.speed,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      return true;
    } catch (e) {
      console.error('Save failed:', e);
      return false;
    }
  }

  function loadSave(data) {
    const d = data || JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!d || d.version !== 1) return false;
    if (state.tickInterval) { clearInterval(state.tickInterval); state.tickInterval = null; }
    state.diseaseName    = d.diseaseName    || 'Unnamed';
    state.diseaseType    = d.diseaseType    || 'bacteria';
    state.difficulty     = d.difficulty     || 'normal';
    state.infectivity    = d.infectivity    ?? 0.18;
    state.severity       = d.severity       ?? 0.04;
    state.lethality      = d.lethality      ?? 0;
    state.cureResist     = d.cureResist     ?? 0;
    state.baseInfectivity= d.baseInfectivity ?? 0.18;
    state.baseSeverity   = d.baseSeverity   ?? 0.04;
    state.totalPop       = d.totalPop       || 0;
    state.totalInfected  = d.totalInfected  || 0;
    state.totalDead      = d.totalDead      || 0;
    state.cureProgress   = d.cureProgress   || 0;
    state.cureActive     = d.cureActive     || false;
    state.day            = d.day            || 0;
    state.countriesInfected = d.countriesInfected || 0;
    state.peakInfected   = d.peakInfected   || 0;
    state.dna            = d.dna            || 0;
    state.dnaSpent       = d.dnaSpent       || 0;
    state.traits         = new Set(d.traits || []);
    state.countries      = d.countries      || {};
    state.airportsOpen   = d.airportsOpen   ?? true;
    state.bordersClosed  = d.bordersClosed  ?? false;
    state.activeEvents   = d.activeEvents   || [];
    state.eventBoosts    = d.eventBoosts    || { infectivity: 0, cureResist: 0, travelMult: 1, lethality: 0, climateBoosts: {} };
    state.originIso      = d.originIso      || null;
    state.speed          = d.speed          || 1;
    state.phase          = 'spreading';
    state.paused         = true;
    state.tickInterval   = null;
    state.pendingDna     = 0;
    state.totalHealthy   = state.totalPop - state.totalInfected - state.totalDead;
    return true;
  }

  function hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch {}
  }

  function getSaveMeta() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return { day: d.day, diseaseName: d.diseaseName, savedAt: d.savedAt };
    } catch { return null; }
  }

  // ─── PUBLIC ───────────────────────────────────
  function getState()           { return state; }
  function getCountry(iso)      { return state.countries[iso] || null; }
  function getAllCountries()     { return Object.values(state.countries); }
  function getStats() {
    return {
      totalPop:      state.totalPop,
      totalInfected: state.totalInfected,
      totalDead:     state.totalDead,
      totalHealthy:  state.totalHealthy,
      cureProgress:  state.cureProgress,
      day:           state.day,
      dna:           state.dna,
      dnaSpent:      state.dnaSpent,
      countriesInfected: state.countriesInfected,
      peakInfected:  state.peakInfected,
    };
  }

  return {
    init, startInCountry, setSpeed, setPaused,
    buyTrait, devolveTrait, findTrait, getAllTraits,
    awardDna, toast,
    getState, getStats, getCountry, getAllCountries,
    getHistory: () => _history,
    saveGame, loadSave, hasSave, clearSave, getSaveMeta,
  };
})();

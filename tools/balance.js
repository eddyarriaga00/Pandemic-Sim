#!/usr/bin/env node
/* Headless playtests for balancing.
   Runs the real engine (js/data.js + js/game.js) with scripted players and
   prints win rates and game lengths.

     node tools/balance.js                 all types, standard difficulty
     node tools/balance.js --games 100
     node tools/balance.js --difficulty severe --type virus
     node tools/balance.js --trace         one planner game, printed every 30 days
*/
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const src  = ['js/data.js', 'js/game.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');

function newGame() {
  const ctx = vm.createContext({ console });
  vm.runInContext(src + '\nthis.Game = Game; this.TYPES = DISEASE_TYPES; this.DIFFS = DIFFICULTIES; this.TREE = EVOLUTION_TREE;', ctx);
  return ctx;
}

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? dflt : (process.argv[i + 1] || true);
};

// ─── SCRIPTED PLAYERS ───────────────────────────
const SPREAD_ORDER = ['saliva1', 'air1', 'water1', 'cold_resist1', 'heat_resist1', 'air2', 'water2',
  'travel_adaptation', 'saliva2', 'livestock', 'drug_resist1', 'extreme_bioaerosol', 'rats', 'insects',
  'cold_resist2', 'heat_resist2', 'biofilm', 'blood1', 'urban_survival', 'rural_survival'];
const RESIST_ORDER = ['drug_resist1', 'genetic_hardening1', 'resilience1', 'drug_resist2', 'genetic_hardening2',
  'resilience2', 'drug_resist3'];
const KILL_ORDER = ['cough', 'pneumonia', 'rash', 'necrosis', 'fever', 'sweating', 'hemorrhagic_shock',
  'pulmonary_fibrosis', 'seizures', 'insanity', 'coma', 'total_organ_failure', 'immune_suppression'];

function buyFirst(G, order) {
  for (const id of order) {
    const gs = G.getState();
    if (gs.traits.has(id)) continue;
    const t = G.findTrait(id);
    if (!t.requires.every(r => gs.traits.has(r))) continue;
    return gs.dna >= t.cost ? G.buyTrait(id).ok : false; // save up for the next item in line
  }
  return false;
}

const BOTS = {
  // Spread quietly, harden against the cure, only turn lethal once everyone is infected.
  planner(G) {
    const gs = G.getState();
    const everyoneInfected = gs.totalHealthy / gs.totalPop < 0.002;
    const ready = id => { const s = G.opStatus(id); return !s.blocked && s.affordable; };
    if (ready('disinfo') && gs.cureProgress > 35) G.useOperation('disinfo');
    if (ready('smugglers') && gs.advice.sealed > 0 && gs.dna >= 14) G.useOperation('smugglers');
    if (ready('superspreader') && gs.day > 40 && gs.dna >= 16 && !everyoneInfected) G.useOperation('superspreader');
    if (everyoneInfected || gs.cureProgress > 70) { while (buyFirst(G, KILL_ORDER)) {} return; }
    for (const id of gs.freeTraits) G.devolveTrait(id); // shed unwanted mutations while hiding
    if (gs.cureProgress > 25 && buyFirst(G, RESIST_ORDER)) return;
    buyFirst(G, SPREAD_ORDER);
  },
  // Buys lethal symptoms as soon as it can afford them.
  rusher(G) { if (!buyFirst(G, KILL_ORDER)) buyFirst(G, SPREAD_ORDER); },
  // Buys something affordable at random every few days.
  random(G, rnd) {
    if (rnd() > 0.25) return;
    const gs = G.getState();
    const opts = G.getAllTraits().filter(t => !gs.traits.has(t.id) && gs.dna >= t.cost &&
      t.requires.every(r => gs.traits.has(r)));
    if (opts.length) G.buyTrait(opts[Math.floor(rnd() * opts.length)].id);
  },
};

function play(type, difficulty, botName, seed, trace) {
  const { Game: G } = newGame();
  let s = seed * 7919 + 1;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  G.init({ name: 'Test', type, difficulty, seed });
  const origins = [356, 156, 566, 76, 818, 360];
  G.startInCountry(origins[seed % origins.length]);
  const gs = G.getState();
  let lastDay = 0;
  while (gs.phase === 'spreading' && gs.day < 3000) {
    G.step();
    if (gs.day === lastDay) continue;
    lastDay = gs.day;
    for (const b of G.getBubbles()) if (rnd() < 0.15) G.collectBubble(b.id);
    const dl = G.getDilemma();
    if (dl) {
      // The planner avoids attention and unplanned symptoms; the others pick blind.
      let pick = Math.floor(rnd() * dl.options.length);
      if (botName === 'planner') {
        const score = o => (o.detect || 0) * -10 + (o.mutate ? -4 : 0) + (o.dna || 0) * 0.5 + (o.boost ? 2 : 0) + (o.cure ? 3 : 0);
        pick = dl.options.map((o, i) => [o.affordable ? score(o) : -99, i]).sort((a, b) => b[0] - a[0])[0][1];
      }
      if (!G.resolveDilemma(pick).ok) G.resolveDilemma(1 - pick);
    }
    BOTS[botName](G, rnd);
    if (trace && gs.day % 30 === 0) {
      console.log(`d${String(gs.day).padStart(4)} inf ${(gs.totalInfected / 1e6).toFixed(1).padStart(8)}M  dead ${(gs.totalDead / 1e6).toFixed(1).padStart(8)}M  ` +
        `countries ${String(gs.countriesInfected).padStart(3)}  detect ${(gs.detection * 100).toFixed(0).padStart(3)}%  cure ${gs.cureProgress.toFixed(1).padStart(5)}%  ` +
        `dna ${String(gs.dna).padStart(3)} spent ${String(gs.dnaSpent).padStart(3)}  traits ${gs.traits.size}`);
    }
  }
  return { won: gs.phase === 'won', reason: gs.endReason || 'timeout', day: gs.day,
           dna: gs.dna + gs.dnaSpent, countries: gs.countriesInfected };
}

// ─── REPORT ─────────────────────────────────────
const ctx0   = newGame();
const games  = +arg('games', 30);
const diffs  = arg('difficulty') ? [arg('difficulty')] : ['standard'];
const types  = arg('type') ? [arg('type')] : Object.keys(ctx0.TYPES);
const bots   = arg('bot') ? [arg('bot')] : Object.keys(BOTS);

if (arg('trace')) {
  console.log(play(types[0], diffs[0], bots[0], +arg('seed', 1), true));
  process.exit(0);
}

const median = a => a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 0;
console.log('difficulty  type        bot       win%  median days (win/loss)  dna   losses');
for (const d of diffs) for (const t of types) for (const b of bots) {
  const r = [];
  for (let i = 0; i < games; i++) r.push(play(t, d, b, i + 1));
  const wins = r.filter(x => x.won), losses = r.filter(x => !x.won);
  const why = {};
  for (const l of losses) why[l.reason] = (why[l.reason] || 0) + 1;
  console.log(`${d.padEnd(11)} ${t.padEnd(11)} ${b.padEnd(8)} ${String(Math.round(100 * wins.length / games)).padStart(4)}%  ` +
    `${String(median(wins.map(x => x.day))).padStart(5)} / ${String(median(losses.map(x => x.day))).padEnd(5)}         ` +
    `${String(median(r.map(x => x.dna))).padStart(4)}  ${JSON.stringify(why)}`);
}

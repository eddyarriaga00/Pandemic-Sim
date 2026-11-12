/* ═══════════════════════════════════════════════
   PATHOGEN v3 - Achievements
   Kept on this device. Checked every few game days and when a run ends.
   ═══════════════════════════════════════════════ */

const Achievements = (() => {
  const KEY = 'pathogen_achievements_v1';

  // `live` is checked during play, `end` when the run finishes.
  const LIST = [
    { id: 'first',      name: 'Patient Zero',       desc: 'Win a game.',
      end: (gs, won) => won },
    { id: 'fast',       name: 'Flash Flood',        desc: 'Win in 380 days or fewer.',
      end: (gs, won) => won && gs.day <= 380 },
    { id: 'close',      name: 'Photo Finish',       desc: 'Win with the cure at 85% or more.',
      end: (gs, won) => won && gs.cureProgress >= 85 },
    { id: 'severe',     name: 'Uphill',             desc: 'Win on Severe.',
      end: (gs, won) => won && gs.difficulty === 'severe' },
    { id: 'extinction', name: 'Nobody Left',        desc: 'Win on Extinction.',
      end: (gs, won) => won && gs.difficulty === 'extinction' },
    { id: 'alltypes',   name: 'Full Spectrum',      desc: 'Win with all six pathogen types.',
      end: (gs, won) => won && Object.keys(DISEASE_TYPES).every(t =>
        t === gs.diseaseType || Object.keys(UI.Records.all()).some(k => k.startsWith(t + '|'))) },
    { id: 'daily',      name: 'Daily Dose',         desc: 'Win a Daily Outbreak.',
      end: (gs, won) => won && gs.mode === 'daily' },
    { id: 'specialist', name: 'Specialist',         desc: 'Win owning both of your type\'s signature traits.',
      end: (gs, won) => won && Game.getAllTraits().filter(t => t.types).every(t => gs.traits.has(t.id)) },
    { id: 'burnout',    name: 'Too Hot to Handle',  desc: 'Kill your last host with people still uninfected.',
      end: (gs, won, reason) => reason === 'burnout' },
    { id: 'everywhere', name: 'World Tour',         desc: 'Infect every country.',
      live: gs => gs.countriesInfected === Object.keys(gs.countries).length },
    { id: 'ghost',      name: 'Under the Radar',    desc: 'Infect a billion people before being identified.',
      live: gs => !gs.cureActive && gs.totalInfected >= 1e9 },
    { id: 'chemist',    name: 'Chemistry Set',      desc: 'Discover four synergies in one run.',
      live: gs => gs.synergiesFound.length >= 4 },
    { id: 'mutant',     name: 'Loose Cannon',       desc: 'Carry three mutated symptoms at once.',
      live: gs => gs.freeTraits.size >= 3 },
    { id: 'smuggler',   name: 'Back Channels',      desc: 'Use the Smuggling Network three times in one run.',
      live: gs => (gs.ops.smugglers ? gs.ops.smugglers.uses : 0) >= 3 },
    { id: 'enemy',      name: 'Public Enemy',       desc: 'Provoke sixty countermeasures in one run.',
      live: gs => gs.counters.measures >= 60 },
  ];

  function unlocked() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }

  function grant(a) {
    const got = unlocked();
    if (got[a.id]) return;
    got[a.id] = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(got)); } catch {}
    UI.toast(`Achievement unlocked: ${a.name}`, 'dna');
    UI.buzz(15);
  }

  function onDay(gs) {
    if (gs.day % 5) return;
    for (const a of LIST) if (a.live && a.live(gs)) grant(a);
  }

  function onEnd(gs, won, reason) {
    for (const a of LIST) if (a.end && a.end(gs, won, reason)) grant(a);
  }

  function render(container) {
    const got = unlocked();
    container.innerHTML = LIST.map(a => `
      <div class="ach-row${got[a.id] ? ' got' : ''}">
        <span class="ach-mark">${UI.icon(got[a.id] ? 'check' : 'lock')}</span>
        <span class="ach-text"><b>${a.name}</b><span>${a.desc}</span></span>
      </div>`).join('');
  }

  const count = () => `${Object.keys(unlocked()).filter(id => LIST.some(a => a.id === id)).length}/${LIST.length}`;

  return { onDay, onEnd, render, count };
})();

/* ═══════════════════════════════════════════════
   PATHOGEN v3 - Evolution Tree UI
   ═══════════════════════════════════════════════ */

const Evolution = (() => {
  let activeTab = 'transmissions';
  let initialized = false;

  // Short labels for what a trait does beyond the four stat bars.
  const plus = (v, what) => `+${Math.round(v * 100)}% ${what}`;
  const MOD_LABELS = {
    air:      v => plus(v, 'by plane'),
    sea:      v => plus(v, 'by ship'),
    land:     v => plus(v, 'over land'),
    tropical: v => plus(v, 'in tropics'),
    poor:     v => plus(v, 'in poor nations'),
    rich:     v => plus(v, 'in rich nations'),
    urban:    v => plus(v, 'in huge nations'),
    rural:    v => plus(v, 'in small nations'),
    stealth:  v => plus(v, 'harder to detect'),
    dnaRate:  v => plus(v, 'DNA income'),
    leak:     () => 'slips past closures',
    lockdownResist: () => 'weakens lockdowns',
    cold:     () => 'cold climates',
    heat:     () => 'hot climates',
    extremophile: () => 'all climates',
  };

  function init() {
    if (initialized) return;
    initialized = true;

    document.querySelectorAll('.evo-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activeTab = tab.dataset.tab;
        document.querySelectorAll('.evo-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.evo-tab-content').forEach(c => c.classList.add('hidden'));
        tab.classList.add('active');
        document.getElementById(`evo-tab-${activeTab}`).classList.remove('hidden');
        renderTab(activeTab);
      });
    });

    document.getElementById('btn-close-evo').addEventListener('click', close);

    document.getElementById('modal-evolution').addEventListener('click', e => {
      if (e.target === document.getElementById('modal-evolution')) close();
    });
  }

  function open() {
    const gs = Game.getState();
    document.getElementById('evo-disease-name').textContent = gs.diseaseName;
    refreshTree();
    document.getElementById('modal-evolution').classList.remove('hidden');
    document.body.classList.add('evo-open');
    if (typeof AudioEngine !== 'undefined') AudioEngine.sfxEvoOpen();
  }

  function close() {
    document.getElementById('modal-evolution').classList.add('hidden');
    document.body.classList.remove('evo-open');
  }

  function refreshTree() {
    renderTab('transmissions');
    renderTab('symptoms');
    renderTab('abilities');
    renderOps();
    UI.updateStatBars();
    document.getElementById('evo-dna-count').textContent = Game.getState().dna;
  }

  function isOpen() {
    return !document.getElementById('modal-evolution').classList.contains('hidden');
  }

  // ─── OPERATIONS ───────────────────────────────
  function renderOps() {
    const container = document.getElementById('tree-operations');
    if (!container) return;
    container.innerHTML = Game.getOperations().map(op => {
      const st = Game.opStatus(op.id);
      const ready = !st.blocked && st.affordable;
      const status = st.blocked
        ? `<span class="trait-cost locked-cost">${st.blocked}</span>`
        : `<span class="trait-cost ${st.affordable ? '' : 'cant-afford'}">${UI.icon('bolt')} ${st.cost} DNA</span>
           <span class="op-go">${st.affordable ? 'DEPLOY ›' : ''}</span>`;
      return `<div class="trait-card op-card${ready ? ' op-ready' : ''}${st.blocked ? ' locked' : ''}" data-op="${op.id}">
        <span class="trait-icon">${op.icon}</span>
        <div class="trait-name">${op.name}</div>
        <div class="trait-desc">${op.desc}</div>
        <div class="trait-effects">${op.cooldown} day cooldown${st.uses ? ` · used ${st.uses}×` : ''}</div>
        <div class="trait-footer">${status}</div>
      </div>`;
    }).join('');
    container.querySelectorAll('.op-card').forEach(card => {
      card.addEventListener('click', () => {
        const result = Game.useOperation(card.dataset.op);
        if (!result.ok) showFlash(result.msg === 'Not enough DNA' ? 'Not enough DNA' : result.msg, 'red');
        else AudioEngine.sfxTraitPurchase();
        renderOps();
      });
    });
  }

  // One trait card. `gs` is the game state.
  function buildCard(trait, gs) {
    const owned  = gs.traits.has(trait.id);
    const locked = !trait.requires.every(r => gs.traits.has(r));
    const afford = gs.dna >= trait.cost;
    const free   = gs.freeTraits.has(trait.id);

    const card = document.createElement('div');
    card.className = `trait-card${owned ? ' owned' : ''}${locked ? ' locked' : ''}${!owned && !locked && afford ? ' buyable' : ''}`;

    const effArr = [];
    const e = trait.effects || {};
    const fmtEff = (v, label) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}% ${label}`;
    if (e.infectivity) effArr.push(fmtEff(e.infectivity, 'inf'));
    if (e.severity)    effArr.push(fmtEff(e.severity,    'sev'));
    if (e.lethality)   effArr.push(fmtEff(e.lethality,   'leth'));
    if (e.cureResist)  effArr.push(fmtEff(e.cureResist,  'resist'));
    for (const k in (trait.mods || {})) {
      const label = MOD_LABELS[k];
      if (label) effArr.push(label(trait.mods[k]));
    }

    card.innerHTML = `
      <span class="trait-icon">${trait.icon}</span>
      <div class="trait-name">${trait.name}</div>
      <div class="trait-desc">${trait.desc}</div>
      ${effArr.length ? `<div class="trait-effects">${effArr.join(' · ')}</div>` : ''}
      <div class="trait-footer">
        ${owned
          ? `<span class="trait-owned-badge">${free ? UI.icon('helix') + ' MUTATED' : UI.icon('check') + ' EVOLVED'}</span>
             <button class="trait-devolve-btn" data-id="${trait.id}">DEVOLVE${free ? '' : ` +${Math.max(1, Math.floor(trait.cost * 0.5))}`}</button>`
          : locked
            ? `<span class="trait-cost locked-cost">${UI.icon('lock')} Needs ${trait.requires.filter(r => !gs.traits.has(r)).map(r => Game.findTrait(r)?.name || r).join(' + ')}</span>`
            : `<span class="trait-cost ${afford ? '' : 'cant-afford'}">${UI.icon('bolt')} ${trait.cost} DNA</span>`
        }
      </div>
    `;
    if (!owned && !locked) card.addEventListener('click', () => purchase(trait.id));
    return card;
  }

  // Group a tab's traits into chains: each root trait followed by everything
  // that builds on it, arranged in columns by how many steps deep it is.
  function chainsFor(traits) {
    const inTab = new Set(traits.map(t => t.id));
    const depth = {}, rootOf = {};
    const resolve = t => {
      if (depth[t.id]) return;
      const reqs = t.requires.filter(r => inTab.has(r)).map(r => traits.find(x => x.id === r));
      if (!reqs.length) { depth[t.id] = 1; rootOf[t.id] = t.id; return; }
      reqs.forEach(resolve);
      depth[t.id]  = 1 + Math.max(...reqs.map(r => depth[r.id]));
      rootOf[t.id] = rootOf[reqs[0].id];
    };
    traits.forEach(resolve);
    const chains = [];
    for (const root of traits.filter(t => depth[t.id] === 1)) {
      const members = traits.filter(t => rootOf[t.id] === root.id);
      const cols = [];
      for (const t of members) (cols[depth[t.id] - 1] = cols[depth[t.id] - 1] || []).push(t);
      chains.push({ root, cols });
    }
    return chains;
  }

  function renderTab(tab) {
    if (tab === 'operations') return renderOps();
    const container = document.getElementById(`tree-${tab}`);
    if (!container) return;

    const gs     = Game.getState();
    const chains = chainsFor(EVOLUTION_TREE[tab]);
    container.className = 'trait-lanes';
    container.innerHTML = '';

    // Real chains first, drawn as left-to-right paths
    for (const { root, cols } of chains.filter(c => c.cols.length > 1)) {
      const lane = document.createElement('div');
      lane.className = 'lane';
      lane.innerHTML = `<div class="lane-title">${root.name.replace(/ 1$/, '')}</div>`;
      const track = document.createElement('div');
      track.className = 'lane-track';
      cols.forEach((col, i) => {
        if (i > 0) {
          const link = document.createElement('div');
          // The path is lit once the step before it has been taken
          link.className = 'lane-link' + (cols[i - 1].some(t => gs.traits.has(t.id)) ? ' open' : '');
          track.appendChild(link);
        }
        const column = document.createElement('div');
        column.className = 'lane-col';
        col.forEach(t => column.appendChild(buildCard(t, gs)));
        track.appendChild(column);
      });
      lane.appendChild(track);
      container.appendChild(lane);
    }

    // Then the traits nothing else depends on
    const singles = chains.filter(c => c.cols.length === 1);
    if (singles.length) {
      const lane = document.createElement('div');
      lane.className = 'lane';
      lane.innerHTML = '<div class="lane-title">Standalone</div>';
      const grid = document.createElement('div');
      grid.className = 'trait-grid';
      singles.forEach(c => grid.appendChild(buildCard(c.root, gs)));
      lane.appendChild(grid);
      container.appendChild(lane);
    }

    // Wire devolve buttons
    container.querySelectorAll('.trait-devolve-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        devolve(btn.dataset.id);
      });
    });
  }

  // The engine announces trait changes, which re-renders the tree.
  function purchase(traitId) {
    const result = Game.buyTrait(traitId);
    if (!result.ok) showFlash(result.msg === 'Not enough DNA' ? 'Not enough DNA' : result.msg, 'red');
    else { AudioEngine.sfxTraitPurchase(); UI.buzz(10); }
  }

  function devolve(traitId) {
    const result = Game.devolveTrait(traitId);
    if (!result.ok) showFlash(`Cannot devolve: ${result.msg}`, 'red');
    else AudioEngine.sfxTraitDevolve();
  }

  function showFlash(msg, color) {
    const el = document.createElement('div');
    const bg  = color === 'green' ? 'rgba(22,27,34,0.98)' : 'rgba(22,27,34,0.98)';
    const bdr = color === 'green' ? '#3fb950' : '#f85149';
    const clr = color === 'green' ? '#3fb950' : '#f85149';
    el.style.cssText = `
      position:fixed; top:50%; left:50%;
      transform:translate(-50%,-50%);
      background:${bg};
      border:1px solid ${bdr};
      border-left: 3px solid ${bdr};
      color:${clr};
      font-family:'Inter',system-ui,sans-serif;
      font-size:0.85rem; font-weight:600;
      padding:12px 22px; border-radius:8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      z-index:9999; pointer-events:none;
      animation: toastIn 0.2s ease-out;
    `;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  return { init, open, close, refreshTree, renderTab, renderOps, isOpen };
})();

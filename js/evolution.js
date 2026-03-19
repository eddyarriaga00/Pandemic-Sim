/* ═══════════════════════════════════════════════
   PATHOGEN v2 - Evolution Tree UI
   ═══════════════════════════════════════════════ */

const Evolution = (() => {
  let activeTab = 'transmissions';
  let initialized = false;

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
    if (typeof AudioEngine !== 'undefined') AudioEngine.sfxEvoOpen();
  }

  function close() {
    document.getElementById('modal-evolution').classList.add('hidden');
  }

  function refreshTree() {
    renderTab('transmissions');
    renderTab('symptoms');
    renderTab('abilities');
    UI.updateStatBars();
    document.getElementById('evo-dna-count').textContent = Game.getState().dna;
  }

  function renderTab(tab) {
    const container = document.getElementById(`tree-${tab}`);
    if (!container) return;

    const gs     = Game.getState();
    const traits = EVOLUTION_TREE[tab];

    container.innerHTML = '';

    for (const trait of traits) {
      const owned   = gs.traits.has(trait.id);
      const reqsMet = trait.requires.every(r => gs.traits.has(r));
      const locked  = !reqsMet;
      const afford  = gs.dna >= trait.cost;

      const card = document.createElement('div');
      card.className = `trait-card${owned ? ' owned' : ''}${locked ? ' locked' : ''}`;

      // Build effects preview string
      const effArr = [];
      const e = trait.effects || {};
      if (e.infectivity) effArr.push(`+${(e.infectivity*100).toFixed(0)}% inf`);
      if (e.severity)    effArr.push(`+${(e.severity*100).toFixed(0)}% sev`);
      if (e.lethality)   effArr.push(`+${(e.lethality*100).toFixed(0)}% leth`);
      if (e.cureResist)  effArr.push(`+${(e.cureResist*100).toFixed(0)}% resist`);

      card.innerHTML = `
        <span class="trait-icon">${trait.icon}</span>
        <div class="trait-name">${trait.name}</div>
        <div class="trait-desc">${trait.desc}</div>
        ${effArr.length ? `<div class="trait-effects">${effArr.join(' · ')}</div>` : ''}
        <div class="trait-footer">
          ${owned
            ? `<span class="trait-owned-badge">✓ EVOLVED</span>
               <button class="trait-devolve-btn" data-id="${trait.id}">↩ DEVOLVE</button>`
            : locked
              ? `<span class="trait-cost locked-cost">🔒 Req: ${trait.requires.map(r => Game.findTrait(r)?.name || r).join(' + ')}</span>`
              : `<span class="trait-cost ${afford ? '' : 'cant-afford'}">⚡ ${trait.cost} DNA</span>`
          }
        </div>
      `;

      if (!owned && !locked) {
        card.addEventListener('click', () => purchase(trait.id));
      }

      container.appendChild(card);
    }

    // Wire devolve buttons
    container.querySelectorAll('.trait-devolve-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        devolve(btn.dataset.id);
      });
    });
  }

  function purchase(traitId) {
    const result = Game.buyTrait(traitId);
    if (!result.ok) {
      showFlash(result.msg === 'Not enough DNA' ? `⚡ Not enough DNA!` : result.msg, 'red');
    } else {
      if (typeof AudioEngine !== 'undefined') AudioEngine.sfxTraitPurchase();
    }
    refreshTree();
  }

  function devolve(traitId) {
    const result = Game.devolveTrait(traitId);
    if (!result.ok) {
      showFlash(`Cannot devolve: ${result.msg}`, 'red');
    } else {
      if (typeof AudioEngine !== 'undefined') AudioEngine.sfxTraitDevolve();
    }
    refreshTree();
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

  return { init, open, close, refreshTree, renderTab };
})();

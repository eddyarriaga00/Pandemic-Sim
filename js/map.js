/* ═══════════════════════════════════════════════
   PATHOGEN v2 - World Map (D3 + TopoJSON)
   ═══════════════════════════════════════════════ */

const Map = (() => {
  let svg, g, projection, pathGen, zoomBehavior;
  let worldTopo        = null;
  let pathsByIso       = {};
  let centroids        = {};
  let centroidLayer    = null;
  let epicenterLayer   = null;
  let bubbleLayer      = null;
  let govIconLayer     = null;
  let labelLayer       = null;
  let routeLayer       = null;
  let mapInitialized   = false;
  let selectedIso      = null;
  let originIso        = null;
  let epicenterTimer   = null;
  let svgEl            = null;
  let _currentZoom     = d3.zoomIdentity;

  // Countries to show name labels on (major/large ones)
  const LABEL_ISOS = new Set([
    840, 124, 76, 643, 156, 356, 36, 566, 710, 682,
    818, 276, 826, 250, 792, 364, 586, 360, 704, 410,
    32, 484, 604, 392, 724, 380,
  ]);

  const C = {
    ocean:   '#05101f',
    land:    '#0f1a27',
    border:  '#182232',
    healthy: '#111d2c',
    i0: '#3a1a00',
    i1: '#a84800',
    i2: '#d44000',
    i3: '#e01818',
    i4: '#7a0606',
    d0: '#1c0808',
    d1: '#080202',
  };

  // Route colors by method
  const ROUTE_COLORS = {
    'air travel':    { stroke: 'rgba(88,166,255,0.75)',  glow: 'rgba(88,166,255,0.3)'  },
    'sea route':     { stroke: 'rgba(0,204,180,0.75)',   glow: 'rgba(0,204,180,0.3)'   },
    'land border':   { stroke: 'rgba(227,179,65,0.75)',  glow: 'rgba(227,179,65,0.3)'  },
    'spore dispersal':{ stroke: 'rgba(188,140,255,0.75)', glow: 'rgba(188,140,255,0.3)' },
  };

  // ─── LOAD ─────────────────────────────────────
  async function load() {
    const containerEl = document.getElementById('map-container');
    const loader      = document.getElementById('map-loader');
    if (loader) loader.classList.remove('hidden');

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const W = containerEl.clientWidth  || window.innerWidth;
    const H = containerEl.clientHeight || window.innerHeight;

    svg = d3.select('#world-map')
      .attr('width',  W)
      .attr('height', H)
      .style('background', `radial-gradient(ellipse at 50% 55%, #0c1828 0%, ${C.ocean} 65%, #040c16 100%)`)
      .style('border-radius', '0');

    projection = d3.geoNaturalEarth1()
      .scale(W / 6.2)
      .translate([W / 2, H / 2.1]);

    pathGen = d3.geoPath().projection(projection);

    zoomBehavior = d3.zoom()
      .scaleExtent([0.85, 14])
      .on('zoom', ({ transform }) => {
        _currentZoom = transform;
        g.attr('transform', transform);
        // Scale label font inversely with zoom so labels stay readable
        if (labelLayer) {
          const s = Math.max(0.5, Math.min(1.2, 1 / transform.k));
          labelLayer.selectAll('.country-label').attr('font-size', `${9 * s}px`);
        }
        // Scale gov icons similarly
        if (govIconLayer) {
          const s = Math.max(0.6, Math.min(1.3, 1 / transform.k * 1.2));
          govIconLayer.selectAll('.gov-icon-group').attr('transform', d => {
            const c = centroids[d.iso];
            if (!c) return '';
            return `translate(${c[0] + 6},${c[1] - 6}) scale(${s})`;
          });
        }
      });

    svg.call(zoomBehavior);
    svg.on('dblclick.zoom', null);

    addDefs();

    g = svg.append('g');

    // Graticule
    g.append('path')
      .datum(d3.geoGraticule()())
      .attr('class', 'graticule')
      .attr('d', pathGen)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(30,60,90,0.35)')
      .attr('stroke-width', 0.3);

    try {
      worldTopo = await d3.json(
        'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'
      );
      renderWorld(worldTopo);
      mapInitialized = true;
    } catch (err) {
      console.error('World atlas load failed:', err);
      renderOfflineMessage();
      mapInitialized = true;
    } finally {
      if (loader) loader.classList.add('hidden');
    }
  }

  // ─── SVG DEFS ─────────────────────────────────
  function addDefs() {
    const defs = svg.append('defs');

    // Infection glow
    const gf = defs.append('filter')
      .attr('id', 'inf-glow')
      .attr('x', '-60%').attr('y', '-60%')
      .attr('width', '220%').attr('height', '220%');
    gf.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', '4').attr('result', 'blur');
    const gm = gf.append('feMerge');
    gm.append('feMergeNode').attr('in', 'blur');
    gm.append('feMergeNode').attr('in', 'SourceGraphic');

    // Dot glow
    const df = defs.append('filter')
      .attr('id', 'dot-glow')
      .attr('x', '-80%').attr('y', '-80%')
      .attr('width', '260%').attr('height', '260%');
    df.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', '2.5').attr('result', 'b');
    const dm = df.append('feMerge');
    dm.append('feMergeNode').attr('in', 'b');
    dm.append('feMergeNode').attr('in', 'SourceGraphic');

    // Hover glow filter
    const hf = defs.append('filter')
      .attr('id', 'hover-glow')
      .attr('x', '-40%').attr('y', '-40%')
      .attr('width', '180%').attr('height', '180%');
    hf.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', '2').attr('result', 'blur');
    const hm = hf.append('feMerge');
    hm.append('feMergeNode').attr('in', 'blur');
    hm.append('feMergeNode').attr('in', 'SourceGraphic');

    // Drop-shadow for labels
    const sf = defs.append('filter').attr('id', 'label-shadow');
    sf.append('feDropShadow')
      .attr('dx', '0').attr('dy', '0')
      .attr('stdDeviation', '1.5')
      .attr('flood-color', '#000').attr('flood-opacity', '0.9');
  }

  // ─── RENDER WORLD ─────────────────────────────
  function renderWorld(world) {
    const countries = topojson.feature(world, world.objects.countries);

    // Route layer (below countries so routes appear behind)
    routeLayer = g.append('g').attr('class', 'route-layer');

    g.selectAll('.country-path')
      .data(countries.features)
      .join('path')
      .attr('class', 'country-path')
      .attr('id',    d => `cp-${d.id}`)
      .attr('d', pathGen)
      .attr('fill',         C.healthy)
      .attr('stroke',       C.border)
      .attr('stroke-width', 0.5)
      .on('click',      onCountryClick)
      .on('mousemove',  onCountryHover)
      .on('mouseleave', onCountryLeave)
      .on('touchend',   function(event, d) {
        event.preventDefault();
        onCountryClick.call(this, event, d);
      });

    // Border mesh
    g.append('path')
      .datum(topojson.mesh(world, world.objects.countries, (a, b) => a !== b))
      .attr('fill', 'none')
      .attr('stroke', '#252c35')
      .attr('stroke-width', 0.3);

    // Index paths
    countries.features.forEach(f => {
      pathsByIso[f.id] = d3.select(`#cp-${f.id}`);
    });

    // Game vs non-game territories
    const gameIsoSet = new Set(COUNTRIES_DATA.map(c => c.iso));
    countries.features.forEach(f => {
      const iso = parseInt(f.id);
      const el  = pathsByIso[f.id];
      if (!el || el.empty()) return;
      el.classed(gameIsoSet.has(iso) ? 'game-country' : 'non-game-country', true);
    });

    computeCentroids(countries.features);

    // Layers (order matters — bottom to top)
    centroidLayer  = g.append('g').attr('class', 'centroid-layer');
    govIconLayer   = g.append('g').attr('class', 'gov-icon-layer');
    epicenterLayer = g.append('g').attr('class', 'epicenter-layer');
    labelLayer     = g.append('g').attr('class', 'label-layer');
    bubbleLayer    = g.append('g').attr('class', 'bubble-layer');

    // Build initial country name labels
    renderCountryLabels(countries.features);

    svg.on('click', event => {
      if (event.target === svgEl || event.target.classList?.contains('graticule')) {
        UI.hideCountryPanel();
        clearSelection();
        hideRichTooltip();
      }
    });
  }

  // ─── COUNTRY NAME LABELS ──────────────────────
  function renderCountryLabels(features) {
    if (!labelLayer) return;
    const gameIsoSet = new Set(COUNTRIES_DATA.map(c => c.iso));

    features.forEach(f => {
      const iso = parseInt(f.id);
      if (!LABEL_ISOS.has(iso) || !gameIsoSet.has(iso)) return;
      const c = centroids[iso];
      if (!c) return;
      const country = Game.getCountry(iso);
      if (!country) return;

      labelLayer.append('text')
        .attr('class', 'country-label')
        .attr('data-iso', iso)
        .attr('x', c[0])
        .attr('y', c[1])
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '9px')
        .attr('font-family', 'Inter, system-ui, sans-serif')
        .attr('font-weight', '600')
        .attr('fill', 'rgba(255,255,255,0.35)')
        .attr('pointer-events', 'none')
        .attr('letter-spacing', '0.04em')
        .attr('filter', 'url(#label-shadow)')
        .text(country.name.toUpperCase());
    });
  }

  // Update label opacity/color based on infection state
  function updateLabels() {
    if (!labelLayer) return;
    labelLayer.selectAll('.country-label').each(function() {
      const iso = parseInt(d3.select(this).attr('data-iso'));
      const c   = Game.getCountry(iso);
      if (!c) return;
      const infPct = c.infected / c.pop;
      // Labels fade out as country darkens (dead), brighten when infected
      if (c.dead / c.pop > 0.3) {
        d3.select(this).attr('fill', 'rgba(255,255,255,0.08)');
      } else if (infPct > 0.05) {
        d3.select(this).attr('fill', 'rgba(255,255,255,0.55)');
      } else {
        d3.select(this).attr('fill', 'rgba(255,255,255,0.28)');
      }
    });
  }

  function computeCentroids(features) {
    features.forEach(f => {
      const c = pathGen.centroid(f);
      if (!isNaN(c[0]) && !isNaN(c[1])) {
        centroids[parseInt(f.id)] = c;
      }
    });
  }

  function renderOfflineMessage() {
    svg.append('text').attr('x','50%').attr('y','44%').attr('text-anchor','middle')
      .attr('fill','#f85149').attr('font-size','15px')
      .attr('font-family','Inter, system-ui, sans-serif').attr('font-weight','700')
      .text('MAP DATA UNAVAILABLE');
    svg.append('text').attr('x','50%').attr('y','51%').attr('text-anchor','middle')
      .attr('fill','#8b949e').attr('font-size','11px')
      .attr('font-family','Inter, system-ui, sans-serif')
      .text('Requires internet — open index.html in Chrome or Firefox');
  }

  // ─── RICH HOVER TOOLTIP ───────────────────────
  let _tooltipTimeout = null;
  let _hoveredIso     = null;

  function showRichTooltip(event, country, gs) {
    const tt = document.getElementById('map-rich-tooltip');
    if (!tt) return;

    _hoveredIso = country.iso;

    const infPct  = (country.infected / country.pop * 100);
    const deadPct = (country.dead / country.pop * 100);
    const hlthPct = Math.max(0, 100 - infPct - deadPct);

    // Status
    let statusText, statusClass;
    if (deadPct > 50)       { statusText = '💀 DEVASTATED'; statusClass = 'rtt-devastated'; }
    else if (infPct > 30 || deadPct > 10) { statusText = '🔴 CRITICAL';    statusClass = 'rtt-critical'; }
    else if (infPct > 5)    { statusText = '🟠 SPREADING';  statusClass = 'rtt-spreading'; }
    else if (infPct > 0)    { statusText = '🟡 EMERGING';   statusClass = 'rtt-emerging'; }
    else if (country.reached){ statusText = '🟡 EMERGING';   statusClass = 'rtt-emerging'; }
    else                    { statusText = '🟢 UNINFECTED'; statusClass = 'rtt-clear'; }

    // Government response line
    const govParts = [];
    if (country.lockdown)      govParts.push('<span class="rtt-gov-badge rtt-lockdown">🔒 LOCKDOWN</span>');
    if (country.airportClosed) govParts.push('<span class="rtt-gov-badge rtt-closed">✈ AIRPORTS CLOSED</span>');
    if (!govParts.length)      govParts.push('<span class="rtt-gov-badge rtt-open">✓ OPEN</span>');

    // Climate/wealth icons
    const climateIcon = { temperate: '🌤', tropical: '🌴', arid: '☀️', cold: '❄️' }[country.climate] || '🌍';
    const wealthIcon  = { rich: '💰', middle: '🏙', poor: '🏚' }[country.wealth] || '';

    tt.innerHTML = `
      <div class="rtt-header">
        <span class="rtt-name">${country.name}</span>
        <span class="rtt-status ${statusClass}">${statusText}</span>
      </div>
      <div class="rtt-pop-bar">
        <div class="rtt-bar-inf"  style="width:${Math.min(100,infPct).toFixed(1)}%"></div>
        <div class="rtt-bar-dead" style="width:${Math.min(100,deadPct).toFixed(1)}%"></div>
        <div class="rtt-bar-hlth" style="width:${Math.min(100,hlthPct).toFixed(1)}%"></div>
      </div>
      <div class="rtt-stats">
        <div class="rtt-row"><span class="rtt-lbl">Population</span><span class="rtt-val">${UI.fmt(country.pop)}</span></div>
        ${country.reached ? `
        <div class="rtt-row"><span class="rtt-lbl">Infected</span><span class="rtt-val rtt-inf">${UI.fmt(country.infected)} <span class="rtt-pct">(${infPct.toFixed(1)}%)</span></span></div>
        <div class="rtt-row"><span class="rtt-lbl">Dead</span><span class="rtt-val rtt-dead">${UI.fmt(country.dead)} <span class="rtt-pct">(${deadPct.toFixed(2)}%)</span></span></div>
        ` : `<div class="rtt-row"><span class="rtt-lbl">Status</span><span class="rtt-val" style="color:var(--green)">Not yet reached</span></div>`}
        <div class="rtt-divider"></div>
        <div class="rtt-row"><span class="rtt-lbl">${climateIcon} Climate</span><span class="rtt-val rtt-cap">${country.climate}</span></div>
        <div class="rtt-row"><span class="rtt-lbl">${wealthIcon} Wealth</span><span class="rtt-val rtt-cap">${country.wealth}</span></div>
        <div class="rtt-row"><span class="rtt-lbl">🏥 Healthcare</span><span class="rtt-val">${Math.round(country.healthcare * 100)}%</span></div>
        <div class="rtt-row"><span class="rtt-lbl">Gov. Response</span><span class="rtt-gov">${govParts.join('')}</span></div>
      </div>
      <div class="rtt-hint">Click to inspect</div>
    `;

    // Position
    _positionTooltip(tt, event);
    tt.classList.remove('hidden');
    tt.classList.add('rtt-visible');
  }

  function _positionTooltip(tt, event) {
    const margin = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = event.clientX + margin;
    let y = event.clientY - 10;

    // Flip left if near right edge
    tt.style.visibility = 'hidden';
    tt.classList.remove('hidden');
    const w = tt.offsetWidth  || 220;
    const h = tt.offsetHeight || 180;
    tt.classList.add('hidden');
    tt.style.visibility = '';

    if (x + w > vw - margin) x = event.clientX - w - margin;
    if (y + h > vh - margin) y = vh - h - margin;
    if (y < margin) y = margin;

    tt.style.left = x + 'px';
    tt.style.top  = y + 'px';
  }

  function updateTooltipPosition(event) {
    const tt = document.getElementById('map-rich-tooltip');
    if (tt && !tt.classList.contains('hidden')) {
      _positionTooltip(tt, event);
    }
  }

  function hideRichTooltip() {
    const tt = document.getElementById('map-rich-tooltip');
    if (tt) { tt.classList.add('hidden'); tt.classList.remove('rtt-visible'); }
    _hoveredIso = null;
  }

  // ─── CLICK HANDLER ────────────────────────────
  function onCountryClick(event, d) {
    event.stopPropagation();
    const iso     = parseInt(d.id, 10);
    const country = Game.getCountry(iso);
    const gs      = Game.getState();

    if (gs.phase === 'idle') {
      if (!country) { _showNonGameTooltip(event); return; }
      if (typeof window.onMapCountryPick === 'function') window.onMapCountryPick(iso, country);
      return;
    }

    if (!country) return;

    clearSelection();
    selectedIso = iso;
    d3.select(event.currentTarget)
      .classed('selected', true)
      .attr('stroke', '#58a6ff')
      .attr('stroke-width', 1.5);

    UI.showCountryPanel(country);

    // Gentle zoom toward clicked country (if not zoomed already)
    if (_currentZoom.k < 2.5) {
      zoomToCountry(iso, 2.5);
    }

    if (typeof AudioEngine !== 'undefined') AudioEngine.sfxCountryClick();
  }

  // ─── HOVER HANDLER ────────────────────────────
  function onCountryHover(event, d) {
    const iso     = parseInt(d.id, 10);
    const country = Game.getCountry(iso);
    const gs      = Game.getState();

    // Highlight every country on hover (not just pick mode)
    if (selectedIso !== iso) {
      d3.select(event.currentTarget)
        .attr('stroke', 'rgba(255,255,255,0.45)')
        .attr('stroke-width', 1.0);
    }

    if (gs.phase === 'idle') {
      d3.select(event.currentTarget).classed('pick-hover', true);
      if (!country) {
        _showNonGameTooltip(event);
        return;
      }
    }

    if (!country) return;

    // Rich tooltip during gameplay
    if (gs.phase === 'spreading' || gs.phase === 'won' || gs.phase === 'lost') {
      showRichTooltip(event, country, gs);
    } else if (gs.phase === 'idle') {
      // Simple tooltip in pick mode
      const tt     = document.getElementById('map-tooltip');
      const ttName = document.getElementById('tt-name');
      const ttStat = document.getElementById('tt-status');
      if (tt && ttName && ttStat) {
        ttName.textContent = country.name;
        ttStat.textContent = `${UI.fmt(country.pop)} pop · ${country.climate} · ${country.wealth}`;
        tt.classList.remove('hidden');
        tt.style.left = (event.pageX + 14) + 'px';
        tt.style.top  = (event.pageY - 28) + 'px';
      }
    }
  }

  function onCountryLeave(event, d) {
    const iso = parseInt(d?.id ?? 0, 10);

    // Restore stroke unless selected
    if (selectedIso !== iso) {
      d3.select(event.currentTarget)
        .attr('stroke', C.border)
        .attr('stroke-width', 0.5);
    }

    d3.select(event.currentTarget).classed('pick-hover', false);

    // Hide simple tooltip
    const tt = document.getElementById('map-tooltip');
    if (tt) tt.classList.add('hidden');

    // Delay hiding rich tooltip so it doesn't flicker when re-entering
    _tooltipTimeout = setTimeout(hideRichTooltip, 120);
  }

  // Re-enter from tooltip div should cancel the hide
  document.addEventListener('DOMContentLoaded', () => {
    const rtt = document.getElementById('map-rich-tooltip');
    if (rtt) {
      rtt.addEventListener('mouseenter', () => {
        if (_tooltipTimeout) { clearTimeout(_tooltipTimeout); _tooltipTimeout = null; }
      });
      rtt.addEventListener('mouseleave', hideRichTooltip);
    }
    svgEl = document.getElementById('world-map');
  });

  function _showNonGameTooltip(event) {
    const tt = document.getElementById('map-tooltip');
    const ttName = document.getElementById('tt-name');
    const ttStat = document.getElementById('tt-status');
    if (!tt) return;
    ttName.textContent = 'Minor Territory';
    ttStat.textContent = 'Not tracked in simulation';
    tt.classList.remove('hidden');
    tt.style.left = (event.pageX + 14) + 'px';
    tt.style.top  = (event.pageY - 28) + 'px';
    setTimeout(() => tt.classList.add('hidden'), 1800);
  }

  function clearSelection() {
    if (selectedIso !== null) {
      const prev = pathsByIso[selectedIso];
      if (prev && !prev.empty()) {
        prev.classed('selected', false)
          .attr('stroke', C.border)
          .attr('stroke-width', 0.5);
      }
    }
    selectedIso = null;
  }

  // ─── UPDATE COLORS ────────────────────────────
  const _prevColors  = {};
  const _prevFilters = {};
  let _colorUpdateCount = 0;

  function updateColors(dirtyIsos) {
    if (!mapInitialized) return;
    _colorUpdateCount++;

    const countries = dirtyIsos && dirtyIsos.size > 0
      ? [...dirtyIsos].map(iso => Game.getCountry(iso)).filter(Boolean)
      : Game.getAllCountries();

    for (const c of countries) {
      const el = pathsByIso[c.iso];
      if (!el || el.empty()) continue;

      const color   = colorFor(c);
      const deadPct = c.dead / c.pop;
      const infPct  = (c.infected + c.dead) / c.pop;
      const filter  = (deadPct > 0.12 || infPct > 0.35) ? 'url(#inf-glow)' : null;

      if (_prevColors[c.iso] !== color)   { el.attr('fill', color);   _prevColors[c.iso]  = color; }
      if (_prevFilters[c.iso] !== filter) { el.attr('filter', filter); _prevFilters[c.iso] = filter; }
    }

    if (_colorUpdateCount % 3 === 0) updateInfectionDots();
    if (_colorUpdateCount % 4 === 0) updateBubbles();
    if (_colorUpdateCount % 6 === 0) updateGovIcons();
    if (_colorUpdateCount % 9 === 0) updateLabels();

    // Refresh rich tooltip if open
    if (_hoveredIso !== null) {
      const country = Game.getCountry(_hoveredIso);
      const gs      = Game.getState();
      if (country && (gs.phase === 'spreading')) {
        const lastEvent = { clientX: _lastMouseX, clientY: _lastMouseY };
        showRichTooltip(lastEvent, country, gs);
      }
    }
  }

  let _lastMouseX = 0, _lastMouseY = 0;
  document.addEventListener('mousemove', e => { _lastMouseX = e.clientX; _lastMouseY = e.clientY; });

  // ─── GOVERNMENT RESPONSE ICONS ────────────────
  function updateGovIcons() {
    if (!govIconLayer) return;
    const gs = Game.getState();
    if (gs.phase !== 'spreading') return;

    const active = Game.getAllCountries().filter(
      c => c.reached && (c.lockdown || c.airportClosed)
    );

    const sel = govIconLayer.selectAll('.gov-icon-group').data(active, d => d.iso);

    const enter = sel.enter()
      .append('g')
      .attr('class', 'gov-icon-group')
      .style('opacity', 0)
      .attr('pointer-events', 'none');

    // Background circle
    enter.append('circle')
      .attr('r', 5)
      .attr('fill', d => d.lockdown ? 'rgba(248,81,73,0.85)' : 'rgba(88,166,255,0.75)')
      .attr('stroke', 'rgba(0,0,0,0.4)')
      .attr('stroke-width', 0.5);

    // Icon text
    enter.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', '5px')
      .attr('pointer-events', 'none')
      .text(d => d.lockdown ? '🔒' : '✈');

    enter.transition().duration(400).style('opacity', 1);

    // Position all (enter + update)
    govIconLayer.selectAll('.gov-icon-group')
      .attr('transform', d => {
        const c = centroids[d.iso];
        if (!c) return 'translate(0,0)';
        const s = Math.max(0.6, Math.min(1.3, 1 / _currentZoom.k * 1.2));
        return `translate(${c[0] + 6},${c[1] - 6}) scale(${s})`;
      });

    sel.exit().transition().duration(300).style('opacity', 0).remove();
  }

  // ─── INFECTION DOTS ───────────────────────────
  function updateInfectionDots() {
    if (!centroidLayer) return;

    const infected = Game.getAllCountries().filter(
      c => c.reached && (c.infected + c.dead) > 0
    );

    const dots = centroidLayer.selectAll('.inf-dot').data(infected, d => d.iso);

    dots.enter()
      .append('circle')
      .attr('class', 'inf-dot')
      .attr('pointer-events', 'none')
      .attr('r', 0)
      .merge(dots)
      .attr('cx', d => centroids[d.iso]?.[0] ?? 0)
      .attr('cy', d => centroids[d.iso]?.[1] ?? 0)
      .attr('r',  d => {
        const pct = (d.infected + d.dead) / d.pop;
        return Math.max(1.5, Math.sqrt(Math.min(pct, 0.6)) * 10);
      })
      .attr('fill', d => {
        const dead = d.dead / d.pop;
        if (dead > 0.5) return 'rgba(50,0,0,0.85)';
        if (dead > 0.2) return 'rgba(110,0,0,0.7)';
        const inf = d.infected / d.pop;
        if (inf > 0.35) return 'rgba(200,35,35,0.65)';
        if (inf > 0.1)  return 'rgba(248,81,73,0.5)';
        return 'rgba(248,81,73,0.3)';
      })
      .attr('filter', d => {
        const pct = (d.infected + d.dead) / d.pop;
        return pct > 0.15 ? 'url(#dot-glow)' : null;
      });

    dots.exit().transition().duration(600).attr('r', 0).remove();
  }

  // ─── DNA BUBBLES ──────────────────────────────
  function updateBubbles() {
    if (!bubbleLayer) return;
    const gs = Game.getState();
    if (gs.phase !== 'spreading') return;

    const bubbles = Game.getBubbles();
    const sel = bubbleLayer.selectAll('.dna-bubble').data(bubbles, d => d.id);

    const enter = sel.enter()
      .append('g')
      .attr('class', 'dna-bubble')
      .attr('cursor', 'pointer')
      .style('opacity', 0)
      .attr('transform', d => bubbleTransform(d))
      .on('click', function(event, d) {
        event.stopPropagation();
        const val = Game.collectBubble(d.id);
        if (!val) return;
        if (typeof AudioEngine !== 'undefined') AudioEngine.sfxDNA();

        const c = centroids[d.iso];
        if (c && epicenterLayer) {
          epicenterLayer.append('text')
            .attr('x', c[0] + d.dx)
            .attr('y', c[1] + d.dy - 8)
            .attr('text-anchor', 'middle')
            .attr('fill', '#3fb950')
            .attr('font-size', '10px')
            .attr('font-weight', '700')
            .attr('font-family', 'Inter, system-ui, sans-serif')
            .attr('pointer-events', 'none')
            .attr('filter', 'url(#label-shadow)')
            .text(`+${val} DNA`)
            .transition().duration(1100).ease(d3.easeCubicOut)
            .attr('y', c[1] + d.dy - 30)
            .style('opacity', 0)
            .remove();
        }
      });

    enter.append('circle')
      .attr('class', 'bubble-bg')
      .attr('r', 9)
      .attr('fill', 'rgba(63,185,80,0.18)')
      .attr('stroke', '#3fb950')
      .attr('stroke-width', 1.4)
      .attr('pointer-events', 'all');

    enter.append('circle')
      .attr('class', 'bubble-pulse')
      .attr('r', 9)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(63,185,80,0.55)')
      .attr('stroke-width', 1)
      .attr('pointer-events', 'none');

    enter.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', '9px')
      .attr('pointer-events', 'none')
      .text('⚡');

    enter.append('text')
      .attr('class', 'bubble-val')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('y', 12)
      .attr('font-size', '7px')
      .attr('font-weight', '700')
      .attr('fill', '#3fb950')
      .attr('pointer-events', 'none')
      .text(d => `+${d.value}`);

    enter.transition().duration(350).ease(d3.easeCubicOut).style('opacity', 1);
    sel.attr('transform', d => bubbleTransform(d));

    enter.on('mouseover', function() {
      d3.select(this).select('.bubble-bg')
        .attr('fill', 'rgba(63,185,80,0.4)')
        .attr('stroke', '#79c0ff')
        .attr('r', 11);
    }).on('mouseout', function() {
      d3.select(this).select('.bubble-bg')
        .attr('fill', 'rgba(63,185,80,0.18)')
        .attr('stroke', '#3fb950')
        .attr('r', 9);
    });

    sel.exit().transition().duration(400).style('opacity', 0).remove();
  }

  function bubbleTransform(d) {
    const c = centroids[d.iso];
    if (!c) return 'translate(0,0)';
    return `translate(${c[0] + d.dx}, ${c[1] + d.dy})`;
  }

  // ─── EPICENTER ────────────────────────────────
  function setOrigin(iso) {
    originIso = iso;
    if (!epicenterLayer || !centroids[iso]) return;
    epicenterLayer.selectAll('*').remove();
    if (epicenterTimer) clearInterval(epicenterTimer);

    const [cx, cy] = centroids[iso];

    [4, 8, 13].forEach((r, i) => {
      epicenterLayer.append('circle')
        .attr('cx', cx).attr('cy', cy).attr('r', r)
        .attr('fill', 'none')
        .attr('stroke', '#f85149')
        .attr('stroke-width', 0.9 - i * 0.2)
        .attr('opacity', 0.65 - i * 0.15)
        .attr('pointer-events', 'none');
    });

    epicenterLayer.append('circle')
      .attr('cx', cx).attr('cy', cy).attr('r', 2)
      .attr('fill', '#f85149').attr('opacity', 1)
      .attr('pointer-events', 'none');

    // "ORIGIN" label
    epicenterLayer.append('text')
      .attr('x', cx).attr('y', cy - 17)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(248,81,73,0.7)')
      .attr('font-size', '6px')
      .attr('font-weight', '700')
      .attr('font-family', 'Inter, system-ui, sans-serif')
      .attr('letter-spacing', '0.12em')
      .attr('pointer-events', 'none')
      .attr('filter', 'url(#label-shadow)')
      .text('ORIGIN');

    function spawnPulse() {
      if (!epicenterLayer) return;
      epicenterLayer.append('circle')
        .attr('cx', cx).attr('cy', cy).attr('r', 2)
        .attr('fill', 'none')
        .attr('stroke', '#f85149').attr('stroke-width', 1.4)
        .attr('opacity', 0.9)
        .attr('pointer-events', 'none')
        .transition().duration(2000).ease(d3.easeCubicOut)
        .attr('r', 16).attr('opacity', 0)
        .remove();
    }
    spawnPulse();
    epicenterTimer = setInterval(spawnPulse, 2400);
  }

  // ─── COLOR MAPPING ────────────────────────────
  function colorFor(c) {
    if (!c.reached) return C.healthy;
    const deadPct = c.dead / c.pop;
    const infPct  = (c.infected + c.dead) / c.pop;
    if (deadPct > 0.70) return C.d1;
    if (deadPct > 0.30) return C.d0;
    if (infPct  < 0.001) return C.i0;
    if (infPct  < 0.05)  return C.i1;
    if (infPct  < 0.20)  return C.i2;
    if (infPct  < 0.50)  return C.i3;
    return C.i4;
  }

  // ─── PULSE (new country infected) ─────────────
  function pulseCountry(iso) {
    const el = pathsByIso[iso];
    if (!el || el.empty()) return;

    // Flash white → target color with 2-stage animation
    el.attr('fill', '#ffffff')
      .transition().duration(150)
      .attr('fill', '#ff8866')
      .transition().duration(800).ease(d3.easeCubicOut)
      .attr('fill', colorFor(Game.getCountry(iso) || {}));

    // Ripple rings from centroid
    const c = centroids[iso];
    if (c && epicenterLayer) {
      [0, 200, 400].forEach(delay => {
        setTimeout(() => {
          if (!epicenterLayer) return;
          epicenterLayer.append('circle')
            .attr('cx', c[0]).attr('cy', c[1]).attr('r', 3)
            .attr('fill', 'none')
            .attr('stroke', '#f85149').attr('stroke-width', 1.5)
            .attr('opacity', 0.9)
            .attr('pointer-events', 'none')
            .transition().duration(1400).ease(d3.easeCubicOut)
            .attr('r', 20).attr('opacity', 0)
            .remove();
        }, delay);
      });
    }
  }

  // ─── HIGHLIGHT (pick mode) ────────────────────
  function highlightCountry(iso) {
    const el = pathsByIso[iso];
    if (!el || el.empty()) return;
    el.attr('fill', '#58a6ff')
      .transition().duration(600)
      .attr('fill', C.i0);
  }

  // ─── ZOOM TO COUNTRY ──────────────────────────
  function zoomToCountry(iso, targetScale) {
    if (!mapInitialized || !worldTopo) return;
    const scale = targetScale || 3;
    const features = topojson.feature(worldTopo, worldTopo.objects.countries).features;
    const feature  = features.find(f => parseInt(f.id) === parseInt(iso));
    if (!feature) return;

    const containerEl = document.getElementById('map-container');
    const W = containerEl.clientWidth;
    const H = containerEl.clientHeight;
    const [[x0,y0],[x1,y1]] = pathGen.bounds(feature);
    const s = Math.min(scale, 0.8 / Math.max((x1-x0)/W, (y1-y0)/H));
    const tx = W/2 - s*(x0+x1)/2;
    const ty = H/2 - s*(y0+y1)/2;

    svg.transition().duration(750).ease(d3.easeCubicInOut)
      .call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(s));
  }

  function resetZoom() {
    svg.transition().duration(700)
      .call(zoomBehavior.transform, d3.zoomIdentity);
  }

  // ─── TRAVEL ROUTE FLASH ────────────────────────
  function showTravelRoute(srcIso, dstIso, method) {
    if (!routeLayer || !centroids[srcIso] || !centroids[dstIso]) return;
    const [x1, y1] = centroids[srcIso];
    const [x2, y2] = centroids[dstIso];
    const dist  = Math.sqrt((x2-x1)**2 + (y2-y1)**2);
    const curve = Math.min(dist * 0.45, 100);
    const mx    = (x1+x2)/2;
    const my    = (y1+y2)/2 - curve;
    const pathD = `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;

    const col = ROUTE_COLORS[method] || ROUTE_COLORS['land border'];

    // Arc line
    const line = routeLayer.append('path')
      .attr('d', pathD)
      .attr('fill', 'none')
      .attr('stroke', col.stroke)
      .attr('stroke-width', 1.4)
      .attr('stroke-dasharray', '6 4')
      .attr('pointer-events', 'none')
      .attr('opacity', 1);

    line.transition().delay(300).duration(2500).ease(d3.easeCubicOut)
      .attr('opacity', 0).remove();

    // Traveling dot
    const dot = routeLayer.append('circle')
      .attr('r', 3).attr('fill', col.stroke.replace('0.75', '1')).attr('opacity', 1)
      .attr('pointer-events', 'none');

    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tmp.setAttribute('d', pathD);
    const totalLen = tmp.getTotalLength();

    let startTime = null;
    const duration = 1100;
    function animateDot(ts) {
      if (!startTime) startTime = ts;
      const t = Math.min((ts - startTime) / duration, 1);
      const pos = tmp.getPointAtLength(t * totalLen);
      dot.attr('cx', pos.x).attr('cy', pos.y);
      if (t < 1) {
        requestAnimationFrame(animateDot);
      } else {
        dot.transition().duration(500).attr('r', 8).attr('opacity', 0).remove();
        // Burst rings at destination
        [0, 180, 360].forEach(delay => {
          setTimeout(() => {
            if (!routeLayer) return;
            routeLayer.append('circle')
              .attr('cx', x2).attr('cy', y2).attr('r', 2)
              .attr('fill', 'none').attr('stroke', col.stroke)
              .attr('stroke-width', 1.5).attr('opacity', 0.9)
              .attr('pointer-events', 'none')
              .transition().duration(800).attr('r', 14).attr('opacity', 0).remove();
          }, delay);
        });
      }
    }
    requestAnimationFrame(animateDot);
  }

  // ─── RESIZE ───────────────────────────────────
  function resize() {
    if (!svg) return;
    const containerEl = document.getElementById('map-container');
    const W = containerEl.clientWidth;
    const H = containerEl.clientHeight;

    svg.attr('width', W).attr('height', H);
    projection.scale(W / 6.2).translate([W / 2, H / 2.1]);
    pathGen = d3.geoPath().projection(projection);

    g.selectAll('.country-path').attr('d', pathGen);
    g.select('.graticule').attr('d', pathGen);

    if (worldTopo) {
      computeCentroids(topojson.feature(worldTopo, worldTopo.objects.countries).features);
      if (centroidLayer) {
        centroidLayer.selectAll('.inf-dot')
          .attr('cx', d => centroids[d.iso]?.[0] ?? 0)
          .attr('cy', d => centroids[d.iso]?.[1] ?? 0);
      }
      if (labelLayer) {
        labelLayer.selectAll('.country-label')
          .attr('x', function() {
            const iso = parseInt(d3.select(this).attr('data-iso'));
            return centroids[iso]?.[0] ?? 0;
          })
          .attr('y', function() {
            const iso = parseInt(d3.select(this).attr('data-iso'));
            return centroids[iso]?.[1] ?? 0;
          });
      }
      if (originIso) setOrigin(originIso);
      updateBubbles();
      updateGovIcons();
    }
  }

  function setupOceanClick() { /* handled inside renderWorld */ }

  // ─── PICK MODE ────────────────────────────────
  function setPick(on) {
    svgEl = svgEl || document.getElementById('world-map');
    if (svgEl) svgEl.classList.toggle('pick-mode', on);
  }

  window.addEventListener('resize', () => {
    clearTimeout(window._mapResizeTimer);
    window._mapResizeTimer = setTimeout(resize, 150);
  });

  return {
    load, updateColors, pulseCountry, highlightCountry,
    zoomToCountry, resetZoom, resize, setupOceanClick,
    setOrigin, colorFor, isReady: () => mapInitialized,
    setPick, showTravelRoute,
  };
})();

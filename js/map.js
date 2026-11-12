/* ═══════════════════════════════════════════════
   PATHOGEN v3 - World Map (D3 + TopoJSON)
   ═══════════════════════════════════════════════ */

const WorldMap = (() => {
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
    818, 276, 826, 250, 792, 364, 586, 360,
    32, 484, 604, 392, 724,
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

  const GOV_ICON_MIN_ZOOM = 1.8; // below this the icons just bury the map

  // Phones: blur filters are the most expensive thing on the map, and
  // hover tooltips make no sense without a pointer that can hover.
  const coarse   = window.matchMedia('(pointer: coarse)').matches;
  const LOW_FX   = coarse || window.innerWidth < 600;
  const NO_HOVER = window.matchMedia('(hover: none)').matches;
  const isSheetLayout = () => window.innerWidth <= 540; // country panel is a bottom sheet

  // Labels that stay visible even when the whole world is on screen
  const MAJOR_LABELS = new Set([840, 124, 76, 643, 156, 356, 36]);
  let labelBase = 9;   // px at zoom 1, shrinks with the map on small screens
  let baseScale = 129; // projection scale for the current viewport

  // Route colors by method
  const ROUTE_COLORS = {
    'air travel':    { stroke: 'rgba(88,166,255,0.75)',  glow: 'rgba(88,166,255,0.3)'  },
    'sea route':     { stroke: 'rgba(0,204,180,0.75)',   glow: 'rgba(0,204,180,0.3)'   },
    'land border':   { stroke: 'rgba(227,179,65,0.75)',  glow: 'rgba(227,179,65,0.3)'  },
    'spore dispersal':{ stroke: 'rgba(188,140,255,0.75)', glow: 'rgba(188,140,255,0.3)' },
    'smugglers':     { stroke: 'rgba(63,185,80,0.75)',   glow: 'rgba(63,185,80,0.3)'   },
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

    projection = d3.geoNaturalEarth1();
    fitProjection(W, H);
    pathGen = d3.geoPath().projection(projection);

    zoomBehavior = d3.zoom()
      .on('zoom', ({ transform }) => {
        _currentZoom = transform;
        g.attr('transform', transform);
        applyLabelZoom(transform.k);
        scheduleDots();
        if (bubbleLayer) bubbleLayer.selectAll('.dna-bubble').attr('transform', bubbleTransform);
        // Government icons only make sense once you can tell countries apart
        if (govIconLayer) {
          govIconLayer.style('display', transform.k < GOV_ICON_MIN_ZOOM ? 'none' : null);
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
    fitZoom(W, H);
    sizeDotCanvas(W, H);

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
        'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json'
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

  // ─── FIT TO VIEWPORT ──────────────────────────
  // A world map is twice as wide as it is tall. On a portrait phone,
  // fitting the width leaves a thin strip, so instead fill more of the
  // height and let the player pan sideways. Pinching out still shows it all.
  function fitProjection(W, H) {
    const fitWidth = W / 6.2;
    baseScale = Math.max(fitWidth, Math.min(H * 0.30, W / 2.7));
    projection.scale(baseScale).translate([W / 2, H / 2.1]);
    if (baseScale > fitWidth) {
      // Start centred on Africa/Eurasia, where most countries are
      const x = projection([35, 0])[0];
      projection.translate([W / 2 - (x - W / 2), H / 2.1]);
    }
    labelBase = Math.max(5.5, Math.min(9, 9 * baseScale / 129));
  }

  function fitZoom(W, H) {
    const minK = Math.min(0.85, (W / 6.2) / baseScale * 0.95);
    const [[x0, y0], [x1, y1]] = d3.geoPath(projection).bounds({ type: 'Sphere' });
    const pad = 60;
    zoomBehavior
      .scaleExtent([minK, 14])
      .translateExtent([[x0 - pad, y0 - pad], [x1 + pad, y1 + pad]]);
  }

  // Keep labels a readable size at any zoom, and drop the minor ones
  // when the map is too small for them to fit without colliding.
  function applyLabelZoom(k) {
    if (!labelLayer) return;
    const s = Math.max(0.5, Math.min(1.2, 1 / k));
    const showMinor = baseScale * k >= 150;
    labelLayer.selectAll('.country-label')
      .attr('font-size', `${labelBase * s}px`)
      .style('display', function () {
        return showMinor || MAJOR_LABELS.has(+this.getAttribute('data-iso')) ? null : 'none';
      });
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
      .on('mouseleave', onCountryLeave);

    // Border mesh
    g.append('path')
      .datum(topojson.mesh(world, world.objects.countries, (a, b) => a !== b))
      .attr('class', 'border-mesh')
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
    buildPoints(countries.features);

    // Layers (order matters — bottom to top)
    centroidLayer  = g.append('g').attr('class', 'centroid-layer');
    govIconLayer   = g.append('g').attr('class', 'gov-icon-layer')
      .style('display', _currentZoom.k < GOV_ICON_MIN_ZOOM ? 'none' : null);
    epicenterLayer = g.append('g').attr('class', 'epicenter-layer');
    labelLayer     = g.append('g').attr('class', 'label-layer');
    bubbleLayer    = g.append('g').attr('class', 'bubble-layer');

    // Build initial country name labels
    renderCountryLabels(countries.features);
    applyLabelZoom(_currentZoom.k);

    // Taps on open water: forgive a near miss, otherwise deselect
    svg.on('click', event => {
      if (event.target === svgEl || event.target.classList?.contains('graticule')) {
        const near = nearestCountry(event);
        if (near) { selectCountry(near.iso, near); return; }
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
        .attr('font-size', `${labelBase}px`)
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
      .text('The world atlas could not be downloaded. Check your connection and reload.');
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
    if (deadPct > 50)       { statusText = 'DEVASTATED'; statusClass = 'rtt-devastated'; }
    else if (infPct > 30 || deadPct > 10) { statusText = 'CRITICAL';    statusClass = 'rtt-critical'; }
    else if (infPct > 5)    { statusText = 'SPREADING';  statusClass = 'rtt-spreading'; }
    else if (infPct > 0)    { statusText = 'EMERGING';   statusClass = 'rtt-emerging'; }
    else if (country.reached){ statusText = 'EMERGING';   statusClass = 'rtt-emerging'; }
    else                    { statusText = 'UNINFECTED'; statusClass = 'rtt-clear'; }

    // Government response line
    const gov      = UI.govSummary(country);
    const govClass = gov === 'Open' ? 'rtt-open' : (country.lockdown || country.collapsed) ? 'rtt-lockdown' : 'rtt-closed';
    const govParts = [`<span class="rtt-gov-badge ${govClass}">${gov.toUpperCase()}</span>`];
    const trend    = UI.trendFor(country);

    // Climate/wealth icons

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
        <div class="rtt-row"><span class="rtt-lbl">Outbreak</span><span class="rtt-val" style="color:${trend.color}">${trend.text}</span></div>
        ` : `<div class="rtt-row"><span class="rtt-lbl">Status</span><span class="rtt-val" style="color:var(--green)">Not yet reached</span></div>`}
        <div class="rtt-divider"></div>
        <div class="rtt-row"><span class="rtt-lbl">Climate</span><span class="rtt-val rtt-cap">${country.climate}</span></div>
        <div class="rtt-row"><span class="rtt-lbl">Wealth</span><span class="rtt-val rtt-cap">${country.wealth}</span></div>
        <div class="rtt-row"><span class="rtt-lbl">Healthcare</span><span class="rtt-val">${Math.round(country.healthcare * 100)}%</span></div>
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
    const iso = parseInt(d.id, 10);
    // Small countries are a few pixels wide on a phone. If the tap landed
    // on untracked land, or right beside a tracked country, take the
    // nearest tracked one instead.
    const country = Game.getCountry(iso) || nearestCountry(event);
    if (!country) {
      if (Game.getState().phase === 'idle') _showNonGameTooltip(event);
      return;
    }
    selectCountry(country.iso, country);
  }

  // Closest tracked country to a tap, within a thumb's width.
  function nearestCountry(event) {
    const [px, py] = d3.pointer(event, g.node());
    const reach = (coarse ? 26 : 14) / _currentZoom.k;
    let best = null, bestD = reach * reach;
    for (const c of Game.getAllCountries()) {
      const p = centroids[c.iso];
      if (!p) continue;
      const dd = (p[0] - px) ** 2 + (p[1] - py) ** 2;
      if (dd < bestD) { bestD = dd; best = c; }
    }
    return best;
  }

  function selectCountry(iso, country) {
    if (Game.getState().phase === 'idle') {
      if (typeof window.onMapCountryPick === 'function') window.onMapCountryPick(iso, country);
      return;
    }

    clearSelection();
    selectedIso = iso;
    const el = pathsByIso[iso];
    if (el && !el.empty()) {
      el.classed('selected', true).attr('stroke', '#58a6ff').attr('stroke-width', 1.5);
    }

    UI.showCountryPanel(country);

    if (isSheetLayout()) {
      // Keep the country in the strip of map still visible above the sheet
      zoomToCountry(iso, Math.max(2.5, _currentZoom.k), 0.36);
    } else if (_currentZoom.k < 2.5) {
      zoomToCountry(iso, 2.5);
    }
  }

  // ─── HOVER HANDLER ────────────────────────────
  function onCountryHover(event, d) {
    if (NO_HOVER) return; // touch screens fire a fake mousemove on tap
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
      if (localStorage.getItem('set_show_tooltips') !== '0') showRichTooltip(event, country, gs);
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
      const filter  = null; // the point layer carries the glow now

      if (_prevColors[c.iso] !== color)   { el.attr('fill', color);   _prevColors[c.iso]  = color; }
      if (_prevFilters[c.iso] !== filter) { el.attr('filter', filter); _prevFilters[c.iso] = filter; }
    }

    scheduleDots();
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
      c => c.collapsed || c.lockdown || c.airportClosed || c.portClosed
    );

    const sel = govIconLayer.selectAll('.gov-icon-group').data(active, d => d.iso);

    const enter = sel.enter()
      .append('g')
      .attr('class', 'gov-icon-group')
      .style('opacity', 0)
      .attr('pointer-events', 'none');

    enter.append('circle')
      .attr('r', 5)
      .attr('stroke', 'rgba(0,0,0,0.4)')
      .attr('stroke-width', 0.5);
    enter.append('use')
      .attr('x', -3.2).attr('y', -3.2).attr('width', 6.4).attr('height', 6.4)
      .attr('fill', 'none').attr('stroke', '#fff').attr('stroke-width', 2.2)
      .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round')
      .attr('pointer-events', 'none');

    enter.transition().duration(400).style('opacity', 1);

    // A country's status escalates over time, so restyle existing icons too
    const all = govIconLayer.selectAll('.gov-icon-group');
    all.select('circle').attr('fill', d =>
      d.collapsed ? 'rgba(72,79,88,0.9)' : d.lockdown ? 'rgba(248,81,73,0.85)' : 'rgba(88,166,255,0.75)');
    all.select('use').attr('href', d => '#i-' + (d.collapsed ? 'skull' : d.lockdown ? 'lock' : d.airportClosed ? 'plane' : 'anchor'));

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
        AudioEngine.sfxBubble();

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

    enter.append('use')
      .attr('href', '#i-bolt')
      .attr('x', -5.5).attr('y', -5.5).attr('width', 11).attr('height', 11)
      .attr('color', '#3fb950')
      .attr('pointer-events', 'none');

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

  // Bubbles stay roughly thumb-sized on screen instead of growing with the
  // map: bigger than drawn on phones, and shrinking as you zoom in.
  function bubbleTransform(d) {
    const c = centroids[d.iso];
    if (!c) return 'translate(0,0)';
    const k = _currentZoom.k;
    const s = (coarse ? 1.5 : 1) / Math.pow(k, 0.8);
    return `translate(${c[0] + d.dx * s}, ${c[1] + d.dy * s}) scale(${s})`;
  }

  // ─── EPICENTER ────────────────────────────────
  function setOrigin(iso) {
    originIso = iso;
    if (dotPoints[iso] && centroids[iso]) orderPoints(iso, centroids[iso]);
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
  // The land itself only takes a tint: a dull red as infection saturates a
  // country, fading to near-black as it dies. The bright detail is the
  // point layer drawn on top. Quantised so the DOM isn't touched every step.
  const tintScale = d3.interpolateRgb(C.healthy, '#4d170a');
  function colorFor(c) {
    if (!c.reached && !c.infected) return C.healthy;
    const affected = Math.min(1, (c.infected + c.dead) / c.pop);
    const dead     = Math.min(1, c.dead / c.pop);
    const a = Math.max(1, Math.round(Math.pow(affected, 0.45) * 16)) / 16;
    let col = tintScale(a);
    if (dead > 0.02) col = d3.interpolateRgb(col, '#050203')(Math.round(Math.min(1, dead * 1.15) * 12) / 12);
    return col;
  }

  // ─── INFECTION POINTS ─────────────────────────
  // Every country gets a fixed scatter of points inside its borders (more
  // for bigger populations). They light up in order of distance from where
  // the pathogen entered, so you watch it cross the country, and turn to
  // ash as people die. Drawn on a canvas because there are thousands.
  let dotCanvas = null, dotCtx = null, dotFrame = 0;
  let dotPoints = {}; // iso -> { pts: [[x, y], ...], shown }

  function buildPoints(features) {
    dotPoints = {};
    const probe = document.createElement('canvas').getContext('2d');
    for (const f of features) {
      const iso = parseInt(f.id);
      const c   = Game.getCountry(iso);
      const d   = c && pathGen(f);
      if (!d) continue;
      const shape = new Path2D(d);
      const [[x0, y0], [x1, y1]] = pathGen.bounds(f);
      const want = Math.max(5, Math.min(LOW_FX ? 80 : 110, Math.round(Math.sqrt(c.pop / 1e6) * 3)));
      let s = iso * 9301 + 49297; // fixed per country, so the pattern survives a resize
      const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
      const pts = [];
      for (let tries = 0; pts.length < want && tries < want * 60; tries++) {
        const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0);
        if (probe.isPointInPath(shape, x, y)) pts.push([x, y]);
      }
      if (!pts.length && centroids[iso]) pts.push(centroids[iso]);
      dotPoints[iso] = { pts, shown: 0 };
      orderPoints(iso, centroids[iso]);
    }
  }

  function orderPoints(iso, from) {
    const dp = dotPoints[iso];
    if (!dp || !from) return;
    const d2 = p => (p[0] - from[0]) ** 2 + (p[1] - from[1]) ** 2;
    dp.pts.sort((a, b) => d2(a) - d2(b));
  }

  // Where the pathogen came in decides which side of the country lights up first.
  function setEntry(iso, srcIso, method) {
    const dp = dotPoints[iso];
    if (!dp) return;
    if (method === 'air travel' || srcIso == null || !centroids[srcIso]) {
      orderPoints(iso, dp.pts[(iso * 7) % dp.pts.length]); // a city somewhere inside
    } else {
      orderPoints(iso, centroids[srcIso]);                 // the border facing the source
    }
    dp.shown = 0;
    scheduleDots();
  }

  function sizeDotCanvas(W, H) {
    dotCanvas = dotCanvas || document.getElementById('particle-canvas');
    if (!dotCanvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    dotCanvas.width = W * dpr; dotCanvas.height = H * dpr;
    dotCanvas.style.width = W + 'px'; dotCanvas.style.height = H + 'px';
    dotCtx = dotCanvas.getContext('2d');
    dotCtx.dpr = dpr;
  }

  function scheduleDots() {
    if (!dotFrame) dotFrame = requestAnimationFrame(drawDots);
  }

  // ─── TRANSMISSION ARCS ────────────────────────
  // Faint pulses travelling between infected countries along the routes
  // the pathogen can actually use right now: land borders, open airports,
  // open ports. Decoration, but it tells the truth about what is connected.
  const ARC_COLORS = { land: '227,179,65', air: '88,166,255', sea: '0,204,180' };
  let arcs = [], lastArcAt = 0;

  function spawnArc(now) {
    const hosts = Game.getAllCountries().filter(c => c.infected > 5000 && centroids[c.iso]);
    if (hosts.length < 2) return;
    const src = hosts[Math.floor(Math.random() * hosts.length)];
    const options = [];
    const sick = iso => { const c = Game.getCountry(iso); return c && c.infected > 0 && centroids[iso] ? c : null; };
    if (!src.borderClosed || src.collapsed) for (const iso of src.borders) { const c = sick(iso); if (c) options.push([c, 'land']); }
    if (src.airports > 0 && !src.airportClosed && !src.collapsed) {
      const c = hosts[Math.floor(Math.random() * hosts.length)];
      if (c !== src && c.airports > 0 && !c.airportClosed) options.push([c, 'air']);
    }
    if (src.ports > 0 && !src.portClosed && !src.collapsed) {
      const c = hosts[Math.floor(Math.random() * hosts.length)];
      if (c !== src && c.ports > 0 && !c.portClosed) options.push([c, 'sea']);
    }
    if (!options.length) return;
    const [dst, kind] = options[Math.floor(Math.random() * options.length)];
    const [x1, y1] = centroids[src.iso], [x2, y2] = centroids[dst.iso];
    const dist = Math.hypot(x2 - x1, y2 - y1);
    arcs.push({
      x1, y1, x2, y2, kind,
      cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 - (kind === 'land' ? dist * 0.12 : Math.min(dist * 0.35, 90)),
      start: now, dur: 900 + dist * 9,
    });
  }

  function drawArcs(ctx, now, k) {
    arcs = arcs.filter(a => now - a.start < a.dur);
    ctx.lineCap = 'round';
    for (const a of arcs) {
      const head = (now - a.start) / a.dur, tail = Math.max(0, head - 0.22);
      const at = t => { const u = 1 - t; return [u * u * a.x1 + 2 * u * t * a.cx + t * t * a.x2, u * u * a.y1 + 2 * u * t * a.cy + t * t * a.y2]; };
      ctx.beginPath();
      for (let i = 0; i <= 8; i++) {
        const [x, y] = at(tail + (head - tail) * i / 8);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = `rgba(${ARC_COLORS[a.kind]},${0.55 * Math.sin(Math.PI * head)})`;
      ctx.lineWidth = 1.3 / Math.pow(k, 0.8);
      ctx.stroke();
    }
  }

  // While a game is running the layer animates: points shimmer and arcs
  // travel. Paused, hidden or with reduced motion it only redraws on change.
  let animTimer = null;
  function setAnimating(on) {
    const still = document.body.classList.contains('reduced-motion') ||
                  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (on && !still && !animTimer) {
      animTimer = setInterval(() => { if (!document.hidden) scheduleDots(); }, LOW_FX ? 110 : 60);
    } else if ((!on || still) && animTimer) {
      clearInterval(animTimer); animTimer = null; arcs = [];
      scheduleDots();
    }
  }

  function drawDots(now) {
    dotFrame = 0;
    if (!dotCtx) return;
    now = now || performance.now();
    const gsNow   = Game.getState();
    const running = !!animTimer && gsNow.phase === 'spreading' && !gsNow.paused;
    if (running && now - lastArcAt > (LOW_FX ? 900 : 450) && arcs.length < (LOW_FX ? 6 : 14)) { lastArcAt = now; spawnArc(now); }
    const ctx = dotCtx, t = _currentZoom, dpr = ctx.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, dotCanvas.width, dotCanvas.height);
    ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);

    // Points grow a little as you zoom in, but far slower than the map does
    const r = 1.7 * Math.max(0.7, Math.min(1.2, baseScale / 129)) / Math.pow(t.k, 0.72);
    // Three groups of live points pulse out of step with each other
    const live = [new Path2D(), new Path2D(), new Path2D()], glow = new Path2D(), ash = new Path2D();
    const calm = new Path2D(); // people the pathogen hasn't reached
    let growing = false;

    for (const c of Game.getAllCountries()) {
      const dp = dotPoints[c.iso];
      if (!dp) continue;
      const affected = (c.infected + c.dead) / c.pop;
      const n = dp.pts.length;
      if (affected <= 0) dp.shown = 0;
      const target = affected <= 0 ? 0 : Math.min(n, Math.max(1, Math.round(n * Math.pow(affected, 0.42))));
      const dead   = Math.min(target, Math.round(n * Math.pow(c.dead / c.pop, 0.6)));
      // Ease toward the target so new points arrive a few at a time
      if (dp.shown < target) { dp.shown = Math.min(target, dp.shown + Math.max(1, Math.ceil((target - dp.shown) * 0.2))); growing = growing || dp.shown < target; }
      else dp.shown = target;

      const rc = r * 0.62;
      for (let i = dp.shown; i < n; i++) {
        const [x, y] = dp.pts[i];
        calm.moveTo(x + rc, y); calm.arc(x, y, rc, 0, 6.2832);
      }
      for (let i = 0; i < dp.shown; i++) {
        const [x, y] = dp.pts[i];
        if (i < dead) { ash.moveTo(x + r * 0.8, y); ash.arc(x, y, r * 0.8, 0, 6.2832); }
        else {
          const bucket = live[i % 3];
          bucket.moveTo(x + r, y); bucket.arc(x, y, r, 0, 6.2832);
          if (!LOW_FX) { glow.moveTo(x + r * 2.8, y); glow.arc(x, y, r * 2.8, 0, 6.2832); }
        }
      }
    }
    ctx.fillStyle = 'rgba(150,178,215,0.2)'; ctx.fill(calm);
    ctx.fillStyle = 'rgba(132,118,112,0.6)'; ctx.fill(ash);
    if (!LOW_FX) { ctx.fillStyle = 'rgba(255,70,40,0.13)'; ctx.fill(glow); }
    for (let b = 0; b < 3; b++) {
      const shimmer = running ? 0.78 + 0.2 * Math.sin(now / 520 + b * 2.1) : 0.95;
      ctx.fillStyle = `rgba(255,96,64,${shimmer})`;
      ctx.fill(live[b]);
    }
    if (running) drawArcs(ctx, now, t.k);

    if (growing) scheduleDots();
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
  // focusY: where on screen (0 top, 1 bottom) the country should end up.
  function zoomToCountry(iso, targetScale, focusY) {
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
    const ty = H * (focusY != null ? focusY : 0.5) - s*(y0+y1)/2;

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

    if (!W || !H) return; // game screen not visible
    svg.attr('width', W).attr('height', H);
    fitProjection(W, H);
    pathGen = d3.geoPath().projection(projection);
    fitZoom(W, H);
    sizeDotCanvas(W, H);
    svg.call(zoomBehavior.transform, d3.zoomIdentity);

    g.selectAll('.country-path').attr('d', pathGen);
    g.select('.graticule').attr('d', pathGen);
    g.select('.border-mesh').attr('d', pathGen);

    if (worldTopo) {
      const feats = topojson.feature(worldTopo, worldTopo.objects.countries).features;
      computeCentroids(feats);
      buildPoints(feats);
      scheduleDots();
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

  // ─── RESET (new game on an already-loaded map) ─
  function reset() {
    if (!mapInitialized) return;
    clearSelection();
    hideRichTooltip();
    if (epicenterTimer) { clearInterval(epicenterTimer); epicenterTimer = null; }
    originIso = null;
    for (const layer of [centroidLayer, govIconLayer, epicenterLayer, routeLayer, bubbleLayer]) {
      if (layer) layer.selectAll('*').interrupt().remove();
    }
    for (const iso in pathsByIso) {
      pathsByIso[iso].interrupt().attr('fill', C.healthy).attr('filter', null);
      delete _prevColors[iso];
      delete _prevFilters[iso];
    }
    updateLabels();
    arcs = [];
    for (const iso in dotPoints) { dotPoints[iso].shown = 0; orderPoints(+iso, centroids[iso]); }
    scheduleDots();
    svg.interrupt().call(zoomBehavior.transform, d3.zoomIdentity);
  }

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
    zoomToCountry, resetZoom, resize, reset, updateGovIcons, setEntry, setAnimating,
    focusCountry: iso => { const c = Game.getCountry(iso); if (c) selectCountry(iso, c); },
    setOrigin, colorFor, isReady: () => mapInitialized,
    setPick, showTravelRoute,
  };
})();

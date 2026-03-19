/* ═══════════════════════════════════════════════
   PATHOGEN v2 - World Map (D3 + TopoJSON)
   ═══════════════════════════════════════════════ */

const Map = (() => {
  let svg, g, projection, pathGen, zoomBehavior;
  let worldTopo       = null;
  let pathsByIso      = {};
  let centroids       = {};
  let centroidLayer   = null;
  let epicenterLayer  = null;
  let bubbleLayer     = null;
  let mapInitialized  = false;
  let selectedIso     = null;
  let originIso       = null;
  let epicenterTimer  = null;
  let svgEl           = null;

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
      .on('zoom', ({ transform }) => g.attr('transform', transform));

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
      .attr('stroke', 'rgba(30,60,90,0.45)')
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

  // ─── SVG DEFS (filters) ───────────────────────
  function addDefs() {
    const defs = svg.append('defs');

    // Infection glow
    const gf = defs.append('filter')
      .attr('id', 'inf-glow')
      .attr('x', '-60%').attr('y', '-60%')
      .attr('width', '220%').attr('height', '220%');
    gf.append('feGaussianBlur')
      .attr('in', 'SourceGraphic').attr('stdDeviation', '4').attr('result', 'blur');
    const gm = gf.append('feMerge');
    gm.append('feMergeNode').attr('in', 'blur');
    gm.append('feMergeNode').attr('in', 'SourceGraphic');

    // Subtle dot glow
    const df = defs.append('filter')
      .attr('id', 'dot-glow')
      .attr('x', '-80%').attr('y', '-80%')
      .attr('width', '260%').attr('height', '260%');
    df.append('feGaussianBlur')
      .attr('in', 'SourceGraphic').attr('stdDeviation', '2.5').attr('result', 'b');
    const dm = df.append('feMerge');
    dm.append('feMergeNode').attr('in', 'b');
    dm.append('feMergeNode').attr('in', 'SourceGraphic');

    // Ocean radial gradient
    const grad = defs.append('radialGradient')
      .attr('id', 'ocean-grad').attr('cx', '50%').attr('cy', '55%').attr('r', '60%');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#0c1828');
    grad.append('stop').attr('offset', '100%').attr('stop-color', C.ocean);
  }

  // ─── RENDER WORLD ─────────────────────────────
  function renderWorld(world) {
    const countries = topojson.feature(world, world.objects.countries);

    g.selectAll('.country-path')
      .data(countries.features)
      .join('path')
      .attr('class', 'country-path')
      .attr('id',    d => `cp-${d.id}`)
      .attr('d', pathGen)
      .attr('fill',         C.healthy)
      .attr('stroke',       C.border)
      .attr('stroke-width', 0.5)
      .on('click', onCountryClick)
      .on('mousemove', onCountryHover)
      .on('mouseleave', onCountryLeave)
      .on('touchend', function(event, d) {
        event.preventDefault();
        onCountryClick.call(this, event, d);
      });

    // Border mesh (thinner, dimmer)
    g.append('path')
      .datum(topojson.mesh(world, world.objects.countries, (a, b) => a !== b))
      .attr('fill', 'none')
      .attr('stroke', '#252c35')
      .attr('stroke-width', 0.3);

    // Index paths for fast update
    countries.features.forEach(f => {
      pathsByIso[f.id] = d3.select(`#cp-${f.id}`);
    });

    // Mark game countries vs non-game territories
    const gameIsoSet = new Set(COUNTRIES_DATA.map(c => c.iso));
    countries.features.forEach(f => {
      const iso = parseInt(f.id);
      const el  = pathsByIso[f.id];
      if (!el || el.empty()) return;
      if (gameIsoSet.has(iso)) {
        el.classed('game-country', true);
      } else {
        el.classed('non-game-country', true);
      }
    });

    // Compute centroids
    computeCentroids(countries.features);

    // Infection dot layer (above countries)
    centroidLayer  = g.append('g').attr('class', 'centroid-layer');
    // Epicenter ring layer
    epicenterLayer = g.append('g').attr('class', 'epicenter-layer');
    // DNA Bubble layer (topmost — player clicks these)
    bubbleLayer    = g.append('g').attr('class', 'bubble-layer');

    // Ocean click dismiss
    svg.on('click', event => {
      if (event.target === svgEl || event.target.classList?.contains('graticule')) {
        UI.hideCountryPanel();
        clearSelection();
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

  // ─── CLICK HANDLER ────────────────────────────
  function onCountryClick(event, d) {
    event.stopPropagation();
    const iso     = parseInt(d.id, 10);
    const country = Game.getCountry(iso);

    const gs = Game.getState();

    if (gs.phase === 'idle') {
      if (!country) {
        _showNonGameTooltip(event);
        return;
      }
      if (typeof window.onMapCountryPick === 'function') {
        window.onMapCountryPick(iso, country);
      }
      return;
    }

    if (!country) return;  // non-game territory during game — ignore

    clearSelection();
    selectedIso = iso;
    d3.select(event.currentTarget).classed('selected', true);
    UI.showCountryPanel(country);
  }

  function onCountryHover(event, d) {
    const iso     = parseInt(d.id, 10);
    const country = Game.getCountry(iso);

    const gs = Game.getState();

    // Show tooltip (respect setting)
    const showTooltips = localStorage.getItem('set_show_tooltips') !== '0';
    if (showTooltips) {
      const tt     = document.getElementById('map-tooltip');
      const ttName = document.getElementById('tt-name');
      const ttStat = document.getElementById('tt-status');
      if (tt) {
        if (!country) {
          if (gs.phase === 'idle') {
            ttName.textContent = 'Minor Territory';
            ttStat.textContent = 'Not tracked in simulation';
            tt.classList.remove('hidden');
            tt.style.left = (event.pageX + 14) + 'px';
            tt.style.top  = (event.pageY - 28) + 'px';
          }
          // Highlight country on hover during pick mode
          if (gs.phase === 'idle') {
            d3.select(event.currentTarget).classed('pick-hover', true);
          }
          return;
        }
        ttName.textContent = country.name;
        if (gs.phase === 'idle') {
          ttStat.textContent = `${UI.fmt(country.pop)} pop · ${country.climate} · ${country.wealth}`;
        } else if (!country.reached) {
          ttStat.textContent = 'Uninfected';
        } else {
          const pct = (country.infected / country.pop * 100).toFixed(1);
          ttStat.textContent = `${pct}% infected`;
        }
        tt.classList.remove('hidden');
        tt.style.left = (event.pageX + 14) + 'px';
        tt.style.top  = (event.pageY - 28) + 'px';
      }
    }

    // Highlight country on hover during pick mode
    if (gs.phase === 'idle') {
      d3.select(event.currentTarget).classed('pick-hover', true);
    }
  }

  function onCountryLeave(event) {
    const tt = document.getElementById('map-tooltip');
    if (tt) tt.classList.add('hidden');
    d3.select(event.currentTarget).classed('pick-hover', false);
  }

  function _showNonGameTooltip(event) {
    const tt     = document.getElementById('map-tooltip');
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
    d3.selectAll('.country-path').classed('selected', false);
    selectedIso = null;
  }

  // ─── UPDATE COLORS ────────────────────────────
  let _colorUpdateCount = 0;
  function updateColors() {
    if (!mapInitialized) return;
    _colorUpdateCount++;

    const countries = Game.getAllCountries();
    for (const c of countries) {
      const el = pathsByIso[c.iso];
      if (!el || el.empty()) continue;

      const color   = colorFor(c);
      const deadPct = c.dead    / c.pop;
      const infPct  = (c.infected + c.dead) / c.pop;

      el.attr('fill', color);
      // Apply glow to heavily infected/dead countries
      el.attr('filter', (deadPct > 0.12 || infPct > 0.35) ? 'url(#inf-glow)' : null);
    }

    // Update infection intensity dots every 3 color refreshes
    if (_colorUpdateCount % 3 === 0) updateInfectionDots();
    // Update DNA bubble layer every 4 refreshes
    if (_colorUpdateCount % 4 === 0) updateBubbles();
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

    // Enter
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

        // Float "+N DNA" text at bubble location
        const c = centroids[d.iso];
        if (c && epicenterLayer) {
          const ft = epicenterLayer.append('text')
            .attr('x', c[0] + d.dx)
            .attr('y', c[1] + d.dy - 8)
            .attr('text-anchor', 'middle')
            .attr('fill', '#3fb950')
            .attr('font-size', '9px')
            .attr('font-weight', '700')
            .attr('font-family', 'Inter, system-ui, sans-serif')
            .attr('pointer-events', 'none')
            .text(`+${val} DNA`);
          ft.transition().duration(1000).ease(d3.easeCubicOut)
            .attr('y', c[1] + d.dy - 26)
            .style('opacity', 0)
            .remove();
        }
      });

    // Glow circle (background)
    enter.append('circle')
      .attr('class', 'bubble-bg')
      .attr('r', 8)
      .attr('fill', 'rgba(63,185,80,0.15)')
      .attr('stroke', '#3fb950')
      .attr('stroke-width', 1.2)
      .attr('pointer-events', 'all');

    // Pulse ring animation (CSS keyframe via class)
    enter.append('circle')
      .attr('class', 'bubble-pulse')
      .attr('r', 8)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(63,185,80,0.6)')
      .attr('stroke-width', 1)
      .attr('pointer-events', 'none');

    // ⚡ icon
    enter.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', '8px')
      .attr('pointer-events', 'none')
      .text('⚡');

    // DNA value label
    enter.append('text')
      .attr('class', 'bubble-val')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('y', 11)
      .attr('font-size', '6px')
      .attr('fill', '#3fb950')
      .attr('pointer-events', 'none')
      .text(d => `+${d.value}`);

    // Animate in
    enter.transition().duration(300).ease(d3.easeCubicOut)
      .style('opacity', 1)
      .attr('transform', d => bubbleTransform(d));

    // Update positions on existing (e.g. after resize)
    sel.attr('transform', d => bubbleTransform(d));

    // Hover effects
    enter.on('mouseover', function() {
      d3.select(this).select('.bubble-bg')
        .attr('fill', 'rgba(63,185,80,0.35)')
        .attr('stroke', '#79c0ff');
    }).on('mouseout', function() {
      d3.select(this).select('.bubble-bg')
        .attr('fill', 'rgba(63,185,80,0.15)')
        .attr('stroke', '#3fb950');
    });

    // Exit
    sel.exit()
      .transition().duration(400)
      .style('opacity', 0)
      .remove();
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

    // Static rings
    [3, 6, 9].forEach((r, i) => {
      epicenterLayer.append('circle')
        .attr('cx', cx).attr('cy', cy).attr('r', r)
        .attr('fill', 'none')
        .attr('stroke', '#f85149')
        .attr('stroke-width', 0.8 - i * 0.2)
        .attr('opacity', 0.6 - i * 0.15)
        .attr('pointer-events', 'none');
    });

    // Central dot
    epicenterLayer.append('circle')
      .attr('cx', cx).attr('cy', cy).attr('r', 1.5)
      .attr('fill', '#f85149').attr('opacity', 0.9)
      .attr('pointer-events', 'none');

    // Repeating pulse animation
    function spawnPulse() {
      if (!epicenterLayer) return;
      epicenterLayer.append('circle')
        .attr('cx', cx).attr('cy', cy).attr('r', 2)
        .attr('fill', 'none')
        .attr('stroke', '#f85149').attr('stroke-width', 1.2)
        .attr('opacity', 0.8)
        .attr('pointer-events', 'none')
        .transition().duration(1800).ease(d3.easeCubicOut)
        .attr('r', 13).attr('opacity', 0)
        .remove();
    }
    spawnPulse();
    epicenterTimer = setInterval(spawnPulse, 2200);
  }

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
    el.attr('fill', '#f85149')
      .transition().duration(900)
      .attr('fill', colorFor(Game.getCountry(iso) || {}));
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
  function zoomToCountry(iso) {
    if (!mapInitialized || !worldTopo) return;
    const features = topojson.feature(worldTopo, worldTopo.objects.countries).features;
    const feature  = features.find(f => parseInt(f.id) === parseInt(iso));
    if (!feature) return;

    const containerEl = document.getElementById('map-container');
    const W = containerEl.clientWidth;
    const H = containerEl.clientHeight;
    const [[x0,y0],[x1,y1]] = pathGen.bounds(feature);
    const scale = Math.min(6, 0.85 / Math.max((x1-x0)/W, (y1-y0)/H));
    const tx = W/2 - scale*(x0+x1)/2;
    const ty = H/2 - scale*(y0+y1)/2;

    svg.transition().duration(900)
      .call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  function resetZoom() {
    svg.transition().duration(700)
      .call(zoomBehavior.transform, d3.zoomIdentity);
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

    // Recompute centroids, reposition dots and epicenter
    if (worldTopo) {
      computeCentroids(topojson.feature(worldTopo, worldTopo.objects.countries).features);
      if (centroidLayer) {
        centroidLayer.selectAll('.inf-dot')
          .attr('cx', d => centroids[d.iso]?.[0] ?? 0)
          .attr('cy', d => centroids[d.iso]?.[1] ?? 0);
      }
      if (originIso) setOrigin(originIso);
      updateBubbles();
    }
  }

  function setupOceanClick() { /* handled inside renderWorld */ }

  // ─── PICK MODE ─────────────────────────────────
  function setPick(on) {
    svgEl = svgEl || document.getElementById('world-map');
    if (svgEl) svgEl.classList.toggle('pick-mode', on);
  }

  // ─── TRAVEL ROUTE FLASH ────────────────────────
  function showTravelRoute(srcIso, dstIso) {
    if (!epicenterLayer || !centroids[srcIso] || !centroids[dstIso]) return;
    const [x1, y1] = centroids[srcIso];
    const [x2, y2] = centroids[dstIso];
    const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    const curve = Math.min(dist * 0.4, 90);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 - curve;
    const pathD = `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;

    // Arc line — fades out after 2.5s
    const line = epicenterLayer.append('path')
      .attr('d', pathD)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(248,81,73,0.7)')
      .attr('stroke-width', 1.2)
      .attr('stroke-dasharray', '5 4')
      .attr('pointer-events', 'none')
      .attr('opacity', 1);

    line.transition().delay(400).duration(2200).ease(d3.easeCubicOut)
      .attr('opacity', 0)
      .remove();

    // Traveling dot along path using rAF
    const dot = epicenterLayer.append('circle')
      .attr('r', 2.5).attr('fill', '#f85149').attr('opacity', 1)
      .attr('pointer-events', 'none');

    // Measure path length by creating a temporary node
    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tmp.setAttribute('d', pathD);
    const totalLen = tmp.getTotalLength();

    let startTime = null;
    const duration = 1300;
    function animateDot(ts) {
      if (!startTime) startTime = ts;
      const t = Math.min((ts - startTime) / duration, 1);
      const pos = tmp.getPointAtLength(t * totalLen);
      dot.attr('cx', pos.x).attr('cy', pos.y);
      if (t < 1) {
        requestAnimationFrame(animateDot);
      } else {
        dot.transition().duration(600).attr('r', 7).attr('opacity', 0).remove();
        // Pulse ring at destination
        epicenterLayer.append('circle')
          .attr('cx', x2).attr('cy', y2).attr('r', 3)
          .attr('fill', 'none').attr('stroke', '#f85149').attr('stroke-width', 1.5)
          .attr('opacity', 0.85).attr('pointer-events', 'none')
          .transition().duration(900).attr('r', 16).attr('opacity', 0).remove();
      }
    }
    requestAnimationFrame(animateDot);
  }

  window.addEventListener('resize', () => {
    clearTimeout(window._mapResizeTimer);
    window._mapResizeTimer = setTimeout(resize, 150);
  });

  document.addEventListener('DOMContentLoaded', () => {
    svgEl = document.getElementById('world-map');
  });

  return {
    load, updateColors, pulseCountry, highlightCountry,
    zoomToCountry, resetZoom, resize, setupOceanClick,
    setOrigin, colorFor, isReady: () => mapInitialized,
    setPick, showTravelRoute,
  };
})();

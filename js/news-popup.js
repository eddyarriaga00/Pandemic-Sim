// news-popup.js — compact breaking news card system
// A slide-in card in the corner; the full story opens in a modal.

const NewsPopup = (() => {
  // Stories are picked by what is actually happening in the game, not by
  // the calendar. Each is shown once; the most dramatic eligible one wins.
  const anyCountry = (gs, test) => Object.values(gs.countries).some(test);
  const deadShare  = gs => gs.totalDead / gs.totalPop;
  const infShare   = gs => gs.totalInfected / gs.totalPop;

  const STORIES = [
    { rank: 1,  when: gs => gs.day >= 5,
      channel: 'GNN HEALTH', tag: 'LOCAL', headline: 'Unusual Illness Cluster Puzzles Doctors',
      body: 'A handful of patients with matching symptoms have turned up at clinics in the same district. Officials describe the cases as "probably unrelated" and say there is no cause for concern.' },
    { rank: 2,  when: gs => gs.detection > 0.5 && !gs.cureActive,
      channel: 'WORLD WIRE', tag: 'EXCLUSIVE', headline: '"This Is Not the Flu": Lab Staff Flag an Unknown Organism',
      body: 'Technicians processing routine samples say they are seeing something they cannot match to any known pathogen. "It moves through populations in ways we do not understand yet," said one researcher who asked not to be named.' },
    { rank: 3,  when: gs => gs.cureActive,
      channel: 'HEALTH ALERT', tag: 'URGENT', headline: 'New Pathogen Formally Identified as Research Teams Assemble',
      body: 'Health agencies have confirmed a previously unknown pathogen and given it a name. Laboratories on four continents have begun sharing samples, and the first funding for a cure has been released.' },
    { rank: 4,  when: gs => gs.countriesInfected >= 10,
      channel: 'GNN GLOBAL', tag: 'BREAKING', headline: 'Cases Confirmed on Multiple Continents',
      body: 'The outbreak is no longer a regional story. Airlines have started health screening at departure gates and travel insurers are quietly rewriting their small print.' },
    { rank: 5,  when: gs => anyCountry(gs, c => c.airportClosed),
      channel: 'WORLD WIRE', tag: 'BREAKING', headline: 'First Airports Close as Governments Try to Wall the Outbreak In',
      body: 'Departure boards have gone blank in the first countries to ground international flights. Epidemiologists warn that closures only buy time, and only if they come early enough.' },
    { rank: 6,  when: gs => anyCountry(gs, c => c.lockdown),
      channel: 'GNN CRISIS', tag: 'LIVE', headline: 'Cities Fall Silent Under Stay-at-Home Orders',
      body: 'Satellite imagery shows traffic vanishing from major roads as lockdown orders take effect. Supermarket shelves emptied within hours of the announcement.' },
    { rank: 7,  when: gs => infShare(gs) > 0.25,
      channel: 'HEALTH ALERT', tag: 'URGENT', headline: 'One in Four People on Earth Now Infected',
      body: 'Modellers say the figure is almost certainly an undercount. Contact tracing has been abandoned in most countries; there are simply too many contacts to trace.' },
    { rank: 8,  when: gs => gs.cureProgress > 40,
      channel: 'WORLD WIRE', tag: 'EXCLUSIVE', headline: 'Cure Research Passes the Halfway Mark, Scientists Say',
      body: 'Research teams report real progress toward a treatment, though several promising candidates have already failed. "We are closer than we were, and further than we would like," one lab director said.' },
    { rank: 9,  when: gs => deadShare(gs) > 0.01,
      channel: 'GNN CRISIS', tag: 'BREAKING', headline: 'Hospitals Overwhelmed: "We Have Run Out of Options"',
      body: 'Emergency doctors describe being forced to choose who receives care. Morgues are full and temporary facilities are being set up in car parks and ice rinks.' },
    { rank: 10, when: gs => anyCountry(gs, c => c.collapsed),
      channel: 'WORLD WIRE', tag: 'CRITICAL', headline: 'First Government Collapses as Its Workforce Disappears',
      body: 'With most civil servants, police and medical staff dead or dying, at least one national government has stopped functioning. Its borders are unguarded and its hospitals unstaffed.' },
    { rank: 11, when: gs => deadShare(gs) > 0.25,
      channel: 'EMERGENCY SIGNAL', tag: 'CRITICAL', headline: 'Power Grids Failing Across Three Continents',
      body: 'Grid operators report cascading failures as control rooms go unstaffed. Hospitals still running are on generators. The lights are going out one city at a time.' },
    { rank: 12, when: gs => gs.cureProgress > 85,
      channel: 'HEALTH ALERT', tag: 'URGENT', headline: 'Cure in Final Trials: "Weeks, Not Months"',
      body: 'What remains of the world\'s research community has converged on a single candidate. Manufacturing lines are being prepared before the trial results are even in.' },
    { rank: 13, when: gs => deadShare(gs) > 0.7,
      channel: 'FINAL SIGNAL', tag: 'FINAL', headline: 'This May Be Our Last Broadcast',
      body: 'To whoever is receiving this: we do not know how much longer we can keep this going. The building is mostly empty and the generators are running low. If you are out there, stay safe.' },
  ];

  const MIN_GAP_DAYS = 12;
  let lastShownDay = -99;
  let shown = new Set();

  function check(day) {
    if (day - lastShownDay < MIN_GAP_DAYS) return;
    const gs = Game.getState();
    if (gs.phase !== 'spreading') return;
    const eligible = STORIES.filter(s => !shown.has(s.rank) && s.when(gs));
    if (!eligible.length) return;
    const story = eligible[eligible.length - 1];
    // Anything less dramatic than what we just showed is old news now
    for (const s of STORIES) if (s.rank <= story.rank) shown.add(s.rank);
    lastShownDay = day;
    show(story);
  }

  let _dismissTimer = null;

  function show(story) {
    const gs = Game.getState();

    // Remove existing card if any
    const old = document.getElementById('news-card');
    if (old) old.remove();
    clearTimeout(_dismissTimer);

    if (typeof AudioEngine !== 'undefined') AudioEngine.sfxNewsAlert();

    const tagColors = {
      'BREAKING': '#da3633', 'URGENT': '#cc7700', 'LIVE': '#238636', 'LOCAL': '#30363d',
      'EXCLUSIVE': '#6e40c9', 'CRITICAL': '#da3633', 'FINAL': '#484f58',
    };
    const tagColor = tagColors[story.tag] || '#484f58';

    const card = document.createElement('div');
    card.id = 'news-card';
    card.className = 'news-card';
    card.innerHTML = `
      <div class="nc-bar">
        <span class="nc-channel">${story.channel}</span>
        <span class="nc-tag" style="background:${tagColor}">${story.tag}</span>
        <span class="nc-day">DAY ${gs.day}</span>
        <button class="nc-close" id="nc-close-btn">✕</button>
      </div>
      <div class="nc-content">
        <div class="nc-text">
          <p class="nc-headline">${story.headline}</p>
          <p class="nc-sub">${story.body.slice(0, 110)}…</p>
        </div>
      </div>
      <button class="nc-read-more" id="nc-read-more-btn">READ FULL STORY ›</button>
      <div class="nc-timer-bar"><div class="nc-timer-fill" id="nc-timer-fill"></div></div>
    `;
    document.body.appendChild(card);

    // Animate timer bar
    const fill = document.getElementById('nc-timer-fill');
    if (fill) {
      fill.style.transition = 'none';
      fill.style.width = '100%';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        fill.style.transition = 'width 9s linear';
        fill.style.width = '0%';
      }));
    }

    // GSAP entrance
    if (typeof gsap !== 'undefined') {
      gsap.fromTo(card,
        { x: 340, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.35, ease: 'power3.out' }
      );
    } else {
      card.classList.add('nc-visible');
    }

    function dismiss() {
      clearTimeout(_dismissTimer);
      if (typeof gsap !== 'undefined') {
        gsap.to(card, { x: 340, opacity: 0, duration: 0.25, ease: 'power2.in',
          onComplete: () => card.remove() });
      } else {
        card.remove();
      }
    }

    _dismissTimer = setTimeout(dismiss, 9500);

    document.getElementById('nc-close-btn').onclick = dismiss;
    const day  = gs.day;
    const open = () => { dismiss(); showFullStory(story, day); };
    document.getElementById('nc-read-more-btn').onclick = open;
    card.querySelector('.nc-text').onclick = open; // the button is hidden on phones

  }

  function showFullStory(story, day) {
    const modal = document.getElementById('modal-news');
    if (!modal) return;

    document.getElementById('news-channel').textContent  = story.channel;
    document.getElementById('news-tag').textContent      = story.tag;
    document.getElementById('news-headline').textContent = story.headline;
    document.getElementById('news-body').textContent     = story.body;

    document.getElementById('news-day').textContent = `DAY ${day || '?'}`;

    const btn  = document.getElementById('btn-close-news');
    const span = document.getElementById('news-close-label');
    btn.disabled = false;
    span.textContent = 'CLOSE ✕';
    btn.onclick = () => modal.classList.add('hidden');

    modal.classList.remove('hidden');
  }

  function reset(day) {
    lastShownDay = day != null ? day : -99;
    shown = new Set();
    const old = document.getElementById('news-card');
    if (old) old.remove();
    clearTimeout(_dismissTimer);
  }

  return { check, show, reset };
})();

// news-popup.js — compact breaking news card system
// Replaces full-screen modal with a sleek slide-in card (bottom-right)

const NewsPopup = (() => {
  let lastShownDay = -99;
  const INTERVAL   = 21; // game days between cards

  const STORIES = [
    { minDay: 3,   channel: 'GNN HEALTH',      tag: 'BREAKING',  headline: 'Mystery Illness Baffles Doctors — "No Known Cause"', body: 'Health officials are scrambling after an unusual cluster of respiratory illnesses has emerged, leaving local hospitals with more questions than answers. Patients report severe fatigue, fever, and disorientation. The WHO says it is "monitoring the situation closely."', imgSeed: 237 },
    { minDay: 10,  channel: 'WHO ALERT',        tag: 'URGENT',    headline: 'WHO Deploys Emergency Response Team After Unusual Pneumonia Cluster', body: 'The World Health Organization has dispatched a rapid response team after reports of an atypical pneumonia cluster. Early genomic analysis suggests the pathogen may be novel. International travel advisories have not yet been issued, but experts urge vigilance.', imgSeed: 65 },
    { minDay: 18,  channel: 'REUTERS GLOBAL',   tag: 'EXCLUSIVE', headline: '"This Is Not the Flu" — Scientists Warn of Unknown Pathogen\'s Unusual Behaviour', body: 'Virologists studying samples from affected patients say the pathogen exhibits characteristics unlike any previously catalogued organism. "It moves through populations in ways we don\'t fully understand yet," said one researcher who requested anonymity.', imgSeed: 342 },
    { minDay: 28,  channel: 'GNN GLOBAL',       tag: 'BREAKING',  headline: 'New Disease Confirmed in Multiple Countries — WHO Declares "International Concern"', body: 'The mystery pathogen has now been confirmed in several nations across multiple continents, triggering WHO\'s second-highest alert level. Airlines are implementing voluntary passenger health screening protocols. Financial markets fell sharply on the news.', imgSeed: 119 },
    { minDay: 38,  channel: 'BBC WORLD',        tag: 'LIVE',      headline: 'Hospitals Report Surge in Admissions as Disease Spreads Beyond Initial Region', body: 'Emergency departments across affected nations are reporting capacity issues as patient numbers climb. Governments have begun stockpiling antivirals and protective equipment. The pathogen\'s exact transmission mechanism remains disputed among scientists.', imgSeed: 200 },
    { minDay: 50,  channel: 'REUTERS GLOBAL',   tag: 'URGENT',    headline: 'Stock Markets in Free Fall — "Pandemic Risk" Cited by World\'s Largest Banks', body: 'Global equities tumbled for the third consecutive session as analysts upgraded pandemic risk assessments to "severe." Supply chain disruptions are already being felt, with pharmaceutical and food sectors under particular strain.', imgSeed: 160 },
    { minDay: 62,  channel: 'WHO ALERT',        tag: 'URGENT',    headline: 'WHO Declares Global Health Emergency — "Most Serious Since 1918"', body: 'In an emergency session, WHO\'s Director-General announced the highest possible alert level for the ongoing outbreak. "$20 billion in emergency research funding" has been pledged by the G7, but critics say it may be too little, too late.', imgSeed: 20 },
    { minDay: 78,  channel: 'GNN CRISIS',       tag: 'BREAKING',  headline: 'City Lockdowns Begin — 800 Million Under Stay-At-Home Orders', body: 'Governments across three continents have imposed sweeping lockdown measures as urban infection rates spike. Major cities now resemble ghost towns, with satellite imagery showing dramatically reduced vehicle movement and activity.', imgSeed: 90 },
    { minDay: 92,  channel: 'RT GLOBAL',        tag: 'EXCLUSIVE', headline: 'Cure Research at 40% — Scientists "Cautiously Optimistic" Despite Setbacks', body: 'International research teams working around the clock report meaningful progress toward a viable treatment. However, the pathogen\'s unusual mutation rate has caused multiple setbacks. Experts warn the timeline remains deeply uncertain.', imgSeed: 400 },
    { minDay: 108, channel: 'GNN CRISIS',       tag: 'URGENT',    headline: 'Military Deployed Across 22 Countries to Enforce Health Quarantines', body: 'As civilian compliance with health measures deteriorates, armed forces have been called in to enforce emergency orders in over two dozen nations. Human rights organizations have condemned the crackdowns.', imgSeed: 280 },
    { minDay: 125, channel: 'REUTERS GLOBAL',   tag: 'BREAKING',  headline: 'Healthcare Systems Collapse — "We Have Run Out of Options"', body: 'Emergency room doctors in affected regions say they are being forced to make impossible choices about who receives care. Hospital morgues are at capacity. International medical aid convoys have been established but access to many areas is becoming impossible.', imgSeed: 180 },
    { minDay: 145, channel: 'LAST BROADCAST',   tag: 'FINAL',     headline: 'Mass Graves Ordered in 15 Countries as Conventional Burial Becomes Impossible', body: 'Governments in severely affected regions have authorised emergency burial protocols as traditional funeral services become impossible to maintain. Civil engineers are coordinating with military forces. Footage from affected areas has been largely restricted.', imgSeed: 130 },
    { minDay: 165, channel: 'LAST BROADCAST',   tag: 'CRITICAL',  headline: 'Internet Connectivity Failing in Major Cities as Infrastructure Workers Succumb', body: 'Telecom companies report critical staffing shortages as employees fall ill. Large portions of Europe and Asia are experiencing significant internet degradation. "We can\'t run the servers if there\'s nobody to run them," one executive said.', imgSeed: 450 },
    { minDay: 185, channel: 'EMERGENCY SIGNAL', tag: 'CRITICAL',  headline: 'Power Grids Failing Across Three Continents — Darkness Spreading', body: 'Electrical grid operators report cascading failures as the workforce collapses. Hospitals on generator power are prioritising critical care. The lights are going out, one city at a time.', imgSeed: 380 },
    { minDay: 210, channel: 'FINAL SIGNAL',     tag: 'FINAL',     headline: 'This May Be Our Last Broadcast — Signing Off', body: 'To whoever is receiving this signal: we don\'t know how much longer we can keep this going. The building is mostly empty. The generators are running low. If you\'re out there, stay safe. God help us all.', imgSeed: 500 },
  ];

  function pickStory(day) {
    const eligible = STORIES.filter(s => s.minDay <= day);
    if (!eligible.length) return null;
    return eligible.reduce((best, s) => s.minDay > best.minDay ? s : best);
  }

  function check(day) {
    if (day - lastShownDay < INTERVAL) return;
    const gs = Game.getState();
    if (gs.phase !== 'spreading') return;
    const story = pickStory(day);
    if (!story) return;
    lastShownDay = day;
    setTimeout(() => show(story), 1200);
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
      'BREAKING': '#da3633', 'URGENT': '#cc7700', 'LIVE': '#238636',
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
        <div class="nc-img" style="background-image:url('https://picsum.photos/seed/${story.imgSeed}/120/80')"></div>
        <div class="nc-text">
          <p class="nc-headline">${story.headline}</p>
          <p class="nc-sub">${story.body.slice(0, 100)}…</p>
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
    document.getElementById('nc-read-more-btn').onclick = () => {
      dismiss();
      showFullStory(story, gs.day);
    };
  }

  function showFullStory(story, day) {
    const modal = document.getElementById('modal-news');
    if (!modal) return;

    document.getElementById('news-channel').textContent  = story.channel;
    document.getElementById('news-tag').textContent      = story.tag;
    document.getElementById('news-headline').textContent = story.headline;
    document.getElementById('news-body').textContent     = story.body;

    const img = document.getElementById('news-img');
    img.src = `https://picsum.photos/seed/${story.imgSeed}/640/260`;
    img.alt = story.headline;
    document.getElementById('news-day').textContent = `DAY ${day || '?'}`;

    const btn  = document.getElementById('btn-close-news');
    const span = document.getElementById('news-close-label');
    btn.disabled = false;
    span.textContent = 'CLOSE ✕';
    btn.onclick = () => modal.classList.add('hidden');

    modal.classList.remove('hidden');
  }

  function reset() {
    lastShownDay = -99;
    const old = document.getElementById('news-card');
    if (old) old.remove();
    clearTimeout(_dismissTimer);
  }

  return { check, show, reset };
})();

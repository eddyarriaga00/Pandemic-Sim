# ☣ PATHOGEN — Global Pandemic Simulator

> *Eight billion lives. One pathogen. No mercy.*

[![Made with JavaScript](https://img.shields.io/badge/Made%20with-JavaScript-f7df1e?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![D3.js](https://img.shields.io/badge/D3.js-v7-f08030?style=flat-square&logo=d3dotjs)](https://d3js.org)
[![Web Audio API](https://img.shields.io/badge/Audio-Web%20Audio%20API-ff4444?style=flat-square)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
[![GitHub Pages](https://img.shields.io/badge/Deployed-GitHub%20Pages-24292e?style=flat-square&logo=github)](https://pages.github.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

A browser-based pandemic strategy game in vanilla JavaScript. No frameworks, no build step: serve the folder and play.

**[🎮 Play Now →](https://eddyarriaga00.github.io/Pandemic-Sim/)**

---

## What It Is

You release a pathogen and evolve it, choosing how it travels, what it does to its hosts and how it resists treatment. The goal is to infect all 118 countries and wipe out 7.7 billion people before a cure is finished. The world pushes back: doctors notice, airports and ports close, borders shut, research accelerates.

There are two ways to lose. The cure can be completed and deployed, or your pathogen can kill its last host while people are still uninfected.

---

## How the simulation works

The engine ([js/game.js](js/game.js)) has no DOM, audio or map code in it. It publishes events and the page reacts, which also means it runs headless under Node.

- **Epidemic model.** Each country tracks susceptible, infected, dead and (after the cure) immune people. New cases per step are `β · I · S / alive`; deaths are `μ · I`. Small counts are drawn from a Poisson distribution, so a handful of cases can stall or die out rather than growing on rails. If `μ` outruns `β` in a country the outbreak there burns out and leaves survivors.
- **Seeded randomness.** One seeded generator drives everything and is stored in the save, so a game is reproducible.
- **Detection.** Visible illness and deaths in countries with working healthcare fill a detection meter. Mild pathogens get a long head start; cure research only begins once the disease is identified.
- **Cure.** Research is funded by countries in proportion to wealth, healthcare and how much of their workforce is still on its feet. A disease nobody is dying from gets little priority; a lethal one gets wartime funding until the researchers themselves start dying.
- **Government response.** Each country closes airports, then ports, then land borders, then locks down as its visible caseload climbs. Untouched countries may seal themselves off once the world panics. A country that loses half its population collapses and stops enforcing anything.
- **Decisions.** Every month or two the game pauses and puts a two-way choice to the player (a whistleblower, a stolen sample, a ship asking to dock). Both options cost something.
- **Operations.** Four one-off actions bought with DNA, each with a cooldown and a rising cost: superspreader events, a smuggling network that reaches sealed countries, going dormant to hide symptoms, and a disinformation campaign that stalls the cure.
- **Routes.** Transmission traits are not just bigger numbers: airborne traits travel by plane, waterborne by ship, livestock and saliva over land borders, insects in the tropics, and so on. Closed routes still leak a little, more with the right traits.

---

## Features

- Interactive D3 world map of 118 countries: pan, zoom, click for per-country stats and whether the outbreak there is growing or burning out
- 46 traits across transmission, symptoms and abilities, with dependencies and devolving
- 6 pathogen types and 4 difficulties
- Infection drawn as points that spread across each country from where the pathogen entered, and turn to ash as people die
- Evolution screen laid out as trait trees, with each chain shown as a path
- Daily Outbreak: one fixed pathogen, starting country and random seed per day, with a shareable result
- End-of-run timeline of the turning points (identified, first closure, first collapse, and so on)
- A dashboard with a live epidemic curve, tappable hotspots and the effects currently in play
- Advisor warnings when the outbreak is burning out, countries seal themselves off, or DNA sits unspent
- Best winning run per pathogen type and difficulty, kept on the device
- World events, a news ticker and news stories that follow what is actually happening in the game
- Procedural soundtrack and sound effects from the Web Audio API (no audio files)
- Autosave and continue
- Epidemic curve on the end screen
- Built for phones as well as desktops: in portrait the map sits on top with the dashboard under it and the controls at the bottom, near-miss taps snap to the nearest country, the origin can be picked from a searchable list, and it can be added to the home screen

---

## How to Play

1. Pick a pathogen type and name it
2. Click a country on the map to place patient zero
3. Spend DNA on transmissions that match where you want to go next
4. Keep symptoms low while you spread; watch the detection meter
5. Once everyone is infected, evolve lethal symptoms
6. Finish before the cure hits 100%

A poor, populous, well-connected country is a good place to start. Cold and arid countries need the matching resistance.

Keyboard: `Space` pause, `1` `2` `3` speed, `E` evolution, `Esc` close.

---

## Running locally

The scripts load fine from a file, but the map data is fetched from a CDN, so use any static server:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080.

---

## Balancing

[tools/balance.js](tools/balance.js) plays full games headlessly with three scripted players (a careful planner, one that rushes lethal symptoms, and one that buys at random) and prints win rates and game lengths:

```bash
node tools/balance.js --games 30
```

```bash
node tools/balance.js --difficulty severe --type virus
```

```bash
node tools/balance.js --trace --bot planner
```

Current numbers for the planner, which also uses operations and answers decisions: roughly 75 to 100% wins on Standard depending on type (65% for Synthetic), 35% on Severe, 20% on Extinction. Rushing lethality or buying at random loses almost every time.

Tuning constants live in the `T` object at the top of `js/game.js`; per-type and per-difficulty multipliers are in `js/data.js`.

---

## Project Structure

```
├── index.html
├── css/style.css
├── js/
│   ├── data.js         # countries, pathogen types, difficulties, traits, world events
│   ├── game.js         # simulation engine (no DOM)
│   ├── map.js          # D3 world map
│   ├── ui.js           # HUD, toasts, country panel, end screen
│   ├── evolution.js    # evolution screen
│   ├── events.js       # news ticker and milestones
│   ├── news-popup.js   # news stories
│   ├── audio.js        # Web Audio music and effects
│   └── main.js         # screen flow; turns engine events into UI
└── tools/balance.js    # headless playtests
```

Libraries (from CDN): D3 7, TopoJSON, Chart.js, GSAP, and the World Atlas 110m map.

---

## License

MIT — do whatever you want with it.

---

*Built as a portfolio project.*

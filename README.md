# ☣ PATHOGEN — Global Pandemic Simulator

> *Eight billion lives. One pathogen. No mercy.*

[![Made with JavaScript](https://img.shields.io/badge/Made%20with-JavaScript-f7df1e?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![D3.js](https://img.shields.io/badge/D3.js-v7-f08030?style=flat-square&logo=d3dotjs)](https://d3js.org)
[![Web Audio API](https://img.shields.io/badge/Audio-Web%20Audio%20API-ff4444?style=flat-square)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
[![GitHub Pages](https://img.shields.io/badge/Deployed-GitHub%20Pages-24292e?style=flat-square&logo=github)](https://pages.github.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

A browser-based pandemic simulation game built entirely in vanilla JavaScript. No frameworks, no build step — just open `index.html` and play. Inspired by Plague Inc., rebuilt from scratch as a portfolio project.

**[🎮 Play Now →](https://eddyarriaga00.github.io/Pandemic-Sim/)**

---

## What It Is

You design and release a pathogen. You evolve it — choosing transmission routes, symptoms, and abilities — trying to infect and kill all 8.1 billion humans before scientists develop a cure. The world pushes back: airports close, governments mobilise, research accelerates.

The game uses a real **SIR epidemic model** under the hood, so spread actually behaves like epidemiology. Climate, wealth, travel routes, and healthcare quality all factor in.

---

## Features

- **🗺 Interactive World Map** — D3.js + TopoJSON rendering of 55 countries with real geographic data. Pan, zoom, click countries for stats.
- **🧬 34 Evolution Traits** — Transmissions, symptoms, and abilities across a real dependency tree. Spend DNA, devolve for refunds.
- **⚡ Smooth 60fps HUD** — requestAnimationFrame render loop with interpolated counters. Numbers don't jump — they count up.
- **🎵 Procedural Soundtrack** — Ambient drone music generated entirely via Web Audio API. No sound files. Haunting minor-scale melody, reverb, filtered noise.
- **📺 Live News Broadcast System** — 15+ unique news stories that evolve with your game. Every 21 days a news popup fires with a real broadcast aesthetic.
- **☣ Infection Glow Layer** — SVG filters apply a red glow to heavily infected countries. Centroid dots pulse at each epicenter.
- **📱 Mobile-First** — Safe area insets, 44px touch targets, bottom-sheet country panel, responsive at all screen sizes.
- **6 Disease Types** — Bacteria, Virus, Fungus, Parasite, Prion, Nano-Virus. Each has unique spread and mutation mechanics.
- **4 Difficulty Levels** — Casual to Mega-Brutal. Cure research speed, government response thresholds, and spread rates all scale.

---

## Screenshots

| Splash Screen | Game Map | Evolution Tree |
|---|---|---|
| *coming soon* | *coming soon* | *coming soon* |

---

## How to Play

1. **Choose your pathogen** — pick a type and name it
2. **Select an origin country** — tap any country on the map, or browse the list
3. **Stay hidden early** — low symptoms mean slower cure research
4. **Earn DNA** — it accrues as your disease spreads
5. **Evolve strategically** — Transmissions first, then Abilities, then lethal Symptoms
6. **Win** before the cure hits 100%

**Pro tip:** Start in a poor, densely populated, warm country (e.g. India, Brazil). Then buy Cold and Heat resistance before going global.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Rendering | D3.js v7 + TopoJSON |
| Geography | World Atlas (110m resolution) |
| Audio | Web Audio API (procedural) |
| Styling | CSS Custom Properties, Flexbox, CSS Grid |
| Language | Vanilla ES6 JavaScript (IIFE modules) |
| Hosting | GitHub Pages |

No npm. No webpack. No React. Just files.

---

## Project Structure

```
pathogen-pandemic-sim/
├── index.html          # single page app shell
├── css/
│   └── style.css       # all styles (~900 lines)
├── js/
│   ├── data.js         # countries, disease types, evolution tree, events
│   ├── game.js         # core simulation engine (SIR model, game loop)
│   ├── map.js          # D3 world map, SVG filters, centroid dots
│   ├── ui.js           # HUD, toasts, rAF render loop, country panel
│   ├── evolution.js    # evolution modal, trait cards, devolve logic
│   ├── events.js       # news ticker, world events, monthly milestones
│   ├── audio.js        # Web Audio procedural music + SFX
│   ├── news-popup.js   # weekly in-game news broadcast system
│   └── main.js         # wiring, screen flow, keyboard shortcuts
└── _config.yml         # GitHub Pages config
```

---

## Local Development

No server needed for most features:

```bash
# just open it
open index.html

# or if you need a local server (for any CORS issues)
npx serve .
# or
python -m http.server 8080
```

The map requires internet to fetch the world atlas GeoJSON from jsDelivr CDN. Everything else works offline.

---

## Architecture Notes

**Game Loop:** `setInterval` fires every `750ms / speed` for simulation ticks. A separate `requestAnimationFrame` loop runs at 60fps for smooth HUD rendering — the two are deliberately decoupled so the UI never janks.

**Epidemic Model:** Based on SIR (Susceptible → Infected → Recovered/Dead). New cases per tick = `healthy × infectivity × (prevalence + 0.00003)`. The small floor constant prevents early stall when infected count is tiny.

**Audio:** All sound is generated programmatically. Background music uses three layered oscillators with LFO pitch modulation, filtered white noise, and a convolution reverb for the haunting note layer. No audio files are shipped.

**Map Glow:** SVG `<feGaussianBlur>` filter applied to country `<path>` elements above a threshold. Infection intensity dots rendered at geographic centroids using D3 data joins.

---

## License

MIT — do whatever you want with it.

---

*Built as a portfolio project. Not affiliated with Ndemic Creations or Plague Inc.*

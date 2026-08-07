# Atom — Free AI Physics Tutor

Static frontend for Atom, a free browser-based AI physics tutor. Pure HTML/CSS/JS — no build step, ships straight to GitHub Pages.

## Structure

All URLs are clean and extensionless. Every page except the landing page lives
in its own folder as `index.html`, so the browser shows `/about/`, never
`/about.html`. Old `.html` links are rescued by a small redirect script in
`404.html`.

```
Website/
├── index.html         # Landing page (hero, tiers, rocket sim, CTA)  ->  /
├── chat/index.html    # Chat interface + tier picker                 ->  /chat/
├── about/index.html   # Founders + tier comparison (#compare)         ->  /about/
├── 404.html           # Not-found page; also redirects legacy *.html URLs
├── css/style.css      # All styles — liquid glass, light/dark themes, responsive
├── js/
│   ├── background.js  # WebGL animated background (Velaris-style, atom palette)
│   ├── main.js        # Theme toggle, mobile menu, tier data + card rendering
│   ├── simulations.js # 4 physics interactives: uncertainty, pendulum, double-slit, orbit
│   └── chat.js        # Chat UI + Hugging Face API (Phi-3-mini), 4 tier system prompts
├── assets/            # Processed logos + favicons (transparent, light + dark variants)
└── Media/             # Original logo source PNGs
```

## Before you deploy, 1 thing to fill in

Open **`js/chat.js`** and replace the placeholder token:

```js
const HF_TOKEN = "hf_your_token_here";   // put your Hugging Face token here
```

Get a fresh token at https://huggingface.co/settings/tokens (read access is fine).
The previous token was revoked, so a new one is required. Requests go to the
current HF router endpoint (`https://router.huggingface.co/v1/chat/completions`).

Until a valid token is set, the chat shows a friendly setup message instead of
calling the API. Chats and history still save to localStorage regardless.

## Chat page

GPT-style layout: a left sidebar with a New Chat button and full conversation
history (persisted to `localStorage`, click to reopen, hover to delete), and a
roomy message column with a tier picker in the top bar. No simulation panel.

## Physics visuals

There is exactly one, by design: a live free-body-diagram pendulum in the hero of
the landing page (`js/hero-pendulum.js`). It integrates the real equation of motion
and redraws the force vectors every frame: tension T, weight mg, the mg sin(theta)
and mg cos(theta) components with parallelogram guides, the velocity vector v, the
theta angle arc, and a readout of the period. Non-interactive, always in motion.

## Theme

Dark only. Light mode was removed by design.

## Tier system prompts

All four tier prompts (Archimedes, Newton, Heisenberg, Einstein) are already written in `js/chat.js` — the other three tiers show "Coming Soon" in the UI, but flipping `available: true` in `js/main.js` turns them on instantly.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo
2. Settings → Pages → deploy from `main` branch, `/Website` folder (or move contents to repo root)
3. Wait ~1 minute — done

## Local preview

```bash
cd Website
python3 -m http.server 8000
# open http://localhost:8000
```

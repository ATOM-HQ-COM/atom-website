# Atom API proxy (Cloudflare Worker)

Why this exists: any API key committed to a public repo gets detected and
auto-revoked. So the frontend never holds a key. Instead, it calls this tiny
Worker, and the Worker holds the provider keys as encrypted Cloudflare
secrets and adds the Authorization header server-side.

The Worker routes to different providers based on the requested model:

```
browser -> atom-proxy.workers.dev/api/chat
              |
              +--> Groq API (Archimedes / Newton / Heisenberg / viz / video)
              +--> OpenRouter API (Einstein via DeepSeek R1)
```

Both providers are used because each is best at what it does:

- **Groq's free tier** is fast (~500 tps) and generous (1K req/day per model),
  ideal for the tutors students hit most often.
- **OpenRouter's free tier** unlocks bigger reasoning models that Groq no
  longer offers, including `deepseek/deepseek-r1:free` (671B, o1-class).
  Its cap is tighter (20 rpm / 50 rpd shared across free models) so it is
  reserved for Einstein, and if it errors the frontend silently falls back
  to `gpt-oss-120b` on Groq.

## One-shot setup

```bash
cd cloudflare-worker
chmod +x setup.sh
./setup.sh
```

The script uses `npx wrangler` (no global install needed), logs you in to
Cloudflare, prompts you to paste both API keys (stored encrypted, never
written to disk), deploys, and prints your URL.

## Manual steps (if you prefer)

```bash
cd cloudflare-worker
npx wrangler login
npx wrangler secret put GROQ_API_KEY          # from https://console.groq.com/keys
npx wrangler secret put OPENROUTER_API_KEY    # from https://openrouter.ai/keys
npx wrangler deploy
```

## Wire up the frontend

After deploy, copy the printed URL and set it in `js/chat.js`:

```js
const API_URL = "https://atom-proxy.<your-subdomain>.workers.dev/api/chat";
```

## Which model each tier uses

Set in `TIER_MODELS` at the top of `js/chat.js`. All are on the free tier:

| Tier       | Model                          | Provider   | For                       |
| ---------- | ------------------------------ | ---------- | ------------------------- |
| Archimedes | llama-3.1-8b-instant           | Groq       | Elementary/middle, fast   |
| Newton     | llama-3.3-70b-versatile        | Groq       | AP / IB / A-Level         |
| Heisenberg | openai/gpt-oss-120b            | Groq       | Undergraduate             |
| Einstein   | deepseek/deepseek-r1:free      | OpenRouter | Graduate / research       |

Einstein has an automatic fallback to `openai/gpt-oss-120b` on Groq if the
OpenRouter call fails, so students never see a hard error from the free tier.

## Rotating a key

Run `npx wrangler secret put GROQ_API_KEY` (or `OPENROUTER_API_KEY`) again
and paste the new one. No code change, no redeploy needed.

## Hardening

`worker.js` allows localhost and any `*.github.io` origin by default. Once
your site is live, add your exact origin to `ALLOWED_ORIGINS` and redeploy.

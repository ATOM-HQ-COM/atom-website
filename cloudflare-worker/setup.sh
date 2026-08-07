#!/usr/bin/env bash
# ========================================================================
# Atom proxy, one-shot Cloudflare Worker setup.
# Creates the project, logs you in, stores the Groq AND OpenRouter API keys
# as SECRETS (never in code, never in git), deploys, and prints your URL.
#
# Usage:
#   cd cloudflare-worker
#   chmod +x setup.sh
#   ./setup.sh
# ========================================================================
set -e

echo "== Atom proxy setup =="

# Use npx to avoid global install permission issues
WRANGLER="npx wrangler"

# 1. Log in (opens the browser; free Cloudflare account is fine)
echo "-> Logging in to Cloudflare (a browser window will open)..."
$WRANGLER login

# 2. Groq API key (runs Archimedes / Newton / Heisenberg + visualizer + video)
echo ""
echo "-> Get a free Groq key at: https://console.groq.com/keys"
echo "   Paste it below. It is stored encrypted on Cloudflare, never in any file."
$WRANGLER secret put GROQ_API_KEY

# 3. OpenRouter API key (runs Einstein via DeepSeek R1)
echo ""
echo "-> Get a free OpenRouter key at: https://openrouter.ai/keys"
echo "   Paste it below. It is stored encrypted on Cloudflare, never in any file."
$WRANGLER secret put OPENROUTER_API_KEY

# 4. Deploy
echo "-> Deploying worker..."
$WRANGLER deploy

echo ""
echo "== Done =="
echo "Your worker URL is shown above (https://atom-proxy.<your-subdomain>.workers.dev)."
echo "Final step: open js/chat.js and set:"
echo '  const API_URL = "https://atom-proxy.<your-subdomain>.workers.dev/api/chat";'
echo ""
echo "Optional hardening: add your GitHub Pages origin to ALLOWED_ORIGINS in worker.js"
echo "and redeploy with: npx wrangler deploy"

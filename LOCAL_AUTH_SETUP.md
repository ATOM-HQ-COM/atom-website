# Atom Local Auth Setup

This setup keeps the signup/login database on your computer. The public chat page calls your local auth gateway first, and that gateway forwards AI requests to the existing Atom Cloudflare Worker.

## What This Adds

- Guests get 3 tutor responses before signup is required.
- User emails are encrypted with AES-256-GCM in `local-auth-server/data/atom-auth.sqlite`.
- Email lookup uses an HMAC, so the server can find an account without storing plaintext email.
- Passwords are stored as Argon2id hashes. They are not stored as plaintext and are not reversibly encrypted.
- The admin portal has a `New Users` metric pulled from the local auth server with `ATOM_AUTH_ADMIN_TOKEN`.

## Local Test

1. Install dependencies.

```bash
npm install
```

2. Generate local auth secrets.

```bash
npm run auth:init
```

This creates `local-auth-server/.env` with file mode `600`, so only your macOS user can read it.

3. Start the local auth gateway.

```bash
npm run auth:dev
```

4. In another terminal, serve the website locally.

```bash
cd /Users/rahul/Projects/atom-website-main
npm run site:dev
```

5. Open the chat page.

```text
http://127.0.0.1:8000/chat/
```

6. Send 3 physics questions as a guest. The 4th tutor turn should ask for signup/sign-in.

7. Check the local user metric from your computer.

```bash
npm run auth:metrics
```

## Make It Live From Your Computer

These steps assume the public auth API will live at `https://auth.atom-hq.com`, which is the default already used by `js/chat.js` on the live site.

1. Make sure your Mac can stay awake.

```bash
sudo pmset -a sleep 0
```

2. Switch the auth server to production cookie/origin settings.

```bash
cd /Users/rahul/Projects/atom-website-main
npm run auth:mode:prod
```

Lock down the local files after any manual edits:

```bash
cd /Users/rahul/Projects/atom-website-main
chmod 600 local-auth-server/.env local-auth-server/data/atom-auth.sqlite*
chmod 700 local-auth-server/data
```

3. Point DNS for `auth.atom-hq.com` at your home public IP address.

Create an `A` record:

```text
auth.atom-hq.com -> your-home-public-ip
```

If your home IP changes, update this record whenever it changes, or use a dynamic DNS updater.

4. Forward router ports to your Mac.

Forward:

```text
TCP 80  -> your Mac
TCP 443 -> your Mac
```

5. Install Caddy on your Mac for HTTPS.

```bash
brew install caddy
```

6. Create a Caddyfile.

You can use `local-auth-server/Caddyfile.example`:

```caddy
auth.atom-hq.com {
  reverse_proxy 127.0.0.1:8789
}
```

7. Run Caddy.

From the repo root:

```bash
cd /Users/rahul/Projects/atom-website-main
npm run public:start
```

8. Test the live gateway.

```bash
curl https://auth.atom-hq.com/health
```

You should see JSON with `ok: true`.

9. Open the live Atom chat and test the flow.

```text
https://atom-hq.com/chat/
```

Send 3 tutor questions as a guest, then confirm signup is required.

## Public Commands

Run every command from the repo:

```bash
cd /Users/rahul/Projects/atom-website-main
```

Start public auth and HTTPS:

```bash
npm run public:start
```

Check what is running:

```bash
npm run public:status
```

Turn public signup/login off:

```bash
npm run public:stop
```

Turn local HTTP testing mode back on:

```bash
npm run auth:mode:local
```

Install an optional login item for the Node auth server:

```bash
npm run public:install-login
```

Remove the optional login item:

```bash
npm run public:uninstall-login
```

The login item restarts the Node auth gateway after you log into the Mac. After a full reboot, you may still need to run `npm run public:start` once so Caddy can restart public HTTPS.

## Admin New Users Metric

1. Open the Atom admin portal and sign in normally.
2. Press `\` once to unlock local auth users on that browser.
3. When prompted for `ATOM_AUTH_ADMIN_TOKEN`, paste the token from `local-auth-server/.env`.
4. The `New Users` card will show the local total and the last-7-days count without re-prompting on each refresh.
5. After local unlock, use your private edit shortcut to enter admin edit mode and change the displayed `New Users` total without touching the real user emails or password hashes.

The hidden edit helper now lives only in `local-auth-server/private-admin-tools.js` on your Mac, and that file is gitignored so it does not get pushed with the repo.

`npm run auth:metrics` still works and now reports the saved displayed total. The old `npm run auth:users` command has been removed.

## Backups

Back up these together:

```text
local-auth-server/.env
local-auth-server/data/atom-auth.sqlite
```

If you lose `.env`, encrypted emails cannot be decrypted. Passwords cannot be recovered either way; users would need password reset support added later.

## Cloudflare

This auth database is not hosted on Cloudflare. The only Cloudflare part still involved is the existing Atom AI Worker, which receives AI prompts from your local gateway and forwards them to the model provider.

You do not need `npx wrangler deploy` for the local auth feature itself. Use `npx wrangler deploy` only when changing `cloudflare-worker/worker.js`.

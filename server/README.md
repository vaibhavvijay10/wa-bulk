# WA Bulk — self-hosted WhatsApp bulk sender

A small web app you run on a laptop or your own VPS. Your team logs in from a browser, uploads an Excel/CSV of contacts, writes a message with merge fields, and the server sends it from your linked WhatsApp number with human-like pacing. Replaces the paid "WA Sender"-style Chrome extensions. (If you only need a one-person tool, use the Chrome extension in `../extension` instead — no server at all.)

**What it does**

- Team logins with two roles (admin / sender), each campaign shows who created it
- Link one WhatsApp number by scanning a QR (runs as a *linked device*; the phone does not need to stay online)
- Upload `.xlsx` / `.xls` / `.csv` — pick the phone column, every other column becomes a merge field
- Sends to numbers that are not saved in the phone
- Message templates: `{{name}}`, fallbacks `{{name|there}}`, and spintax `{{Hi|Hello|Hey}}` so messages aren't identical
- Attachments (image, PDF, video…) with the message as caption
- Live preview of the first three contacts before you send
- Pacing: random delay between messages, pause after every batch, a global daily cap, optional send window (e.g. 10:00–20:00)
- Start now, schedule for later, or save as draft; pause / resume / cancel any time; retry failed
- Automatic skipping of duplicates, invalid numbers, numbers not on WhatsApp, and opted-out contacts
- Opt-out list: manual add, Excel import, CSV export, and automatic add when someone replies STOP (keywords configurable, optional auto-reply)
- Inbox: see replies to the linked number and answer from the tool
- Downloadable per-campaign report (sent / failed / skipped with reasons and the exact text sent)

**How it talks to WhatsApp:** it starts a hidden Chrome/Edge (the one already installed) on WhatsApp Web and drives it with [wa-js](https://github.com/wppconnect-team/wa-js). No Chromium download, no native modules: the database is Node's built-in SQLite. Needs Node 22.13+ (Node 24 recommended).

## 0. Windows laptop — double-click and go

1. Unzip, open the `server` folder, double-click **`Start-WA-Bulk.bat`**.
   First run: it finds Node (or downloads a portable copy), installs packages, finds Chrome/Edge, writes `.env` with login `admin / admin1234`, starts on http://localhost:3000 and opens the browser.
2. Sign in, go to **WhatsApp → Connect**, and on the phone open WhatsApp → *Linked devices* → *Link a device* and scan the QR (it appears within ~15 s).
3. **Campaigns → New campaign**, upload the sheet, write the message, start.

Keep the black window open while it runs (close it to stop). Everything is stored in the `data` folder next to it (database, WhatsApp session, uploads) — back that folder up. Change the admin password under **Team** after the first login.

## 1. Deploy on the VPS (Ubuntu/Debian, root SSH)

```bash
# on the VPS
apt-get update && apt-get install -y unzip
unzip wa-bulk.zip && cd wa-bulk
sudo bash install.sh          # installs Docker if needed and creates .env with a random admin password
nano .env                     # set DOMAIN=wa.yourcompany.com  (A record -> VPS IP), or DOMAIN=http://YOUR.VPS.IP
sudo bash install.sh          # builds and starts
```

Open `https://wa.yourcompany.com` (or `http://YOUR.VPS.IP`), sign in with the admin password printed by the installer, go to **WhatsApp → Connect**, and on the phone open WhatsApp → *Linked devices* → *Link a device* and scan the QR. That's it — the session is saved under `./data/` and survives restarts.

Ports 80/443 must be open in the VPS firewall. Caddy fetches the HTTPS certificate automatically when a domain is set.

**Everyday commands** (inside the `wa-bulk` folder):

```bash
docker compose logs -f wa-bulk      # live logs
docker compose restart wa-bulk      # restart the app
docker compose up -d --build        # rebuild after changing code
docker compose down                 # stop
```

**Backup:** the `data/` folder holds everything (SQLite database, WhatsApp session, uploads). Copy it somewhere regularly.

### Without Docker (alternative)

```bash
apt-get install -y chromium                 # plus Node 22.13+ / 24 from https://github.com/nodesource/distributions
cd wa-bulk && PUPPETEER_SKIP_DOWNLOAD=1 npm install --omit=dev
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium ADMIN_PASSWORD=secret PORT=3000 node --no-warnings src/server.js
```
Put it behind nginx/Caddy for HTTPS and run it with `pm2` or a systemd unit so it restarts on reboot.

### Try it on a laptop first (no WhatsApp needed)

```bash
npm install
WA_MOCK=1 ADMIN_PASSWORD=test1234 node --no-warnings src/server.js    # http://localhost:3000, login admin / test1234
```
(On Windows: set `WA_MOCK=1` in `.env` and run `Start-WA-Bulk.bat`.)
Mock mode fakes the WhatsApp connection: sends "succeed" instantly, numbers ending in `0000` count as "not on WhatsApp", and the Inbox page has a box to simulate incoming replies (type STOP to see the auto opt-out).

## 2. Using it

1. **Campaigns → New campaign**, upload the sheet. Row 1 must be headers. Example:

   | phone | name | brand | bonus |
   |---|---|---|---|
   | 919876543210 | Rahul | Lucky7even | 50 free spins |
   | +44 7700 900123 | Emma | Rooster.bet | €20 |

   Numbers may contain `+`, spaces or dashes. Numbers with no country code get the default from Settings (91 by default).
2. Pick the phone column, write the message (click a chip to insert a field), optionally attach a file, set the pace, choose *Start now* / *Schedule* / *Draft*.
3. Watch progress on the campaign page; download the report when it's done. The same list can be re-uploaded later — anything already opted out is skipped.

**Roles:** *sender* can create/run campaigns, use the inbox and opt-outs. *admin* can also link/unlink the WhatsApp number, manage the team, and change settings. Create users under **Team**.

## 3. Keeping the number safe (read this)

This uses WhatsApp Web automation, exactly like the extension you were paying for. WhatsApp does not officially allow it, and a number that behaves like a spammer gets banned — first temporarily, then permanently. The vendor's "anti-ban" features are the same throttles you now control yourself:

- **Warm up a new number.** Use it manually for a week (chats, groups, a profile photo, business description). Start campaigns at a daily cap of 50–100 and raise it by ~50 every few days. Keep the default 20–60 s delays and batch pauses.
- **Stay under a few hundred a day per number.** If you need more, add a second number on a second VPS/container rather than pushing one number harder.
- **Message people who know you.** Contacts who have your number saved or have messaged you before almost never report you. Cold lists are what get numbers banned — and reports are what WhatsApp acts on, more than volume.
- **Vary the text.** Use spintax and merge fields so no two messages are identical; avoid a bare link as the whole message.
- **Honour opt-outs instantly.** Keep the STOP keyword handling on; a user who can't stop you will report you instead.
- **Never put a number you can't afford to lose on this.** Use a dedicated business number, not the brand's main support line.
- **Check consent.** For European players, bulk promotional WhatsApp needs a marketing opt-in on record (GDPR / ePrivacy). Keep a "consented" column in your sheets and filter on it before uploading.

If WhatsApp logs the device out, **WhatsApp → Connect** and re-scan. To watch the hidden browser (debugging), set `WA_HEADFUL=1` in `.env`. If the number is banned, the app will show *disconnected* with an auth error; the campaign pauses automatically and resumes when a number is linked again.

## 4. Settings reference

| Setting | Meaning |
|---|---|
| Daily cap | Max messages per calendar day (in the configured timezone) across all campaigns. 0 = unlimited. |
| Default country code | Prefixed to numbers that don't have one. |
| Verify numbers | Ask WhatsApp whether each number exists before sending (recommended; dead numbers become "failed: not on WhatsApp" instead of erroring). |
| Opt-out keywords | If a reply starts with one of these, the sender is added to the opt-out list. |
| Auto-reply to opt-outs | Optional confirmation message. |
| Timezone | For the daily cap reset and campaign send windows. |

## 5. Layout

```
src/server.js          Express app, routes, worker start
src/lib/db.js          SQLite schema, settings, daily counter
src/lib/sqlite.js      tiny adapter over Node's built-in node:sqlite
src/lib/wa.js          headless Chrome + wa-js wrapper (+ mock mode), QR, incoming message + opt-out handling
src/lib/worker.js      Sending loop: scheduling, delays, batches, cap, send window
src/lib/template.js    {{field}} / {{a|b}} rendering
src/lib/phone.js       Number normalisation
src/routes/*.js        Pages: auth, dashboard, whatsapp, campaigns, inbox, optouts, users, settings
src/views/*.ejs        Server-rendered HTML;  public/  CSS + small JS (live preview, polling)
Dockerfile, docker-compose.yml, Caddyfile, install.sh (VPS)   Start-WA-Bulk.bat (Windows)
```

Ideas for later: multiple numbers with rotation, per-brand sender numbers, a REST endpoint so campaigns can be triggered from your CRM, and a pluggable sender for the official WhatsApp Cloud API for non-gambling brands.

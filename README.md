# WA Bulk — two ways to send bulk WhatsApp messages

| | **Chrome extension** (`extension/`) | **Self-hosted server** (`server/`) |
|---|---|---|
| Best for | One person, their own laptop and WhatsApp | A team sharing one sender number 24×7 on a VPS |
| Install | Unzip, `chrome://extensions` → Load unpacked | Double-click `Start-WA-Bulk.bat` (Windows) or Docker on a VPS |
| Connect | Log in to WhatsApp Web as usual (QR) | Scan the QR shown in the web app |
| Contacts | Paste numbers/names, Excel/CSV, or your saved contacts | Excel/CSV upload |
| Extras | Test-send to yourself, unsubscribe list, report CSV | Team logins, scheduling, send windows, inbox, opt-outs, reports |
| Needs | Chrome / Edge / Brave | Node 22+ (auto-downloaded) + Chrome/Edge; or Docker |

Both send to numbers that are **not saved in the phone**, personalise every message with `{{name}}` style merge fields, rotate wording with `{{Hi|Hello|Hey}}`, verify a number is on WhatsApp before sending, pace messages with random delays and batch pauses, and produce a sent/failed/skipped report.

Both are built on the same WhatsApp Web API layer ([wa-js](https://github.com/wppconnect-team/wa-js) 4.6.0), which was verified against WhatsApp Web 2.3000.1047 on 11 Sep 2026.

- Extension guide: [extension/README.md](extension/README.md)
- Server guide: [server/README.md](server/README.md)

## What changed from the original `wa-bulk.zip`

The original app could not be installed on this Windows machine and could not connect to WhatsApp:

1. `better-sqlite3` needs a C++ compiler (Visual Studio) to install on Node 22+. Replaced with Node's built-in `node:sqlite` via a 30-line adapter (`server/src/lib/sqlite.js`). No compiler, no `npm rebuild`.
2. `whatsapp-web.js` 1.34 crashed on today's WhatsApp Web ("Execution context was destroyed", then an unhandled ProtocolError that killed the process). Replaced with puppeteer-core driving the Chrome already on the machine plus wa-js (`server/src/lib/wa.js`); a QR now appears within about 15 seconds.
3. Added `Start-WA-Bulk.bat` for Windows: finds or downloads Node, installs packages, finds Chrome/Edge, writes `.env`, starts the server and opens the browser.
4. New Chrome extension for the "as easy as an extension" workflow the reference product (WA Sender) offers, with paste-a-list support in addition to Excel.

## Tests

```
cd extension
node test/lib.test.js      # 10 unit tests: phone parsing, merge fields, pasted lists, CSV
node test/e2e.js           # loads the extension in headless Chrome on the live WhatsApp Web page,
                           # fakes the send functions, runs a 5-contact campaign end to end
```
The server was exercised in mock mode (login → upload sample sheet → campaign → report → STOP auto opt-out) and in real mode up to the QR screen. Actually delivering a message requires a phone to scan the QR, which was not done in this session.

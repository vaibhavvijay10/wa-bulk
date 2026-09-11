# WA Bulk Sender — Chrome extension

Send personalised WhatsApp messages to a pasted list of numbers or an Excel sheet, straight from WhatsApp Web. Numbers do **not** need to be saved in your phone. No server, no Docker, no command line: install once, open WhatsApp Web, click **WA Bulk**.

## Install (2 minutes)

1. Download `wa-bulk-extension.zip` and unzip it somewhere permanent (for example `Documents\wa-bulk-extension`). Chrome loads the extension from this folder, so don't delete it later.
2. In Chrome open `chrome://extensions`.
3. Turn on **Developer mode** (switch at the top right).
4. Click **Load unpacked** and pick the unzipped `extension` folder (the one that contains `manifest.json`).
5. Pin the extension (puzzle icon → pin) so the green **WA** icon shows in the toolbar.

Works the same way in Microsoft Edge (`edge://extensions`) and Brave.

## Use

1. Click the green **WA** icon (or open https://web.whatsapp.com). If the phone is not linked yet, scan the QR code with WhatsApp on the phone (**Linked devices → Link a device**). The panel header turns green and shows the connected number.
2. Click the **WA Bulk** button at the bottom left. The panel opens on the right.
3. **Contacts** – choose one:
   - **Paste list**: one number per line. Names are optional. All of these work:
     ```
     9876543210
     +44 7700 900123, Emma
     Rahul: 98765 43210
     9123456789 Priya
     ```
     You can also copy whole columns from Excel or Google Sheets (with the header row) and paste them.
   - **Excel / CSV**: pick a `.xlsx`, `.xls` or `.csv`. Row 1 must be the headers. Choose the phone column; every other column becomes a merge field.
   - **My WhatsApp contacts**: loads everyone saved on this WhatsApp account, and can export them as CSV.

   Numbers without a country code get the **default country code** (91 = India). Invalid numbers, duplicates and unsubscribed numbers are skipped automatically and listed in the report.
4. **Message** – type the text. Click a chip such as `{{name}}` to insert a column. `{{name|there}}` uses "there" when the cell is empty; `{{Hi|Hello|Hey}}` picks one word at random per message so no two messages are identical. Optionally attach an image, PDF, video or document; the text becomes its caption. The preview shows the exact message for the first contact. **Send a test to my own number** delivers it to yourself first.
5. **Sending speed** – random wait between min and max seconds before every message, plus a longer pause after every batch, and a daily limit. The defaults (10–25 s, pause 2 min every 25, 300/day) are deliberately cautious.
6. **Send** – click **Start sending** and keep the tab open. The tiles show sent / delivered / read / replied / failed / skipped; delivered and read follow WhatsApp's ticks and update live, replied counts any message from that person after yours (also picked up later with **Refresh delivery & replies**). You can pause, resume or stop at any time. When it finishes, **Download report (CSV)** gives you sent / failed / skipped with the reason and the exact text sent. **Retry failed** re-queues the failures.

The **Unsubscribe list** holds numbers that must never be messaged. When someone replies STOP (keywords are configurable) while WhatsApp Web is open, they are added automatically.

If a run is interrupted (the page reloads, the laptop sleeps), reopen the panel and click **Resume it**.

## Keeping your number safe

This automates WhatsApp Web, exactly like the paid "WA Sender"-style extensions. WhatsApp does not officially allow it and a number that behaves like a spammer gets banned, first temporarily then permanently. The extension's throttles are the same "anti-ban" features those tools sell:

- Warm up a new number: use it normally for a week. Start at 50–100 messages a day and raise it slowly.
- Stay under a few hundred a day per number. Keep the delays; never set them to 1–2 seconds for a big list.
- Personalise with `{{name}}` and rotate wording with `{{a|b|c}}`. Avoid sending a bare link as the whole message.
- Message people who know you or have opted in. Reports from strangers are what get numbers banned.
- Honour STOP replies. Someone who cannot stop you will report you instead.
- Do not use a number you cannot afford to lose.

## Updating

The panel shows a banner when a newer release exists on GitHub. Download the new zip, unzip it over the same folder, then click the refresh icon on the extension card in `chrome://extensions`. (Installs from the Chrome Web Store update by themselves.)

## Files

```
manifest.json          Manifest V3
background.js          toolbar icon -> opens/focuses WhatsApp Web
page/bridge.js         runs inside WhatsApp Web (MAIN world); the only code that talks to wa-js
content/lib.js         phone normalisation, {{merge}} rendering, paste/Excel parsing, CSV
content/panel.js       the side panel UI and the sending loop (isolated world, Shadow DOM)
vendor/wppconnect-wa.js  wa-js 4.6.0 (Apache-2.0) — the WhatsApp Web API layer
vendor/xlsx.full.min.js  SheetJS 0.18.5 (Apache-2.0) — reads Excel/CSV in the browser
test/lib.test.js       unit tests:  node test/lib.test.js
test/e2e.js            headless-Chrome test on the live WhatsApp Web page with fake sends
```

Nothing leaves your browser: contacts, messages and reports stay in Chrome's local extension storage on your machine.

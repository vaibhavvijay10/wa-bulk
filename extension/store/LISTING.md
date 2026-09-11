# Chrome Web Store listing — copy/paste values

## Publish steps

1. Go to https://chrome.google.com/webstore/devconsole and sign in with the Google account that should own the extension. Pay the one-time USD 5 registration fee (card). Accept the developer agreement.
2. Click **New item** and upload `wa-bulk-extension-store.zip` (built by `build-store-zip.bat` / see README).
3. Fill in the fields below, upload the images from this folder, then **Submit for review**. Review normally takes 1–3 working days; you get an email either way.
4. Once approved, the store page link is what you share. Users click **Add to Chrome**; no Developer mode needed.

## Store listing fields

**Name:** WA Bulk Sender

**Summary (132 chars max):**
Bulk WhatsApp messages from WhatsApp Web: paste numbers or upload Excel, personalise with {{name}}, safe pacing, reports.

**Category:** Productivity → Communication

**Language:** English

**Description:**
Send personalised WhatsApp messages to a list of people straight from WhatsApp Web. Numbers do not need to be saved in your phone.

HOW IT WORKS
1. Open web.whatsapp.com and log in as usual.
2. Click the green "WA Bulk" button at the bottom left.
3. Paste numbers (with or without names), upload an Excel/CSV, or load your saved contacts.
4. Write your message. Use {{name}} to personalise it and {{Hi|Hello|Hey}} to vary the wording.
5. Click Start. Watch the progress, then download the report.

FEATURES
• Paste a list or upload .xlsx / .xls / .csv — every column becomes a merge field
• Sends to numbers that are not saved in your contacts
• Attachments: image, PDF, video or document with the text as caption
• Live preview and "send a test to my own number" before you start
• Random delays, batch pauses and a daily limit to keep your number safe
• Checks each number is on WhatsApp before sending
• Skips duplicates and invalid numbers automatically
• Unsubscribe list, with automatic STOP handling
• Pause, resume, stop, retry failed, resume after a reload
• Sent / failed / skipped report as CSV
• Everything stays in your browser: no account, no server, no data collection

Only message people who know you or have opted in. Bulk automation is not officially supported by WhatsApp; the built-in pacing helps, but sending spam can get a number blocked.

**Privacy policy URL:**
https://github.com/vaibhavvijay10/wa-bulk/blob/master/extension/PRIVACY.md

**Homepage / support URL:**
https://github.com/vaibhavvijay10/wa-bulk

## Privacy tab answers

- Single purpose: "Send personalised bulk messages from the user's own WhatsApp Web session to a list the user provides."
- Permission justifications:
  - `storage`: keeps the user's settings, contact list, unsubscribe list and last report on the device.
  - Host permission `https://web.whatsapp.com/*`: injects the panel into WhatsApp Web and sends messages through the user's open session; the extension does nothing on other sites.
- Remote code: **No** (all scripts are bundled in the package).
- Data usage: tick "Personally identifiable information" and "Website content" as *handled*; state they are not sold, not used for unrelated purposes, not transferred. Certify all three disclosures.

## Images

- `screenshot-1-1280x800.png` — screenshot (add 1–4 more of the Excel tab, a finished run and the report if you like; 1280×800 or 640×400)
- `promo-tile-440x280.png` — small promo tile (optional but recommended)
- Icon comes from the package (`icons/icon128.png`)

## Risk to know about

Google's policies do not forbid WhatsApp tools (WA Sender and similar are listed), but reviewers occasionally reject "automation of third-party services". If that happens, reply in the dashboard explaining it acts only inside the user's own logged-in session, on the user's own list, with rate limiting and opt-out handling, and resubmit.

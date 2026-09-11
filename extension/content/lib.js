// Pure helpers shared by the panel and the tests (no DOM, no chrome.*).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WABLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // ---- phone numbers -------------------------------------------------------
  // "+91 98765-43210" -> "919876543210". Numbers without a country code
  // (<= 10 digits, or starting with 0) get the default code.
  function normalizePhone(raw, defaultCC) {
    if (raw === null || raw === undefined) return null;
    let s = String(raw).trim();
    if (!s) return null;
    if (/^[\d.]+e[+-]?\d+$/i.test(s)) { const n = Number(s); if (!Number.isNaN(n)) s = n.toLocaleString('fullwide', { useGrouping: false }); }
    let digits = s.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('00')) digits = digits.slice(2);
    const hadPlus = s.startsWith('+');
    if (!hadPlus) {
      if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
      if (digits.length <= 10) digits = String(defaultCC || '').replace(/\D/g, '') + digits;
    }
    if (digits.length < 8 || digits.length > 15) return null;
    return digits;
  }

  // ---- templates -----------------------------------------------------------
  //   {{name}}           merge field (case-insensitive column name)
  //   {{name|there}}     merge field with fallback when the cell is empty
  //   {{Hi|Hello|Hey}}   spintax: one option chosen at random
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function splitTopLevel(s) {
    const parts = []; let depth = 0, cur = '';
    for (let i = 0; i < s.length; i++) {
      const two = s.slice(i, i + 2);
      if (two === '{{') { depth++; cur += two; i++; continue; }
      if (two === '}}') { depth--; cur += two; i++; continue; }
      if (s[i] === '|' && depth === 0) { parts.push(cur); cur = ''; continue; }
      cur += s[i];
    }
    parts.push(cur);
    return parts;
  }
  function render(template, row) {
    const lookup = {};
    for (const [k, v] of Object.entries(row || {})) lookup[String(k).trim().toLowerCase()] = v;
    let out = String(template || '');
    const re = /\{\{([^{}]*)\}\}/;
    let guard = 0;
    while (re.test(out) && guard++ < 500) {
      out = out.replace(re, (_, inner) => {
        const parts = splitTopLevel(inner).map((p) => p.trim());
        const key = parts[0].toLowerCase();
        if (key in lookup) {
          const val = lookup[key];
          const empty = val === null || val === undefined || String(val).trim() === '';
          if (!empty) return String(val);
          return parts.length > 1 ? parts[1] : '';
        }
        if (parts.length === 1) return '';
        return pick(parts);
      });
    }
    return out;
  }
  function fields(template) {
    const found = new Set();
    const re = /\{\{([^{}]*)\}\}/g; let m;
    while ((m = re.exec(template || ''))) {
      const parts = splitTopLevel(m[1]); const first = parts[0].trim();
      if (parts.length === 1 && first) found.add(first);
    }
    return [...found];
  }

  // ---- pasted lists --------------------------------------------------------
  // Accepts anything people paste: one number per line, "number, name",
  // "number<TAB>name" (copied from Excel), "name: number", "number name",
  // numbers separated by commas, or several columns copied from a sheet
  // (the first line may be a header). Returns { columns, rows, phoneColumn }.
  function looksPhone(s, defaultCC) {
    const str = String(s || '');
    return /\d{7,}/.test(str.replace(/[\s\-().+]/g, '')) && normalizePhone(str, defaultCC) !== null;
  }
  function splitLine(l, cc) {
    if (l.includes('\t')) return [l.split('\t').map((c) => c.trim())];
    const parts = l.split(/[;,]/).map((c) => c.trim()).filter((c) => c !== '');
    if (parts.length > 1 && parts.every((p) => looksPhone(p, cc))) return parts.map((p) => [p]); // "a, b, c" -> all numbers
    if (parts.length > 1) return [parts];
    const m = /^(.*?)\s*[:\-]\s*(\+?[\d\s\-()]{7,})$/.exec(l);        // "Rahul: 98765 43210"
    if (m && looksPhone(m[2], cc) && !looksPhone(m[1], cc)) return [[m[2].trim(), m[1].trim()]];
    const m2 = /^(\+?[\d\s\-()]{7,}?)\s+([^\d\s].*)$/.exec(l);         // "98765 43210 Rahul"
    if (m2 && looksPhone(m2[1], cc)) return [[m2[1].trim(), m2[2].trim()]];
    return [[l]];
  }
  function parsePaste(text, defaultCC) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return { columns: ['phone'], rows: [], phoneColumn: 'phone' };
    let table = [];
    for (const l of lines) for (const r of splitLine(l, defaultCC)) table.push(r);
    let columns = null;
    if (table.length > 1 && !table[0].some((c) => looksPhone(c, defaultCC)) && table[1].some((c) => looksPhone(c, defaultCC))) {
      columns = table[0].map((c, i) => c || 'col' + (i + 1));
      table = table.slice(1);
    }
    const width = Math.max(...table.map((r) => r.length));
    if (!columns) {
      let best = 0, bestScore = -1;
      for (let i = 0; i < width; i++) {
        const score = table.filter((r) => looksPhone(r[i] || '', defaultCC)).length;
        if (score > bestScore) { bestScore = score; best = i; }
      }
      columns = [];
      const nameIdx = best === 0 ? 1 : 0;
      for (let i = 0; i < width; i++) columns.push(i === best ? 'phone' : (i === nameIdx ? 'name' : 'col' + (i + 1)));
    }
    const rows = table.map((r) => { const o = {}; columns.forEach((c, i) => { o[c] = r[i] === undefined ? '' : r[i]; }); return o; });
    const phoneColumn = guessPhoneColumn(columns, rows, defaultCC);
    return { columns, rows, phoneColumn };
  }

  function guessPhoneColumn(columns, rows, defaultCC) {
    const pri = ['phone', 'mobile', 'whatsapp', 'number', 'contact', 'msisdn', 'tel', 'cell'];
    const lower = columns.map((c) => String(c).toLowerCase());
    for (const p of pri) { const i = lower.findIndex((c) => c.includes(p)); if (i >= 0) return columns[i]; }
    let best = columns[0], bestScore = -1;
    for (const c of columns) {
      const score = (rows || []).slice(0, 50).filter((r) => normalizePhone(r[c], defaultCC)).length;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  // Rows from SheetJS (sheet_to_json with defval:'') -> clean strings
  function cleanSheetRows(rows) {
    if (!rows.length) return { columns: [], rows: [] };
    const columns = Object.keys(rows[0]).map((c) => String(c).trim()).filter(Boolean);
    const clean = rows.map((r) => {
      const o = {};
      for (const [k, v] of Object.entries(r)) {
        const key = String(k).trim(); if (!key) continue;
        o[key] = typeof v === 'number' ? String(v) : (v === null || v === undefined ? '' : String(v).trim());
      }
      return o;
    });
    return { columns, rows: clean };
  }

  // Build the send queue: validate, dedupe, apply the unsubscribe list.
  function buildQueue(rows, phoneColumn, defaultCC, optouts) {
    const seen = new Set(); const out = []; const skipped = [];
    const opt = new Set(optouts || []);
    for (const row of rows) {
      const phone = normalizePhone(row[phoneColumn], defaultCC);
      if (!phone) { skipped.push({ phone: String(row[phoneColumn] || ''), row, status: 'skipped', reason: 'invalid number' }); continue; }
      if (seen.has(phone)) { skipped.push({ phone, row, status: 'skipped', reason: 'duplicate' }); continue; }
      seen.add(phone);
      if (opt.has(phone)) { skipped.push({ phone, row, status: 'skipped', reason: 'unsubscribed' }); continue; }
      out.push({ phone, row, status: 'pending', reason: null });
    }
    return { queue: out, skipped };
  }

  function toCSV(columns, items) {
    const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = ['phone', 'status', 'reason', 'sent_at', ...columns, 'message'];
    const lines = [head.map(esc).join(',')];
    for (const it of items) lines.push([it.phone, it.status, it.reason || '', it.sentAt || '', ...columns.map((c) => (it.row || {})[c]), it.rendered || ''].map(esc).join(','));
    return '﻿' + lines.join('\r\n');
  }

  function rand(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }

  return { normalizePhone, render, fields, parsePaste, guessPhoneColumn, cleanSheetRows, buildQueue, toCSV, rand };
});

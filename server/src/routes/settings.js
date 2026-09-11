const express = require('express');
const { allSettings, setSetting } = require('../lib/db');
const router = express.Router();

const KEYS = ['daily_cap', 'default_country_code', 'optout_keywords', 'optout_reply', 'timezone', 'verify_numbers'];

router.get('/', (req, res) => res.render('settings', { s: allSettings() }));

router.post('/', (req, res) => {
  for (const k of KEYS) {
    let v = req.body[k];
    if (k === 'verify_numbers') v = v ? '1' : '0';
    if (v === undefined) continue;
    if (k === 'daily_cap') v = String(Math.max(0, parseInt(v, 10) || 0));
    if (k === 'default_country_code') v = String(v).replace(/\D/g, '');
    if (k === 'timezone') { try { new Intl.DateTimeFormat('en', { timeZone: v }); } catch { res.flash('Unknown timezone, kept the old one.'); continue; } }
    setSetting(k, String(v).trim());
  }
  res.flash('Settings saved.');
  res.redirect('/settings');
});

module.exports = router;

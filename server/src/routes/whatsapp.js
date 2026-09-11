const express = require('express');
const { wa } = require('../lib/wa');
const { requireAdmin } = require('../lib/auth');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('whatsapp', { wa: { state: wa.state, info: wa.info, error: wa.lastError, qr: wa.qrDataUrl } });
});

router.get('/qr.json', (req, res) => {
  res.json({ state: wa.state, qr: wa.qrDataUrl, info: wa.info, error: wa.lastError });
});

router.post('/connect', requireAdmin, (req, res) => {
  wa.start();
  res.flash('Starting WhatsApp session…');
  res.redirect('/whatsapp');
});

router.post('/logout', requireAdmin, async (req, res) => {
  await wa.logout();
  res.flash('Logged out of WhatsApp. Click Connect to link a number again.');
  res.redirect('/whatsapp');
});

router.post('/restart', requireAdmin, async (req, res) => {
  await wa.stop();
  wa.start();
  res.flash('Restarting WhatsApp session…');
  res.redirect('/whatsapp');
});

module.exports = router;

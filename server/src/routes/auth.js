const express = require('express');
const auth = require('../lib/auth');
const router = express.Router();

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { error: null, next: req.query.next || '/' });
});

router.post('/login', (req, res) => {
  const { username, password, next } = req.body;
  const token = auth.login((username || '').trim(), password || '');
  if (!token) return res.status(401).render('login', { error: 'Wrong username or password.', next: next || '/' });
  res.cookie('session', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
  const dest = typeof next === 'string' && next.startsWith('/') ? next : '/';
  res.redirect(dest);
});

router.post('/logout', (req, res) => {
  auth.logout(req.cookies?.session);
  res.clearCookie('session');
  res.redirect('/login');
});

module.exports = router;

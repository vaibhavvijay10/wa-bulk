const express = require('express');
const { db } = require('../lib/db');
const { bcrypt } = require('../lib/auth');
const router = express.Router();

router.get('/', (req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all();
  res.render('users', { users });
});

router.post('/add', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const role = req.body.role === 'admin' ? 'admin' : 'sender';
  if (!/^[a-zA-Z0-9._-]{2,40}$/.test(username)) { res.flash('Username: letters, numbers, dots, dashes only.'); return res.redirect('/users'); }
  if (password.length < 8) { res.flash('Password must be at least 8 characters.'); return res.redirect('/users'); }
  try {
    db.prepare('INSERT INTO users(username, password_hash, role) VALUES(?, ?, ?)').run(username, bcrypt.hashSync(password, 10), role);
    res.flash(`User ${username} created.`);
  } catch { res.flash('That username already exists.'); }
  res.redirect('/users');
});

router.post('/:id(\\d+)/password', (req, res) => {
  const password = req.body.password || '';
  if (password.length < 8) { res.flash('Password must be at least 8 characters.'); return res.redirect('/users'); }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), req.params.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id);
  res.flash('Password updated.');
  res.redirect('/users');
});

router.post('/:id(\\d+)/role', (req, res) => {
  if (Number(req.params.id) === req.user.id) { res.flash("You can't change your own role."); return res.redirect('/users'); }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role === 'admin' ? 'admin' : 'sender', req.params.id);
  res.redirect('/users');
});

router.post('/:id(\\d+)/delete', (req, res) => {
  if (Number(req.params.id) === req.user.id) { res.flash("You can't delete yourself."); return res.redirect('/users'); }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.flash('User deleted.');
  res.redirect('/users');
});

module.exports = router;

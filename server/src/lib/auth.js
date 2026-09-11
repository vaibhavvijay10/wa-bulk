const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./db');

function ensureAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'changeme';
  db.prepare('INSERT INTO users(username, password_hash, role) VALUES(?, ?, ?)')
    .run(username, bcrypt.hashSync(password, 10), 'admin');
  console.log(`Created first admin user "${username}" (password from ADMIN_PASSWORD env${process.env.ADMIN_PASSWORD ? '' : ', default "changeme" — change it!'})`);
}

function login(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token, user_id) VALUES(?, ?)').run(token, user.id);
  return token;
}

function logout(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function sessionMiddleware(req, res, next) {
  const token = req.cookies?.session;
  req.user = null;
  if (token) {
    req.user = db.prepare('SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token) || null;
  }
  res.locals.user = req.user;
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'admin') return res.status(403).render('error', { title: 'Forbidden', message: 'Admins only.' });
  next();
}

module.exports = { ensureAdmin, login, logout, sessionMiddleware, requireLogin, requireAdmin, bcrypt };

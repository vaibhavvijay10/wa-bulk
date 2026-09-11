const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { db } = require('./lib/db');
const { wa, MOCK } = require('./lib/wa');
const worker = require('./lib/worker');
const auth = require('./lib/auth');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.use(auth.sessionMiddleware);
app.use((req, res, next) => {
  res.locals.mock = MOCK;
  res.locals.waState = wa.state;
  res.locals.path = req.path;
  res.locals.flash = req.cookies?.flash || null;
  if (req.cookies?.flash) res.clearCookie('flash');
  res.flash = (msg) => res.cookie('flash', msg, { httpOnly: true, sameSite: 'lax', maxAge: 10000 });
  next();
});

app.use(require('./routes/auth'));
app.use(auth.requireLogin);
app.use(require('./routes/dashboard'));
app.use('/whatsapp', require('./routes/whatsapp'));
app.use('/campaigns', require('./routes/campaigns'));
app.use('/inbox', require('./routes/inbox'));
app.use('/optouts', require('./routes/optouts'));
app.use('/users', auth.requireAdmin, require('./routes/users'));
app.use('/settings', auth.requireAdmin, require('./routes/settings'));

app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Error', message: err.message || 'Something went wrong.' });
});

auth.ensureAdmin();
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`wa-bulk listening on http://0.0.0.0:${PORT}${MOCK ? ' (MOCK MODE — no real WhatsApp)' : ''}`);
  worker.start();
  if (process.env.WA_AUTOSTART !== '0') wa.start();
});

process.on('SIGTERM', async () => { worker.stop(); await wa.stop(); db.close(); process.exit(0); });
process.on('SIGINT', async () => { worker.stop(); await wa.stop(); db.close(); process.exit(0); });

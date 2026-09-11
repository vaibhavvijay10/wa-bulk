const express = require('express');
const { db, sentToday, getSetting } = require('../lib/db');
const { wa } = require('../lib/wa');
const worker = require('../lib/worker');
const router = express.Router();

router.get('/', (req, res) => {
  const campaigns = db.prepare(`
    SELECT c.*, u.username AS creator,
      (SELECT COUNT(*) FROM recipients r WHERE r.campaign_id = c.id) AS total,
      (SELECT COUNT(*) FROM recipients r WHERE r.campaign_id = c.id AND r.status = 'sent') AS sent,
      (SELECT COUNT(*) FROM recipients r WHERE r.campaign_id = c.id AND r.status = 'failed') AS failed,
      (SELECT COUNT(*) FROM recipients r WHERE r.campaign_id = c.id AND r.status = 'pending') AS pending
    FROM campaigns c LEFT JOIN users u ON u.id = c.created_by
    ORDER BY c.id DESC LIMIT 10`).all();
  const unread = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction = 'in' AND created_at >= datetime('now', '-1 day')").get().n;
  const optouts = db.prepare('SELECT COUNT(*) AS n FROM optouts').get().n;
  res.render('dashboard', {
    campaigns, unread, optouts,
    wa: { state: wa.state, info: wa.info, error: wa.lastError },
    worker: worker.status(),
    sentToday: sentToday(), dailyCap: Number(getSetting('daily_cap'))
  });
});

// JSON status for live polling
router.get('/api/status', (req, res) => {
  const campaign = worker.status().currentCampaignId
    ? db.prepare(`SELECT id, name, status,
        (SELECT COUNT(*) FROM recipients r WHERE r.campaign_id = c.id) AS total,
        (SELECT COUNT(*) FROM recipients r WHERE r.campaign_id = c.id AND r.status = 'sent') AS sent,
        (SELECT COUNT(*) FROM recipients r WHERE r.campaign_id = c.id AND r.status = 'failed') AS failed,
        (SELECT COUNT(*) FROM recipients r WHERE r.campaign_id = c.id AND r.status = 'skipped') AS skipped,
        (SELECT COUNT(*) FROM recipients r WHERE r.campaign_id = c.id AND r.status = 'pending') AS pending
        FROM campaigns c WHERE id = ?`).get(worker.status().currentCampaignId)
    : null;
  res.json({ wa: { state: wa.state, info: wa.info, error: wa.lastError, hasQr: !!wa.qrDataUrl }, worker: worker.status(), campaign });
});

module.exports = router;

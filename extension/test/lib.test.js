// Unit tests for content/lib.js — run with: node test/lib.test.js
const assert = require('assert');
const L = require('../content/lib.js');
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('FAIL', name, e.message); process.exitCode = 1; } };

t('normalizePhone basics', () => {
  assert.strictEqual(L.normalizePhone('+91 98765-43210', '91'), '919876543210');
  assert.strictEqual(L.normalizePhone('9876543210', '91'), '919876543210');
  assert.strictEqual(L.normalizePhone('09876543210', '91'), '919876543210');
  assert.strictEqual(L.normalizePhone('0044 7700 900123', '91'), '447700900123');
  assert.strictEqual(L.normalizePhone('+44 7700 900123', '91'), '447700900123');
  assert.strictEqual(L.normalizePhone(9876543210, '91'), '919876543210');
  assert.strictEqual(L.normalizePhone('9.19876543210E11', '91'), '919876543210');
  assert.strictEqual(L.normalizePhone('abc', '91'), null);
  assert.strictEqual(L.normalizePhone('12345', '91'), null);
  assert.strictEqual(L.normalizePhone('', '91'), null);
});

t('render merge + fallback + spintax', () => {
  assert.strictEqual(L.render('Hi {{name}}, {{bonus}}!', { Name: 'Rahul', bonus: '50' }), 'Hi Rahul, 50!');
  assert.strictEqual(L.render('Hi {{name|there}}', { name: '' }), 'Hi there');
  const noCol = L.render('Hi {{name|there}}', {}); // no such column at all -> treated as spintax (same rule as the server app)
  assert.ok(noCol === 'Hi name' || noCol === 'Hi there');
  const out = L.render('{{Hi|Hello}} x', {});
  assert.ok(out === 'Hi x' || out === 'Hello x');
  assert.strictEqual(L.render('{{missing}} end', {}), ' end');
  assert.deepStrictEqual(L.fields('{{name}} {{a|b}} {{city}}'), ['name', 'city']);
});

t('parsePaste: one number per line', () => {
  const p = L.parsePaste('9876543210\n+91 91234 56789\n', '91');
  assert.deepStrictEqual(p.columns, ['phone']);
  assert.strictEqual(p.rows.length, 2);
  assert.strictEqual(p.phoneColumn, 'phone');
});
t('parsePaste: number, name', () => {
  const p = L.parsePaste('9876543210, Rahul\n9123456789, Emma', '91');
  assert.deepStrictEqual(p.columns, ['phone', 'name']);
  assert.strictEqual(p.rows[0].name, 'Rahul');
});
t('parsePaste: name first with tab (copied from Excel) + header', () => {
  const p = L.parsePaste('Name\tMobile\tCity\nRahul\t9876543210\tPune\nEmma\t+44 7700 900123\tLeeds', '91');
  assert.deepStrictEqual(p.columns, ['Name', 'Mobile', 'City']);
  assert.strictEqual(p.phoneColumn, 'Mobile');
  assert.strictEqual(p.rows[1].City, 'Leeds');
});
t('parsePaste: tab without header, name first', () => {
  const p = L.parsePaste('Rahul\t9876543210\nEmma\t9123456789', '91');
  assert.deepStrictEqual(p.columns, ['name', 'phone']);
  assert.strictEqual(p.phoneColumn, 'phone');
  assert.strictEqual(p.rows[0].name, 'Rahul');
});
t('parsePaste: "name: number" and "number name" and comma list', () => {
  const p = L.parsePaste('Rahul: 98765 43210\n9123456789 Emma Watson\n9000000001, 9000000002', '91');
  assert.strictEqual(p.rows.length, 4);
  assert.strictEqual(p.rows[0].name, 'Rahul');
  assert.strictEqual(p.rows[1].name, 'Emma Watson');
  assert.strictEqual(L.normalizePhone(p.rows[3].phone, '91'), '919000000002');
});

t('buildQueue dedupes, validates, applies optouts', () => {
  const rows = [{ phone: '9876543210' }, { phone: '+91 98765 43210' }, { phone: 'x' }, { phone: '9000000000' }];
  const q = L.buildQueue(rows, 'phone', '91', ['919000000000']);
  assert.strictEqual(q.queue.length, 1);
  assert.deepStrictEqual(q.skipped.map((s) => s.reason), ['duplicate', 'invalid number', 'unsubscribed']);
});

t('cleanSheetRows + guessPhoneColumn', () => {
  const c = L.cleanSheetRows([{ 'Phone ': 919876543210, name: ' Rahul ' }, { 'Phone ': '', name: 'x' }]);
  assert.deepStrictEqual(c.columns, ['Phone', 'name']);
  assert.strictEqual(c.rows[0].Phone, '919876543210');
  assert.strictEqual(L.guessPhoneColumn(c.columns, c.rows, '91'), 'Phone');
});

t('toCSV escapes', () => {
  const csv = L.toCSV(['name'], [{ phone: '1', status: 'sent', row: { name: 'A, "B"' }, rendered: 'hi\nthere' }]);
  assert.ok(csv.includes('"A, ""B"""'));
  assert.ok(csv.includes('"hi\nthere"'));
});

console.log(`lib tests: ${n} passed${process.exitCode ? ' (with failures)' : ''}`);

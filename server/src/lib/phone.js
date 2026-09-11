// Normalise a phone number into digits-only international format (no "+").
// Rules: strip everything non-numeric; drop a leading "00"; if the result has
// no country code (heuristic: 10 digits or fewer, or starts with 0), prefix the
// default country code from settings.
function normalizePhone(raw, defaultCC = '91') {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // Excel sometimes gives numbers in scientific notation
  if (/e\+/i.test(s)) {
    const n = Number(s);
    if (!Number.isNaN(n)) s = n.toLocaleString('fullwide', { useGrouping: false });
  }
  let digits = s.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  const hadPlus = s.trim().startsWith('+');
  if (!hadPlus) {
    if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
    if (digits.length <= 10) digits = String(defaultCC).replace(/\D/g, '') + digits;
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

module.exports = { normalizePhone };

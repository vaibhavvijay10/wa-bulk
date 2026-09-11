// Mail-merge + spintax rendering.
//   {{name}}                -> value of column "name" (case-insensitive)
//   {{Hi|Hello|Hey}}        -> one option chosen at random (spintax)
//   {{name|there}}          -> NOT spintax: if "name" is a column it merges,
//                              with "there" as the fallback when the cell is empty.
// Nested spintax is supported: {{Hi|Hey {{there|friend}}}}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function splitTopLevel(s) {
  const parts = [];
  let depth = 0, cur = '';
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

  // Resolve innermost {{...}} groups first, repeatedly.
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
      if (parts.length === 1) return ''; // unknown field -> blank
      return pick(parts);
    });
  }
  return out;
}

// Which single-token merge fields does a template reference? Groups with
// alternatives ({{a|b}}) are skipped because they may be spintax.
function fields(template) {
  const found = new Set();
  const re = /\{\{([^{}]*)\}\}/g;
  let m;
  while ((m = re.exec(template || ''))) {
    const parts = splitTopLevel(m[1]);
    const first = parts[0].trim();
    if (parts.length === 1 && first) found.add(first);
  }
  return [...found];
}

module.exports = { render, fields };

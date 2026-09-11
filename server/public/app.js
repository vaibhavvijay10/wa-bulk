(function () {
  // Show UTC timestamps in the viewer's local time
  document.querySelectorAll('[data-utc]').forEach(function (el) {
    var d = new Date(el.getAttribute('data-utc'));
    if (!isNaN(d)) el.textContent = d.toLocaleString();
  });

  // Compose page: field chips, live preview, tz offset for scheduling
  if (window.__compose) {
    var ta = document.getElementById('template');
    var tz = document.getElementById('tzOffset');
    if (tz) tz.value = String(new Date().getTimezoneOffset());
    document.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var ins = chip.getAttribute('data-ins');
        var s = ta.selectionStart || 0, e = ta.selectionEnd || 0;
        ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
        ta.focus(); ta.selectionStart = ta.selectionEnd = s + ins.length;
        schedulePreview();
      });
    });
    var timer;
    function schedulePreview() { clearTimeout(timer); timer = setTimeout(preview, 300); }
    function preview() {
      var body = { sheetId: window.__compose.sheetId, phoneColumn: document.getElementById('phoneColumn').value, template: ta.value };
      fetch('/campaigns/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var box = document.getElementById('preview');
          box.innerHTML = '';
          (d.samples || []).forEach(function (s) {
            var div = document.createElement('div');
            div.className = 'bubble';
            div.textContent = s.text || '(empty)';
            var meta = document.createElement('div');
            meta.className = 'meta';
            meta.textContent = s.phone ? '+' + s.phone : 'invalid number';
            div.appendChild(meta);
            box.appendChild(div);
          });
          var unk = document.getElementById('unknown');
          unk.textContent = d.unknown && d.unknown.length ? 'Not a column in your sheet (will be blank): ' + d.unknown.join(', ') : '';
        }).catch(function () {});
    }
    ta.addEventListener('input', schedulePreview);
    document.getElementById('phoneColumn').addEventListener('change', schedulePreview);
    document.getElementById('scheduledAt').addEventListener('input', function () {
      document.querySelector('input[name=when][value=schedule]').checked = true;
    });
    if (ta.value) preview();
  }

  // Campaign page: live counters
  if (window.__campaign && ['running', 'scheduled', 'paused'].indexOf(window.__campaign.status) >= 0) {
    var lastStatus = window.__campaign.status;
    setInterval(function () {
      fetch('/campaigns/' + window.__campaign.id + '/stats.json').then(function (r) { return r.json(); }).then(function (d) {
        if (d.status !== lastStatus) { location.reload(); return; }
        var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
        set('nSent', d.sent); set('nFailed', d.failed); set('nSkipped', d.skipped); set('nPending', d.pending);
        var pct = function (n) { return d.total ? (n / d.total * 100) + '%' : '0%'; };
        document.getElementById('bS').style.width = pct(d.sent);
        document.getElementById('bF').style.width = pct(d.failed);
        document.getElementById('bK').style.width = pct(d.skipped);
      }).catch(function () {});
    }, 3000);
  }

  // WhatsApp page: poll for QR / state
  if (window.__poll && window.__poll.qr) {
    var last = null;
    setInterval(function () {
      fetch('/whatsapp/qr.json').then(function (r) { return r.json(); }).then(function (d) {
        var box = document.getElementById('qrBox');
        var state = document.getElementById('waState');
        if (state) { state.textContent = d.state; state.className = 'badge ' + d.state; }
        var key = d.state + '|' + (d.qr || '').slice(-40);
        if (key === last) return;
        last = key;
        if (d.qr) box.innerHTML = '<img src="' + d.qr + '" alt="QR"><p class="muted">Scan with WhatsApp on the phone.</p>';
        else if (d.state === 'ready') { box.innerHTML = '<p class="muted">Connected — no QR needed.</p>'; setTimeout(function () { location.reload(); }, 800); }
        else box.innerHTML = '<p class="muted">Waiting for a QR code… (' + d.state + (d.error ? ': ' + d.error : '') + ')</p>';
      }).catch(function () {});
    }, 2000);
  }

  // Inbox: scroll chat to bottom, refresh periodically
  if (window.__inbox) {
    var chat = document.getElementById('chat');
    if (chat) chat.scrollTop = chat.scrollHeight;
    setInterval(function () {
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
      location.reload();
    }, 20000);
  }
})();

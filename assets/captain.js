// captain.js — captain portal actions: check-in and result reporting. Uses the token embedded on
// the page (window.__IH_TOKEN__); all mutations re-verify the token server-side.
(function () {
  var token = window.__IH_TOKEN__;
  if (!token) return;

  async function post(url, body) {
    var r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    var data = {}; try { data = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, data };
  }

  var checkinBtn = document.getElementById('checkin-btn');
  if (checkinBtn) {
    checkinBtn.addEventListener('click', async function () {
      checkinBtn.disabled = true; checkinBtn.textContent = 'Checking in…';
      var res = await post('/api/captain/checkin', { token: token });
      if (res.ok) { checkinBtn.outerHTML = '<span class="pill ok">✓ Checked in</span>'; }
      else { checkinBtn.disabled = false; checkinBtn.textContent = 'Check in'; alert('Check-in failed: ' + (res.data.error || res.status)); }
    });
  }

  document.querySelectorAll('.c-submit').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var card = btn.closest('.cmatch');
      var msg = card.querySelector('.cmsg');
      var matchId = card.getAttribute('data-match');
      var me = btn.getAttribute('data-me');
      var winner = card.querySelector('.c-winner').value;
      var mine = parseInt(card.querySelector('.c-mine').value, 10) || 0;
      var theirs = parseInt(card.querySelector('.c-theirs').value, 10) || 0;
      // map "mine/theirs" to the match's a/b order
      var a = card.getAttribute('data-a');
      var scoreA = me === a ? mine : theirs;
      var scoreB = me === a ? theirs : mine;
      btn.disabled = true; msg.className = 'cmsg'; msg.textContent = 'Submitting…';
      var res = await post('/api/captain/result', { token: token, matchId: matchId, winner: winner, scoreA: scoreA, scoreB: scoreB });
      btn.disabled = false;
      if (!res.ok) { msg.className = 'cmsg err'; msg.textContent = 'Error: ' + (res.data.error || res.status); return; }
      var s = res.data.status;
      if (s === 'confirmed') { msg.className = 'cmsg ok'; msg.textContent = 'Confirmed — result locked in. Refreshing…'; setTimeout(function () { location.reload(); }, 1200); }
      else if (s === 'disputed') { msg.className = 'cmsg err'; msg.textContent = 'Your report conflicts with the other captain. An admin has been flagged to resolve it.'; }
      else { msg.className = 'cmsg ok'; msg.textContent = 'Reported. Waiting for the other captain to confirm.'; }
    });
  });
})();

/* ============================================================
   Kasama — open-source feedback layer (highlight + pin comments).
   Embed:  <script src=".../kasama.js" data-slug="my-page" data-root="article"></script>
     data-slug  annotations store key            (default: the URL path)
     data-root  CSS selector for the comment area (default: 'body')
     data-api   base URL of your Kasama server    (default: same origin)
   Notes:
     pin → {num,kind:'pin',sid,x,y,text,thread,resolved,ts}
     hl  → {num,kind:'hl',sid,start,end,quote,anchor,text,thread,resolved,ts}
   Highlights re-anchor by character offset within the container's text
   (pins/overlay excluded from the count), verified loosely by the stored quote.
   NOTE: internal class/id names are still prefixed `er-` (roadmap: neutralise).
   ============================================================ */
(function () {
  var _s = document.currentScript || (function () { var a = document.getElementsByTagName('script'); return a[a.length - 1]; })();
  var _d = (_s && _s.dataset) || {};
  var _cfg = window.KASAMA || {};
  var SLUG = _d.slug || _cfg.slug || (location.pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'home');
  var ROOTSEL = _d.root || _cfg.root || 'body';
  var APIBASE = (_d.api || _cfg.api || '').replace(/\/+$/, '');
  var API = APIBASE + '/api/annotations/' + SLUG;
  var NAMEKEY = 'kasama-name';

  var containers = [].slice.call(document.querySelectorAll(ROOTSEL));
  if (!containers.length) return;

  var notes = [];
  var mode = false, ed = null, tst, showResolved = false, _t = null, _suppressClick = false;

  /* --- container setup: id, relative pos, pin overlay --- */
  containers.forEach(function (c, i) {
    if (!c.getAttribute('data-erid')) c.setAttribute('data-erid', containers.length === 1 ? 'menu' : 'c' + i);
    c.classList.add('er-host');
    if (getComputedStyle(c).position === 'static') c.style.position = 'relative';
    var o = document.createElement('div'); o.className = 'er-aov'; c.appendChild(o); c._o = o;
  });

  /* --- helpers --- */
  function esc(t) { return (t + '').replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function byId(id) { for (var i = 0; i < containers.length; i++) if (containers[i].getAttribute('data-erid') === id) return containers[i]; return containers[0] || null; }
  function noteByNum(n) { for (var i = 0; i < notes.length; i++) if (notes[i].num === n) return notes[i]; return null; }
  function nextN() { return notes.reduce(function (m, n) { return Math.max(m, n.num || 0); }, 0) + 1; }
  function visibleNotes() { return showResolved ? notes : notes.filter(function (n) { return !n.resolved; }); }
  function firstText(n) { return (n.thread && n.thread.length) ? n.thread[0].text : (n.text || ''); }
  function getName() { try { return localStorage.getItem(NAMEKEY) || ''; } catch (e) { return ''; } }
  function setName(v) { try { localStorage.setItem(NAMEKEY, v); } catch (e) {} }
  function hostOf(n) { var e = n.nodeType === 3 ? n.parentElement : n; var h = e ? e.closest(ROOTSEL) : null; return (h && containers.indexOf(h) >= 0) ? h : null; }
  function hostTitle(c) { var h = c.querySelector('.eyebrow,h1,h2,h3,.title'); return h ? h.textContent.trim().slice(0, 46) : (c.getAttribute('data-erid') || 'Section'); }

  /* text nodes within a container, EXCLUDING our own overlay/script/style,
     INCLUDING .er-hl wrappers (they wrap real content). Used for offsets. */
  function textNodes(root) {
    var out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        while (p && p !== root) {
          if (p.nodeType === 1) {
            var tag = p.tagName, cn = p.getAttribute ? (p.getAttribute('class') || '') : '';
            if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
            if (/(^|\s)er-/.test(cn) && !/(^|\s)er-hl(\s|$)/.test(cn)) return NodeFilter.FILTER_REJECT;
          }
          p = p.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n; while ((n = w.nextNode())) out.push(n);
    return out;
  }

  /* char offset of a DOM point (node,off) within host's annotated text */
  function offsetOf(host, node, off) {
    var tns = textNodes(host), pos = 0;
    for (var i = 0; i < tns.length; i++) {
      var tn = tns[i], tr = document.createRange(); tr.selectNodeContents(tn);
      var c; try { c = tr.comparePoint(node, off); } catch (e) { c = 1; }
      if (c > 0) pos += tn.nodeValue.length;        // point is after this text node
      else if (c === 0) { pos += (node === tn ? off : 0); break; } // point inside it
      else break;                                    // point is before it
    }
    return pos;
  }

  function clearHighlights() {
    containers.forEach(function (c) {
      [].slice.call(c.querySelectorAll('.er-hl')).forEach(function (sp) {
        sp.parentNode.replaceChild(document.createTextNode(sp.textContent), sp);
      });
      c.normalize();
    });
  }

  function highlightRange(host, start, end, num, resolved) {
    var tns = textNodes(host), pos = 0, segs = [];
    for (var i = 0; i < tns.length; i++) {
      var tn = tns[i], len = tn.nodeValue.length, ns = pos, ne = pos + len;
      var s = Math.max(start, ns), e = Math.min(end, ne);
      if (s < e) segs.push({ tn: tn, s: s - ns, e: e - ns });
      pos = ne;
    }
    /* wrap in reverse doc order so earlier text nodes stay valid */
    for (var j = segs.length - 1; j >= 0; j--) {
      var g = segs[j], r = document.createRange();
      try { r.setStart(g.tn, g.s); r.setEnd(g.tn, g.e); } catch (x) { continue; }
      var sp = document.createElement('span');
      sp.className = 'er-hl' + (resolved ? ' er-resolved' : '');
      sp.setAttribute('data-num', num);
      try { r.surroundContents(sp); } catch (x2) { continue; }
      sp.addEventListener('click', (function (nn) {
        return function (ev) { ev.stopPropagation(); var n = noteByNum(nn); if (n) edit(n, ev.clientX, ev.clientY); };
      })(num));
    }
  }

  /* --- render --- */
  function render() {
    /* pins */
    containers.forEach(function (c) { c._o.innerHTML = ''; });
    visibleNotes().filter(function (n) { return n.kind === 'pin'; }).forEach(function (n) {
      var c = byId(n.sid); if (!c) return;
      var p = document.createElement('div'); p.className = 'er-pin' + (n.resolved ? ' er-resolved' : '');
      p.textContent = n.num; p.style.left = n.x + '%'; p.style.top = n.y + '%';
      p.title = (n.anchor ? 'on: ' + n.anchor + '\n' : '') + firstText(n).slice(0, 80);
      p.addEventListener('click', function (ev) { ev.stopPropagation(); edit(n, ev.clientX, ev.clientY); });
      c._o.appendChild(p);
    });
    /* highlights */
    clearHighlights();
    visibleNotes().filter(function (n) { return n.kind === 'hl'; }).forEach(function (n) {
      var c = byId(n.sid); if (c) highlightRange(c, n.start, n.end, n.num, n.resolved);
    });
    cnt();
  }

  /* --- sync (Postgres is source of truth) --- */
  function _syncFromServer() {
    if (ed) return; /* don't disrupt an open editor */
    fetch(API).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); }).then(function (srv) {
      if (!Array.isArray(srv)) return;
      notes = srv.slice().sort(function (a, b) { return a.num - b.num; });
      render(); panel();
    }).catch(function () {});
  }
  function _syncToServer() {
    clearTimeout(_t);
    _t = setTimeout(function () {
      fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(notes) }).catch(function () {});
    }, 500);
  }
  function persist() { cnt(); _syncToServer(); }

  /* --- threaded editor (pins + highlights share this) --- */
  function close() { if (ed) { ed.remove(); ed = null; } }
  function threadHTML(th) {
    return (th || []).map(function (m) {
      var ts = m.ts ? new Date(m.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      return '<div class="er-msg them"><div class="er-by">' + esc(m.by || 'Guest') +
        ' <span style="font-weight:400;font-size:10px;color:#aaa">' + ts + '</span></div>' + esc(m.text) + '</div>';
    }).join('');
  }
  function edit(note, cx, cy) {
    close();
    var e = document.createElement('div'); e.className = 'er-ed'; ed = e;
    var hasThread = note.thread && note.thread.length;
    var anH = note.anchor ? '<div class="er-anchor-bar">' + (note.kind === 'hl' ? '“' : '↳ ') + esc(note.anchor) + (note.kind === 'hl' ? '”' : '') + '</div>' : '';
    var nameRow = getName() ? '' : '<div class="er-name-row"><input class="nm" placeholder="Your name (optional)"></div>';
    var resBtn = note.resolved ? '<button class="ropen">↩ Reopen</button>' : '<button class="rv">✓ Resolve</button>';
    e.innerHTML = anH + '<div class="er-thread">' + threadHTML(note.thread) + '</div>' + nameRow +
      '<div class="er-reply-row"><textarea placeholder="' + (hasThread ? 'Reply…' : 'Add a comment…') + '"></textarea></div>' +
      '<div class="r"><button class="d">Delete</button>' + resBtn +
      '<span><button class="c">Cancel</button> <button class="s">' + (hasThread ? 'Reply' : 'Comment') + '</button></span></div>';
    document.body.appendChild(e);
    e.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
    e.addEventListener('click', function (ev) { ev.stopPropagation(); });
    var ta = e.querySelector('textarea');
    e.style.left = Math.max(8, Math.min(cx, innerWidth - 332)) + 'px';
    e.style.top = Math.max(8, Math.min(cy, innerHeight - 320)) + 'px';
    ta.focus(); ta.addEventListener('keydown', function (ev) { ev.stopPropagation(); });

    e.querySelector('.s').addEventListener('click', function () {
      var t = ta.value.trim();
      var nmEl = e.querySelector('.nm'); if (nmEl && nmEl.value.trim()) setName(nmEl.value.trim());
      if (t) {
        if (!note.thread) note.thread = [];
        note.thread.push({ by: getName() || 'Guest', text: t, ts: Date.now() });
        note.text = note.thread[0].text;
        if (notes.indexOf(note) < 0) notes.push(note);
      } else if (notes.indexOf(note) < 0) { return; }
      persist(); render(); panel(); close(); toast('Comment saved');
    });
    e.querySelector('.c').addEventListener('click', function () { close(); render(); });
    e.querySelector('.d').addEventListener('click', function () { notes = notes.filter(function (n) { return n !== note; }); persist(); render(); panel(); close(); toast('Deleted'); });
    var rv = e.querySelector('.rv'), ro = e.querySelector('.ropen');
    if (rv) rv.addEventListener('click', function () { note.resolved = true; persist(); render(); panel(); close(); toast('Resolved'); });
    if (ro) ro.addEventListener('click', function () { delete note.resolved; persist(); render(); panel(); close(); toast('Reopened'); });
  }

  /* --- text selection → floating Comment button --- */
  var selbtn = document.createElement('div'); selbtn.id = 'er-selbtn'; selbtn.textContent = '💬 Comment'; document.body.appendChild(selbtn);
  function hideSel() { selbtn.classList.remove('show'); }
  function onSelect() {
    if (ed) return;
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return hideSel();
    var range = sel.getRangeAt(0);
    if (!hostOf(range.commonAncestorContainer)) return hideSel();
    if (sel.toString().replace(/\s+/g, ' ').trim().length < 2) return hideSel();
    var rects = range.getClientRects(); if (!rects.length) return hideSel();
    var r = rects[rects.length - 1];
    selbtn.style.left = r.right + 'px';
    selbtn.style.top = r.top + 'px';
    selbtn.classList.add('show');
  }
  selbtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); ev.stopPropagation(); }); /* keep selection alive */
  selbtn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    var sel = window.getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return hideSel();
    var range = sel.getRangeAt(0), host = hostOf(range.commonAncestorContainer); if (!host) return hideSel();
    var start = offsetOf(host, range.startContainer, range.startOffset);
    var end = offsetOf(host, range.endContainer, range.endOffset);
    if (end < start) { var tmp = start; start = end; end = tmp; }
    var quote = sel.toString().replace(/\s+/g, ' ').trim().slice(0, 140);
    if (end <= start) return hideSel();
    var cx = ev.clientX, cy = ev.clientY;
    sel.removeAllRanges(); hideSel();
    edit({ num: nextN(), kind: 'hl', sid: host.getAttribute('data-erid'), start: start, end: end, quote: quote, anchor: quote, text: '', thread: [], ts: Date.now() }, cx, cy);
  });
  document.addEventListener('mouseup', function () { setTimeout(onSelect, 0); });
  document.addEventListener('keyup', function (e) { if (e.shiftKey || e.key === 'Shift') setTimeout(onSelect, 0); });
  window.addEventListener('scroll', hideSel, true);

  /* --- pin-drop (annotate mode) --- */
  window.addEventListener('mousedown', function (ev) {
    if (ed && !ev.target.closest('.er-ed')) { close(); render(); _suppressClick = true; }
  }, true);
  window.addEventListener('click', function (ev) {
    if (ev.target.closest('#er-bar,#er-pnl,.er-ed,.er-pin,#er-selbtn,.er-hl')) return;
    if (ev.target.closest('a,button,input,textarea,select,label,[contenteditable]')) return; /* let interactive elements (forms/links) work */
    if (_suppressClick) { _suppressClick = false; return; }   /* just dismissed an editor — don't drop a note */
    var c = ev.target.closest(ROOTSEL); if (!c || containers.indexOf(c) < 0) return;
    var _sel = window.getSelection();
    if (_sel && !_sel.isCollapsed && (_sel.toString() || '').trim().length > 1) return; /* text selected → use the 💬 flow */
    var r = c.getBoundingClientRect();
    var x = ((ev.clientX - r.left) / r.width) * 100, y = ((ev.clientY - r.top) / r.height) * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    ev.stopPropagation(); ev.preventDefault();
    var an = '';
    try { var _e = ev.target; while (_e && _e !== c && (!(_e.textContent || '').trim() || (_e.textContent || '').trim().length < 3)) _e = _e.parentElement; if (_e && _e !== c) an = (_e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 90); } catch (x3) {}
    edit({ num: nextN(), kind: 'pin', sid: c.getAttribute('data-erid'), x: +x.toFixed(2), y: +y.toFixed(2), text: '', thread: [], anchor: an, ts: Date.now() }, ev.clientX, ev.clientY);
  }, true);

  /* --- toolbar --- */
  var bar = document.createElement('div'); bar.id = 'er-bar';
  bar.innerHTML = '<span class="er-brand">✦ Feedback</span><button class="t" title="Click anywhere to drop a numbered pin">✎ Pin</button><span class="cnt">0</span><button class="pn">Notes</button><button class="sr">Resolved</button><button class="cp">Copy</button>';
  document.body.appendChild(bar);
  bar.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
  bar.addEventListener('click', function (ev) { ev.stopPropagation(); });
  var bt = bar.querySelector('.t');
  bt.addEventListener('click', function () {
    mode = !mode;
    document.body.classList.toggle('er-on', mode); bt.classList.toggle('on', mode);
    bt.textContent = mode ? '✎ Pinning…' : '✎ Pin';
    toast(mode ? 'Pin mode — click the page to drop a note' : 'Pin mode off');
  });
  bar.querySelector('.pn').addEventListener('click', function () { document.getElementById('er-pnl').classList.toggle('open'); panel(); });
  var srBtn = bar.querySelector('.sr');
  srBtn.addEventListener('click', function () { showResolved = !showResolved; srBtn.classList.toggle('on', showResolved); render(); panel(); });
  bar.querySelector('.cp').addEventListener('click', copy);

  function cnt() {
    var open = notes.filter(function (n) { return !n.resolved; }).length;
    var res = notes.filter(function (n) { return n.resolved; }).length;
    bar.querySelector('.cnt').textContent = open + (res ? '+' + res + 'r' : '');
  }

  /* --- notes panel --- */
  var pnl = document.createElement('div'); pnl.id = 'er-pnl'; document.body.appendChild(pnl);
  pnl.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
  pnl.addEventListener('click', function (ev) { ev.stopPropagation(); });
  function panel() {
    var open = notes.filter(function (n) { return !n.resolved; });
    var res = notes.filter(function (n) { return n.resolved; });
    var display = showResolved ? notes : open;
    var by = {}; display.forEach(function (n) { (by[n.sid] = by[n.sid] || []).push(n); });
    var h = '<h3>Feedback — ' + open.length + ' open · ' + res.length + ' resolved</h3>';
    Object.keys(by).forEach(function (sid) {
      var c = byId(sid);
      h += '<h3>' + esc(c ? hostTitle(c) : sid) + '</h3>';
      by[sid].sort(function (a, b) { return a.num - b.num; }).forEach(function (n) {
        h += '<div class="it' + (n.resolved ? ' resolved' : '') + '" data-num="' + n.num + '">' +
          '<span class="er-kind">' + (n.kind === 'hl' ? 'Highlight' : 'Pin #' + n.num) + '</span> ' + esc(firstText(n) || '(empty)') +
          (n.kind === 'hl' && n.quote ? '<div style="color:#83858a;font-size:11px;margin-top:3px">“' + esc(n.quote) + '”</div>' : '') + '</div>';
      });
    });
    pnl.innerHTML = h;
    [].slice.call(pnl.querySelectorAll('.it')).forEach(function (it) {
      it.addEventListener('click', function () {
        var n = noteByNum(+it.getAttribute('data-num')); if (!n) return;
        var c = byId(n.sid); if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'center' });
        var sp = document.querySelector('.er-hl[data-num="' + n.num + '"]') || (c && c._o.querySelector('.er-pin'));
        var rb = sp ? sp.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2 };
        setTimeout(function () { edit(n, rb.left, rb.top); }, 220);
      });
    });
  }

  /* --- export --- */
  function mdtext() {
    var by = {}; notes.forEach(function (n) { (by[n.sid] = by[n.sid] || []).push(n); });
    var o = '# ' + SLUG + ' feedback (' + notes.filter(function (n) { return !n.resolved; }).length + ' open)\n\n';
    Object.keys(by).forEach(function (sid) {
      var c = byId(sid); o += '## ' + (c ? hostTitle(c) : sid) + '\n';
      by[sid].sort(function (a, b) { return a.num - b.num; }).forEach(function (n) {
        o += '### ' + (n.kind === 'hl' ? 'Highlight “' + (n.quote || '') + '”' : 'Pin #' + n.num) + (n.resolved ? ' [resolved]' : '') + '\n';
        (n.thread || []).forEach(function (m) { o += '- **' + (m.by || 'Guest') + '**: ' + m.text + '\n'; });
        o += '\n';
      });
    });
    return o;
  }
  function copy() {
    var t = mdtext();
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast('Copied feedback'); }, function () { prompt('Copy:', t); });
    else prompt('Copy:', t);
  }
  function toast(m) {
    var t = document.getElementById('er-toast');
    if (!t) { t = document.createElement('div'); t.id = 'er-toast'; document.body.appendChild(t); }
    t.textContent = m; t.classList.add('show'); clearTimeout(tst); tst = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  /* --- boot --- */
  cnt();
  _syncFromServer();
  setInterval(_syncFromServer, 15000); /* light multi-viewer sync */
  setTimeout(function () { toast('Tip: click any line to comment · select text to highlight'); }, 700);
})();

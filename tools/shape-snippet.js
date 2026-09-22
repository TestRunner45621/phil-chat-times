// shape-snippet.js — not run directly. shapes.js injects it into a temporary copy of an issue and opens it
// with ?shape=1. For every .page it measures the page's silhouette: how many columns of body text, how big
// the largest picture is, how much of the page is picture, how much is text, how big the biggest type is,
// and whether the ground is light or dark. Written as JSON to a pre element with id shape-report.
(function () {
  if (!/[?&]shape=1/.test(location.search)) return;
  function visRect(el) {
    var r = el.getBoundingClientRect(), L = r.left, T = r.top, R = r.right, B = r.bottom, a = el.parentElement;
    while (a && a !== document.body) {
      var cs = getComputedStyle(a);
      if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        var q = a.getBoundingClientRect(); L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom);
      }
      if (a.classList.contains('page')) break;
      a = a.parentElement;
    }
    return { w: Math.max(0, R - L), h: Math.max(0, B - T) };
  }
  function lum(c) {
    var m = c.match(/\d+(\.\d+)?/g); if (!m) return 1;
    var v = m.slice(0, 3).map(function (x) { x = +x / 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); });
    return .2126 * v[0] + .7152 * v[1] + .0722 * v[2];
  }
  function run() {
    var out = [];
    Array.prototype.slice.call(document.querySelectorAll('.page')).forEach(function (pg, idx) {
      var p0 = pg.getBoundingClientRect(), cs = getComputedStyle(pg);
      var pr = { left: p0.left + (parseFloat(cs.paddingLeft) || 0), right: p0.right - (parseFloat(cs.paddingRight) || 0),
                 top: p0.top + (parseFloat(cs.paddingTop) || 0), bottom: p0.bottom - (parseFloat(cs.paddingBottom) || 0) };
      var area = (pr.right - pr.left) * (pr.bottom - pr.top);
      var big = 0, pics = 0;
      Array.prototype.slice.call(pg.querySelectorAll('img,svg,canvas,video')).forEach(function (el) {
        if (el.tagName.toLowerCase() === 'svg' ? el.parentElement.closest('svg') : el.closest('svg')) return;
        var v = visRect(el), a = v.w * v.h;
        if (a < 0.25 * 96 * 96) return; // icons and bullets are not pictures
        pics += a; if (a > big) big = a;
      });
      // drawn flourishes: inline SVG (not nested) of at least 0.2in x 0.2in, plus anything marked data-drawn
      var drawn = 0;
      Array.prototype.slice.call(pg.querySelectorAll('svg,canvas')).forEach(function (el) {
        if (el.parentElement.closest('svg') || el.closest('[data-drawn]')) return;
        var v = visRect(el); if (v.w * v.h >= 0.04 * 96 * 96) drawn++;
      });
      drawn += pg.querySelectorAll('[data-drawn]').length;
      var tw = document.createTreeWalker(pg, NodeFilter.SHOW_TEXT, null), n, textA = 0, maxPt = 0, bands = {}, heads = 0;
      var seenHead = new Set();
      while ((n = tw.nextNode())) {
        if (!n.nodeValue.trim()) continue;
        var el = n.parentElement; if (!el || el.closest('svg')) continue;
        var ecs = getComputedStyle(el); if (ecs.display === 'none' || ecs.visibility === 'hidden') continue;
        var pt = parseFloat(ecs.fontSize) * 0.75;
        var isPlate = /Unifraktur/i.test(ecs.fontFamily);
        var rg = document.createRange(); rg.selectNodeContents(n);
        var rs = rg.getClientRects();
        for (var i = 0; i < rs.length; i++) {
          var r = rs[i];
          if (r.width <= 0 || r.height <= 0 || r.bottom < pr.top || r.top > pr.bottom || r.left > pr.right || r.right < pr.left) continue;
          textA += r.width * r.height;
          if (!isPlate && r.width > 40 && pt > maxPt) maxPt = pt;
          if (pt >= 7.5 && pt <= 11.5) { var k = Math.round((r.left - pr.left) / 29); bands[k] = (bands[k] || 0) + 1; }
        }
        if (!isPlate && pt >= 13 && !seenHead.has(el)) { seenHead.add(el); heads++; }
      }
      // a column of body text = a left edge that at least 12 lines share (neighbouring bins merged)
      var keys = Object.keys(bands).map(Number).sort(function (a, b) { return a - b; }), cols = 0, last = -9;
      keys.forEach(function (k) { if (bands[k] >= 12) { if (k - last > 1) cols++; last = k; } });
      var bg = cs.backgroundColor;
      out.push({ n: idx + 1, id: pg.id || '', cols: cols, maxPt: Math.round(maxPt), heads: heads, drawn: drawn,
        bigPic: big / area, pics: Math.min(1, pics / area), text: Math.min(1, textA / area), dark: lum(bg) < 0.3, bg: bg });
    });
    var pre = document.createElement('pre'); pre.id = 'shape-report'; pre.textContent = JSON.stringify(out);
    document.body.appendChild(pre);
  }
  function go() { try { run(); } catch (e) { var p = document.createElement('pre'); p.id = 'shape-report'; p.textContent = JSON.stringify({ error: String(e) }); document.body.appendChild(p); } }
  function later() { (document.fonts ? document.fonts.ready : Promise.resolve()).then(function () { setTimeout(go, 50); }); }
  if (document.readyState === 'complete') later(); else window.addEventListener('load', later);
})();

// measure-snippet.js — inline this in issue.html (inside a script element) . Runs only with ?measure=1.
// For every .page: for every .col inside it, find the deepest painted edge (element rects with visible
// borders/backgrounds/images/svg, and text-node line boxes) and report the gap to the column's bottom.
// Also reports content overflowing the page box, and empty columns.
// Declared air: a page, .col or .flow carrying data-air="<reason>" (or sitting inside one) is not
// measured for dead space. The reasons are reported back so the choice is on the record.
(function () {
  if (!/[?&]measure=1/.test(location.search)) return;
  function run() {
    var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
    var out = { pageW: 0, pageH: 0, pages: [] };
    pages.forEach(function (pg, idx) {
      var pr0 = pg.getBoundingClientRect();
      var pcs = getComputedStyle(pg);
      var pr = { left: pr0.left + (parseFloat(pcs.paddingLeft)||0), right: pr0.right - (parseFloat(pcs.paddingRight)||0), top: pr0.top + (parseFloat(pcs.paddingTop)||0), bottom: pr0.bottom - (parseFloat(pcs.paddingBottom)||0) };
      pr.width = pr.right - pr.left; pr.height = pr.bottom - pr.top;
      out.pageW = pr.width; out.pageH = pr.height;
      var pageAir = pg.hasAttribute('data-air');
      var airs = Array.prototype.slice.call(pg.querySelectorAll('[data-air]')).map(function (e) { return e.getAttribute('data-air') || '(no reason given)'; });
      if (pageAir) airs.unshift(pg.getAttribute('data-air') || '(no reason given)');
      var inAir = function (el) { return pageAir || !!el.closest('[data-air]'); };
      var cols = Array.prototype.slice.call(pg.querySelectorAll('.col')).filter(function (c) { return !inAir(c); });
      var pageDeep = pr.top;
      // collect painted rects within the page
      function collect(root) {
      var rects = [];
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) {
        if (node.nodeType === 3) {
          if (!node.nodeValue.trim()) continue;
          var range = document.createRange(); range.selectNodeContents(node);
          var rs = range.getClientRects();
          for (var i = 0; i < rs.length; i++) if (rs[i].width > 0 && rs[i].height > 0) rects.push({ left: rs[i].left, right: rs[i].right, top: rs[i].top, bottom: rs[i].bottom, txt: true });
        } else {
          var el = node; var tag = el.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE') continue;
          var cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          var painted = tag === 'IMG' || tag === 'SVG' || tag === 'HR' || tag === 'CANVAS' ||
            (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') ||
            (cs.backgroundImage && cs.backgroundImage !== 'none') ||
            (parseFloat(cs.borderBottomWidth) > 0 && cs.borderBottomStyle !== 'none') ||
            (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none');
          if (painted && !el.classList.contains('col') && !el.classList.contains('page') && !el.hasAttribute('data-nomeasure')) {
            var r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) rects.push(r);
          }
        }
      }
      return rects; }
      var rects = collect(pg);
      rects.forEach(function (r) { if (r.bottom > pageDeep) pageDeep = r.bottom; });
      var colReports = cols.map(function (col) {
        var cr = col.getBoundingClientRect();
        var colBottom = Math.min(cr.bottom, pr.bottom);
        var h = colBottom - cr.top;
        var deep = cr.top, any = false;
        rects.forEach(function (r) {
          var cx = (r.left + r.right) / 2;
          if (cx >= cr.left - 1 && cx <= cr.right + 1 && r.top >= cr.top - 1 && r.top < colBottom) {
            any = true; if (r.bottom > deep) deep = r.bottom;
          }
        });
        return { h: h, deep: deep - cr.top, gap: any ? colBottom - deep : h, empty: !any, label: col.getAttribute("data-label") || "" };
      });
      // multi-column flows: treat each CSS column as a virtual column
      var flows = Array.prototype.slice.call(pg.querySelectorAll('.flow')).filter(function (f) { return !inAir(f); });
      flows.forEach(function (fl, fi) {
        var fr = fl.getBoundingClientRect();
        var cs = getComputedStyle(fl);
        var n = parseInt(cs.columnCount, 10); if (!n || isNaN(n)) n = 1;
        var gapPx = parseFloat(cs.columnGap) || 0;
        var band = (fr.width - gapPx * (n - 1)) / n;
        var flBottom = Math.min(fr.bottom, pr.bottom);
        var ox = fl.scrollWidth - fl.clientWidth;
        var hid = 0; var frects = collect(fl);
        frects.forEach(function (r) {
          var cx = (r.left + r.right) / 2;
          if (r.txt && cx > fr.right + 1 && r.top >= fr.top - 1 && r.top < flBottom && r.bottom - fr.top > hid) hid = r.bottom - fr.top;
        });
        for (var b = 0; b < n; b++) {
          var left = fr.left + b * (band + gapPx), right = left + band;
          var deep = fr.top, any = false;
          rects.forEach(function (r) {
            var cx = (r.left + r.right) / 2;
            if (cx >= left - 1 && cx <= right + 1 && r.top >= fr.top - 1 && r.top < flBottom) {
              any = true; if (r.bottom > deep) deep = r.bottom;
            }
          });
          colReports.push({ h: flBottom - fr.top, deep: deep - fr.top, gap: any ? flBottom - deep : flBottom - fr.top, empty: !any, label: 'flow' + (fi + 1) + ':' + (b + 1), ox: ox, hid: hid, packed: fl.hasAttribute('data-pack') });
        }
      });
      var packs = Array.prototype.slice.call(pg.querySelectorAll('.flow[data-pack-report]')).map(function (f) { return f.getAttribute('data-pack-report'); });
      out.pages.push({ n: idx + 1, id: pg.id || '', overflow: Math.max(0, pageDeep - pr.bottom), cols: colReports, air: airs, packs: packs });
    });
    var pre = document.createElement('pre'); pre.id = 'fill-report'; pre.textContent = JSON.stringify(out);
    document.body.appendChild(pre);
  }
  function go() { try { run(); } catch(e) { var p=document.createElement("pre"); p.id="fill-report"; p.textContent=JSON.stringify({error:String(e), stack:String(e.stack)}); document.body.appendChild(p); } if (document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ var old=document.getElementById("fill-report"); if(old) old.remove(); run(); }); }
  if (document.readyState === "complete") go(); else window.addEventListener("load", go);
})();

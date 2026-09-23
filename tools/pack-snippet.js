// pack-snippet.js — deals fenced boxes into the columns of a multicolumn flow so that every box stays whole
// and the column feet come out as even as possible, then says how far each foot is from the bottom.
// build.js inlines it ahead of the measuring snippet. It acts only on a .flow carrying data-pack.
//
//   <div class="flow" data-pack>            CSS columns, column-fill:auto, a fixed height (flex:1 is fine)
//     <div class="nt" data-pack-first>…     optional: this box opens column 1
//     <div class="nt">…</div> …             the boxes: every other element child is one item, kept whole
//     <p data-filler>…</p> …                optional spares: short items it may drop into a column foot
//     <p data-pack-tail>…</p>               optional: stays last, at the foot of the last column
//   </div>
//
// Boxes keep their written order within a column. With few enough boxes every assignment is tried
// (columns^boxes up to two million); beyond that, or with data-pack="greedy", a balanced greedy start is
// improved by moves and swaps until nothing helps. Spares go, largest first, wherever they fit; unused
// spares are hidden. A box's bottom margin counts as a gutter between boxes, not as room it needs at the
// foot of a column. The flow gets data-pack-report, which fill.js prints, for example:
//   3 cols · boxes 4/4/3 · feet 0.22in, 0.12in, 0.12in · spares 0 of 3 · write: col1 +1 line (Answered Prayer, …)
// "write" names each column whose foot is a line or more short, and the boxes in it: add copy there, or
// cut it elsewhere. If the boxes cannot fit at all it says OVER and by how much. fill.js holds packed flows
// to 0.15in of air at the foot, not the 0.35in it allows running text.
(function () {
  var PX = 96, SLACK = 2;   // px kept free in every column: Chrome spills a column filled to the last fraction
  function fmt(px) { return px > 0 && px < PX / 200 ? '<0.01in' : (px / PX).toFixed(2) + 'in'; }
  function box(el) {
    var cs = getComputedStyle(el), mb = parseFloat(cs.marginBottom) || 0;
    return { h: el.getBoundingClientRect().height + (parseFloat(cs.marginTop) || 0) + mb, mb: mb };
  }
  function lineOf(flow) {
    var p = flow.querySelector('p') || flow, cs = getComputedStyle(p), lh = parseFloat(cs.lineHeight);
    return isNaN(lh) ? (parseFloat(cs.fontSize) || 12) * 1.25 : lh;
  }
  function title(el) {
    var t = el.querySelector('h1,h2,h3,h4,h5,b,strong'); t = (t ? t.textContent : el.textContent).replace(/\s+/g, ' ').trim();
    return t.length > 28 ? t.slice(0, 26) + '…' : t;
  }

  // Height a column's contents take: every box with its margins, less the bottom margin of the last one,
  // which has nothing under it. On the last column a tail follows, so no margin is given back there.
  function uses(asg, B, n, tailCol) {
    var sums = [], last = [];
    for (var c = 0; c < n; c++) { sums.push(0); last.push(-1); }
    for (var i = 0; i < asg.length; i++) { sums[asg[i]] += B[i].h; last[asg[i]] = i; }
    for (c = 0; c < n; c++) if (last[c] >= 0 && c !== tailCol) sums[c] -= B[last[c]].mb;
    return sums;
  }
  function cost(sums, cap) {
    var s = 0, over = 0;
    for (var c = 0; c < cap.length; c++) { var g = cap[c] - sums[c]; if (g < 0) over -= g; else s += g * g; }
    return over > 0 ? 1e12 + over : s;            // any fit beats every overflow
  }

  function search(B, n, cap, first, tailCol, greedy) {
    var k = B.length;
    if (!greedy && Math.pow(n, k) <= 2e6) {
      var best = null, bestCost = Infinity, a = new Array(k), total = Math.pow(n, k);
      for (var code = 0; code < total; code++) {
        var x = code;
        for (var i = 0; i < k; i++) { a[i] = x % n; x = (x - a[i]) / n; }
        if (first >= 0 && a[first] !== 0) continue;
        var v = cost(uses(a, B, n, tailCol), cap); if (v < bestCost) { bestCost = v; best = a.slice(); }
      }
      return best;
    }
    // greedy start: tallest first, each into the column with the most room left
    var order = B.map(function (b, i) { return i; }).sort(function (p, q) { return B[q].h - B[p].h || p - q; });
    var asg = new Array(k), room = cap.slice();
    if (first >= 0) { asg[first] = 0; room[0] -= B[first].h; }
    order.forEach(function (i) {
      if (i === first) return;
      var bc = 0; for (var c = 1; c < n; c++) if (room[c] > room[bc]) bc = c;
      asg[i] = bc; room[bc] -= B[i].h;
    });
    // improve by single moves and pairwise swaps until neither helps
    var now = cost(uses(asg, B, n, tailCol), cap), better = true, guard = 0;
    while (better && guard++ < 1000) {
      better = false;
      for (var i = 0; i < k && !better; i++) {
        if (i === first) continue;
        for (var c = 0; c < n && !better; c++) {
          if (c === asg[i]) continue;
          var was = asg[i]; asg[i] = c;
          var v = cost(uses(asg, B, n, tailCol), cap);
          if (v < now - 0.5) { now = v; better = true; } else asg[i] = was;
        }
        for (var j = i + 1; j < k && !better; j++) {
          if (j === first || asg[i] === asg[j]) continue;
          var t = asg[i]; asg[i] = asg[j]; asg[j] = t;
          var v2 = cost(uses(asg, B, n, tailCol), cap);
          if (v2 < now - 0.5) { now = v2; better = true; } else { asg[j] = asg[i]; asg[i] = t; }
        }
      }
    }
    return asg;
  }

  // A baked flow (data-pack-plan, written by tools/pack-bake.js from Chrome's own packing) is laid out as real side-by-side
  // columns, not CSS multicol with forced column breaks: Firefox ignores break-before:column, so there every box piled
  // into the first column and the flow grew off the page. The plan holds each box's written index (data-pack-order).
  function bake(flow, kids) {
    var plan; try { plan = JSON.parse(flow.getAttribute('data-pack-plan')); } catch (e) { return false; }
    var cs = getComputedStyle(flow), n = plan.cols.length, byIx = {};
    kids.forEach(function (el, i) { byIx[i] = el; });
    var gap = parseFloat(cs.columnGap); if (isNaN(gap)) gap = parseFloat(cs.fontSize) || 16; // 'normal' is 1em
    var rw = parseFloat(cs.columnRuleWidth) || 0, rs = cs.columnRuleStyle, rc = cs.columnRuleColor;
    flow.style.columns = 'auto'; flow.style.display = 'flex'; flow.style.flexDirection = 'row';
    flow.style.alignItems = 'stretch'; flow.style.columnGap = gap + 'px'; flow.style.rowGap = '0';
    plan.cols.forEach(function (list, c) {
      var w = document.createElement('div');
      w.className = 'pack-col';
      w.style.cssText = 'flex:1 1 0;min-width:0;position:relative;display:flow-root';
      if (c > 0 && rw > 0 && rs !== 'none' && rs !== 'hidden') {
        var r = document.createElement('div');
        r.style.cssText = 'position:absolute;top:0;bottom:0;left:' + (-(gap + rw) / 2) + 'px;border-left:' + rw + 'px ' + rs + ' ' + rc;
        w.appendChild(r);
      }
      list.forEach(function (ix) { var el = byIx[ix]; if (el) { el.style.breakBefore = ''; el.style.display = ''; w.appendChild(el); } });
      if (c === n - 1 && plan.tail != null && byIx[plan.tail]) w.appendChild(byIx[plan.tail]);
      flow.appendChild(w);
    });
    (plan.hide || []).forEach(function (ix) { if (byIx[ix]) byIx[ix].style.display = 'none'; });
    flow.setAttribute('data-pack-done', '');
    flow.setAttribute('data-pack-report', n + ' cols · boxes ' + plan.cols.map(function (l) { return l.length; }).join('/') +
      ' · baked (tools/pack-bake.js); run it with --clear before editing this page');
    return true;
  }

  function pack(flow) {
    if (flow.hasAttribute('data-pack-done')) return; // baked on the first pass; the fonts.ready pass has nothing to do
    var kids = Array.prototype.slice.call(flow.children).filter(function (el) { return el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE'; });
    if (flow.hasAttribute('data-pack-plan') && bake(flow, kids)) return;
    // remember the written order on the first pass, so a second pass (after fonts load) starts from it too
    kids.forEach(function (el, i) { if (!el.hasAttribute('data-pack-order')) el.setAttribute('data-pack-order', i); });
    kids.sort(function (p, q) { return p.getAttribute('data-pack-order') - q.getAttribute('data-pack-order'); });
    var tail = kids.filter(function (el) { return el.hasAttribute('data-pack-tail'); })[0] || null;
    var spares = kids.filter(function (el) { return el.hasAttribute('data-filler'); });
    var items = kids.filter(function (el) { return el !== tail && spares.indexOf(el) < 0; });
    if (!items.length) return;
    kids.forEach(function (el) { el.style.breakBefore = ''; if (el.hasAttribute('data-filler')) el.style.display = ''; });
    var n = parseInt(getComputedStyle(flow).columnCount, 10) || 1;
    var H = flow.clientHeight, line = lineOf(flow);
    var B = items.map(box), S = spares.map(box), T = tail ? box(tail) : null;
    spares.forEach(function (el) { el.style.display = 'none'; });
    var tailCol = T ? n - 1 : -1, cap = [];
    for (var c = 0; c < n; c++) cap.push(H - (c === tailCol ? T.h - T.mb : 0));
    var first = -1; items.forEach(function (el, i) { if (el.hasAttribute('data-pack-first')) first = i; });
    var fit = cap.map(function (v) { return v - SLACK; });
    var asg = search(B, n, fit, first, tailCol, flow.getAttribute('data-pack') === 'greedy');

    var cols = [], raw = [], lastMb = [];
    for (c = 0; c < n; c++) { cols.push([]); raw.push(0); lastMb.push(0); }
    items.forEach(function (el, i) { cols[asg[i]].push(el); raw[asg[i]] += B[i].h; lastMb[asg[i]] = B[i].mb; });
    function used(c) { return raw[c] - (c === tailCol ? 0 : lastMb[c]); }
    // spares: the largest that fits, into the column with the most room, until none fit
    var nUsed = 0, free = spares.map(function (el, i) { return i; });
    for (;;) {
      var pick = -1, col = -1;
      free.forEach(function (si) {
        for (var c = 0; c < n; c++) {
          var after = raw[c] + S[si].h - (c === tailCol ? 0 : S[si].mb);
          if (after <= fit[c] && (pick < 0 || S[si].h > S[pick].h || (S[si].h === S[pick].h && cap[c] - used(c) > cap[col] - used(col)))) { pick = si; col = c; }
        }
      });
      if (pick < 0) break;
      spares[pick].style.display = ''; cols[col].push(spares[pick]); raw[col] += S[pick].h; lastMb[col] = S[pick].mb; nUsed++;
      free.splice(free.indexOf(pick), 1);
    }
    // lay the flow out in column order, forcing a break at the head of every column after the first
    cols.forEach(function (list, c) {
      list.forEach(function (el, j) { el.style.breakBefore = (c > 0 && j === 0) ? 'column' : ''; flow.insertBefore(el, tail); });
    });
    if (tail) flow.appendChild(tail);

    var feet = [], write = [], over = 0;
    for (c = 0; c < n; c++) {
      var g = cap[c] - used(c); feet.push(g);
      if (g < SLACK) over += SLACK - g;
      else if (g >= line * 0.9) {
        var nl = Math.floor(g / line + 0.1);
        write.push('col' + (c + 1) + ' +' + nl + ' line' + (nl === 1 ? '' : 's') + ' (' +
          cols[c].filter(function (el) { return !el.hasAttribute('data-filler'); }).map(title).join(', ') + ')');
      }
    }
    var rep = n + ' cols · boxes ' + cols.map(function (l) { return l.filter(function (el) { return !el.hasAttribute('data-filler'); }).length; }).join('/') +
      ' · feet ' + feet.map(function (g) { return g < SLACK ? 'OVER ' + fmt(SLACK - g) : fmt(g); }).join(', ') +
      (spares.length ? ' · spares ' + nUsed + ' of ' + spares.length : '') +
      (over > 0 ? ' · OVER by ' + fmt(over) + (over < line ? ': cut a line anywhere, or add enough to move a box' : ': cut copy or move a box to another page')
                : write.length ? ' · write: ' + write.join('; ') : ' · every foot within a line');
    flow.setAttribute('data-pack-report', rep);
    if (window.console) console.log('[pack] ' + rep);
  }

  function all() {
    Array.prototype.forEach.call(document.querySelectorAll('.flow[data-pack]'), function (fl) {
      try { pack(fl); } catch (e) { fl.setAttribute('data-pack-report', 'pack failed: ' + e); }
    });
  }
  all();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(all);
})();

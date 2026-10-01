// font-fallback.js — build.js puts this before the packer. Chrome (the PDF) finds the narrow headline face by its
// family name, "Bahnschrift Condensed"; Firefox doesn't, and falls back to full-width Bahnschrift, so condensed
// headlines run 17% wide and boxes overflow in the HTML (Vol I No 11, p.3, 30 Sep 2026). Measured on this PC:
// Chrome's "Bahnschrift Condensed" and Firefox's Bahnschrift at font-stretch 87.5% set the same width (774.8 v
// 774.9). So where the condensed face is missing, every element asking for it gets Bahnschrift at 87.5%.
// In a browser that has the face it does nothing at all, so the PDF can't change.
(function () {
  var ctx = document.createElement('canvas').getContext('2d');
  var probe = 'CONCESSIONS ON RECORD 0123';
  var width = function (fam) { ctx.font = '700 40px ' + fam; return ctx.measureText(probe).width; };
  var base = width('monospace');
  var hasCondensed = Math.abs(width('"Bahnschrift Condensed", monospace') - base) > 0.5;
  var hasBahnschrift = Math.abs(width('Bahnschrift, monospace') - base) > 0.5;
  if (hasCondensed || !hasBahnschrift) return;
  var first = function (fam) { return String(fam).split(',')[0].replace(/["']/g, '').trim().toLowerCase(); };
  var narrow = { 'bahnschrift condensed': 1, 'bahnschrift semicondensed': 1 };
  var els = Array.prototype.slice.call(document.body.querySelectorAll('*'));
  // Record every element's stretch first: a narrowed element's children inherit 87.5%, and the ones that
  // asked for another face (plain Bahnschrift, say) get their own stretch put back afterwards.
  var before = els.map(function (el) { var cs = getComputedStyle(el); return { el: el, stretch: cs.fontStretch, hit: narrow[first(cs.fontFamily)] }; });
  before.forEach(function (r) { if (r.hit) { r.el.style.fontFamily = 'Bahnschrift, sans-serif'; r.el.style.fontStretch = '87.5%'; } });
  before.forEach(function (r) { if (!r.hit && getComputedStyle(r.el).fontStretch !== r.stretch) r.el.style.fontStretch = r.stretch; });
})();

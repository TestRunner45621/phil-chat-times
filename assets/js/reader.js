/*
 * reader.js — the edition viewer.
 *
 * Pages live in a plain scrolling container, one sized box each, so the browser
 * handles panning, momentum and scrollbars natively. On top of that:
 *
 *   - only pages near the viewport hold a canvas (the rest keep their box, so
 *     scroll offsets never jump)
 *   - zoom re-lays-out the boxes and redraws, anchored on whatever the pointer
 *     was over; every page is sized to land on whole device pixels and drawn
 *     at exactly that size, so its canvas is never resampled to fit
 *   - a selectable text layer sits over each canvas — built once, since it
 *     follows zoom on its own — and is switched off while the hand tool is
 *     active so a drag pans instead of selecting
 */

import * as pdfjsLib from '../../vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../../vendor/pdfjs/pdf.worker.min.mjs',
  import.meta.url
).toString();

const STANDARD_FONTS = new URL(
  '../../vendor/pdfjs/standard_fonts/',
  import.meta.url
).toString();

/*
 * Ceiling on one page's canvas. Below it a page is always drawn at exactly the
 * screen's own resolution; past it — deep zoom on a dense display — it is
 * drawn coarser and scaled up, which is the same thing browsers do to
 * oversized canvases, only deliberately. Matches the pdf.js viewer default.
 */
const MAX_CANVAS_PIXELS =
  (navigator.deviceMemory && navigator.deviceMemory <= 4 ? 8 : 16.7) * 1e6;

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

const $ = (id) => document.getElementById(id);

const el = {
  reader: $('reader'),
  viewport: $('viewport'),
  toolBtn: $('btn-tool'),
  toolLabel: $('tool-label'),
  toolIconPan: $('tool-icon-pan'),
  toolIconSelect: $('tool-icon-select'),
  pages: $('pages'),
  thumbs: $('thumbs'),
  select: $('edition-select'),
  pageInput: $('page-input'),
  pageTotal: $('page-total'),
  zoomLevel: $('btn-zoom-level'),
  prev: $('btn-prev'),
  next: $('btn-next'),
  zoomIn: $('btn-zoom-in'),
  zoomOut: $('btn-zoom-out'),
  thumbsBtn: $('btn-thumbs'),
  download: $('btn-download'),
  help: $('help'),
  helpBtn: $('btn-help'),
  helpClose: $('help-close'),
  loadbar: $('loadbar'),
  loadbarFill: $('loadbar-fill'),
  toast: $('toast'),
  findBtn: $('btn-find'),
  findBar: $('findbar'),
  findInput: $('find-input'),
  findCount: $('find-count'),
  findPrev: $('find-prev'),
  findNext: $('find-next'),
  findClose: $('find-close'),
};

const state = {
  manifest: null,
  edition: null,
  doc: null,
  pages: [], // { n, w, h, el, canvas, textEl, page, task, pendingPx }
  zoom: 1,
  fit: 'width', // 'width' | 'page' | null
  current: 1,
  loadingTask: null,
  token: 0, // bumps on every edition change; stale async work checks it
  thumbsOpen: false,
  thumbsDrawn: false,
  tool: 'pan', // 'pan' | 'select'
  find: {
    open: false,
    query: '',
    index: null, // per page: { text, starts } — see buildFindIndex
    indexing: null, // the promise while the index is being built
    matches: [], // { n, start, end } in reading order
    current: -1,
  },
};

/* ------------------------------------------------------------------ chrome */

let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 1400);
}

function progress(fraction) {
  if (fraction >= 1) {
    el.loadbarFill.style.width = '100%';
    setTimeout(() => {
      el.loadbar.hidden = true;
      el.loadbarFill.style.width = '0%';
    }, 260);
    return;
  }
  el.loadbar.hidden = false;
  el.loadbarFill.style.width = Math.max(3, fraction * 100) + '%';
}

/* -------------------------------------------------------------------- zoom */

function fitZoom(mode) {
  const first = state.pages[0];
  if (!first) return 1;
  const styles = getComputedStyle(el.pages);
  const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
  const availW = el.viewport.clientWidth - padX;
  const availH = el.viewport.clientHeight - padY;
  const byWidth = availW / first.w;
  if (mode === 'page') return Math.min(byWidth, availH / first.h);
  return byWidth;
}

/*
 * Remember what sits under a point in the viewport, in page-relative terms, so
 * the same spot can be put back under that point once the boxes are resized.
 * Fractions beat raw scroll maths here because the gaps and padding between
 * pages are fixed pixels and do not scale with zoom.
 */
function anchorAt(clientX, clientY) {
  const vpRect = el.viewport.getBoundingClientRect();
  const ax = clientX == null ? vpRect.width / 2 : clientX - vpRect.left;
  const ay = clientY == null ? vpRect.height / 2 : clientY - vpRect.top;

  const target = state.pages.find((p) => {
    const r = p.el.getBoundingClientRect();
    return clientY == null
      ? r.bottom - vpRect.top > ay
      : r.top - vpRect.top <= ay && r.bottom - vpRect.top >= ay;
  });
  const p = target || state.pages[currentIndex()] || state.pages[0];
  if (!p) return null;

  const r = p.el.getBoundingClientRect();
  return {
    n: p.n,
    fx: (ax - (r.left - vpRect.left)) / r.width,
    fy: (ay - (r.top - vpRect.top)) / r.height,
    ax,
    ay,
  };
}

function restoreAnchor(a) {
  if (!a) return;
  const p = state.pages[a.n - 1];
  if (!p) return;
  const vpRect = el.viewport.getBoundingClientRect();
  const r = p.el.getBoundingClientRect();
  const pageX = r.left - vpRect.left + el.viewport.scrollLeft;
  const pageY = r.top - vpRect.top + el.viewport.scrollTop;
  el.viewport.scrollLeft = pageX + a.fx * r.width - a.ax;
  el.viewport.scrollTop = pageY + a.fy * r.height - a.ay;
}

function setZoom(next, opts = {}) {
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
  if (Math.abs(clamped - state.zoom) < 0.0005) return;
  const anchor = anchorAt(opts.x, opts.y);
  state.zoom = clamped;
  if (!opts.keepFit) state.fit = null;
  layout();
  restoreAnchor(anchor);
  syncZoomUI();
  scheduleRender();
}

function applyFit(mode, opts = {}) {
  state.fit = mode;
  const anchor = opts.silent ? null : anchorAt();
  state.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitZoom(mode)));
  layout();
  if (anchor) restoreAnchor(anchor);
  syncZoomUI();
  scheduleRender();
}

function syncZoomUI() {
  el.zoomLevel.textContent =
    state.fit === 'width'
      ? 'Fit width'
      : state.fit === 'page'
        ? 'Fit page'
        : Math.round(state.zoom * 100) + '%';
  el.zoomIn.disabled = state.zoom >= MAX_ZOOM - 0.001;
  el.zoomOut.disabled = state.zoom <= MIN_ZOOM + 0.001;
}

/* ------------------------------------------------------------------ layout */

/*
 * Size for a page at this zoom, in both device and CSS pixels.
 *
 * The device size is chosen first and the CSS size derived from it, so a page
 * always occupies a whole number of physical pixels and its canvas maps onto
 * them 1:1. Sizing the other way round — round the CSS box, then scale it by
 * the pixel ratio — leaves the canvas a fraction of a pixel off the box it
 * sits in, and the compositor resamples the whole page to make up the
 * difference. That is what softens a page that was otherwise drawn correctly,
 * and it is invisible in the numbers because both sizes look right on their
 * own; only their ratio is wrong.
 *
 * Drawing finer than this and letting the browser scale down was measured and
 * is worse: the glyph rasteriser tunes its antialiasing to the pixel grid it
 * is given, and any resample afterwards throws that away.
 */
function pageMetrics(p, zoom) {
  const dpr = window.devicePixelRatio || 1;

  // How big the page appears: what the zoom asks for, snapped to whole device
  // pixels so a canvas can line up with it exactly.
  const shownW = Math.max(1, Math.round(p.w * zoom * dpr));
  const shownH = Math.max(1, Math.round(p.h * (shownW / p.w)));

  // How big the canvas is: the same, until that is more than a canvas should
  // hold. Only then do the two part company — the page keeps the size the zoom
  // asked for and is drawn coarser, rather than quietly refusing to enlarge.
  let deviceW = shownW;
  let deviceH = shownH;
  const px = deviceW * deviceH;
  if (px > MAX_CANVAS_PIXELS) {
    const k = Math.sqrt(MAX_CANVAS_PIXELS / px);
    deviceW = Math.max(1, Math.floor(deviceW * k));
    deviceH = Math.max(1, Math.floor(deviceH * k));
  }

  return {
    deviceW,
    deviceH,
    scale: deviceW / p.w, // device px per PDF point
    cssW: shownW / dpr,
    cssH: shownH / dpr,
  };
}

function layout() {
  for (const p of state.pages) {
    const m = pageMetrics(p, state.zoom);
    p.el.style.width = m.cssW + 'px';
    p.el.style.height = m.cssH + 'px';
    // The text layer scales off this, so give it the size the box actually
    // took, not the zoom that was asked for.
    p.el.style.setProperty('--scale-factor', String(m.cssW / p.w));
  }
  updateGrabbable();
}

function setTool(tool) {
  state.tool = tool;
  el.reader.dataset.tool = tool;
  const panning = tool === 'pan';
  el.toolBtn.setAttribute('aria-pressed', String(!panning));
  el.toolLabel.textContent = panning ? 'Drag' : 'Select';
  el.toolIconPan.hidden = !panning;
  el.toolIconSelect.hidden = panning;
}

function updateGrabbable() {
  const overflowing =
    el.viewport.scrollWidth > el.viewport.clientWidth + 1 ||
    el.viewport.scrollHeight > el.viewport.clientHeight + 1;
  el.viewport.classList.toggle('is-grabbable', overflowing);
}

/* --------------------------------------------------------------- rendering */

let renderTimer;
function scheduleRender(delay = 130) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderVisible, delay);
}

function pageIsNear(p, margin) {
  const vpRect = el.viewport.getBoundingClientRect();
  const r = p.el.getBoundingClientRect();
  const pad = vpRect.height * margin;
  return r.bottom > vpRect.top - pad && r.top < vpRect.bottom + pad;
}

/*
 * Render a screen and a half ahead in each direction, let go beyond three.
 * Nearest page first: after a zoom every live page needs redrawing, and the
 * one being read should come back sharp before the ones off screen.
 */
function renderVisible() {
  if (!state.doc) return;

  const vpRect = el.viewport.getBoundingClientRect();
  const mid = vpRect.top + vpRect.height / 2;
  const queue = [];

  for (const p of state.pages) {
    if (pageIsNear(p, 1.5)) queue.push(p);
    else if (!pageIsNear(p, 3)) releasePage(p);
  }

  queue.sort((a, b) => {
    const ra = a.el.getBoundingClientRect();
    const rb = b.el.getBoundingClientRect();
    return (
      Math.abs((ra.top + ra.bottom) / 2 - mid) -
      Math.abs((rb.top + rb.bottom) / 2 - mid)
    );
  });
  for (const p of queue) renderPage(p);
}

async function renderPage(p) {
  const token = state.token;
  const zoom = state.zoom;

  const m = pageMetrics(p, zoom);

  /*
   * Anything other than an exact match is redrawn, in both directions. A
   * canvas held over from a different zoom has to be stretched or squeezed to
   * fit, and that resample costs more sharpness than the redraw costs time —
   * the page on screen stays put until the new canvas is ready, so waiting for
   * it shows nothing worse than what is already there.
   */
  const matches = (px) => Math.abs(px - m.deviceW) <= 1;
  if (p.canvas && matches(p.canvas.width)) return;
  if (p.pendingPx && matches(p.pendingPx)) return;

  /*
   * A zoom gesture fires these faster than they finish, so each attempt takes
   * a ticket. Cancelling a render rejects its promise a turn later, by which
   * point a newer attempt owns the page — without the ticket that late
   * rejection would clear the newer attempt's bookkeeping and let a
   * stale-resolution canvas win the swap.
   */
  const gen = (p.gen = (p.gen || 0) + 1);
  if (p.task) p.task.cancel();
  p.task = null;
  p.pendingPx = m.deviceW;

  try {
    if (!p.page) p.page = await state.doc.getPage(p.n);
    if (gen !== p.gen || token !== state.token) return;

    const viewport = p.page.getViewport({ scale: m.scale });

    const canvas = document.createElement('canvas');
    canvas.width = m.deviceW;
    canvas.height = m.deviceH;
    const ctx = canvas.getContext('2d', { alpha: false });

    const task = p.page.render({ canvasContext: ctx, viewport });
    p.task = task;
    await task.promise;
    if (gen !== p.gen || token !== state.token) return;
    p.task = null;

    // Swap in one go so the page never flashes blank mid-zoom.
    if (p.canvas) p.canvas.remove();
    const skel = p.el.querySelector('.pdf-page__skel');
    if (skel) skel.remove();
    p.el.insertBefore(canvas, p.el.firstChild);
    p.canvas = canvas;
    p.pendingPx = null;

    // The text layer positions itself off --scale-factor, so it follows zoom
    // on its own and only ever needs building once per page.
    if (!p.textEl) buildTextLayer(p, token);
  } catch (err) {
    if (gen !== p.gen) return; // superseded; the newer attempt owns the page
    p.task = null;
    p.pendingPx = null;
    if (err && err.name !== 'RenderingCancelledException') {
      console.warn('page ' + p.n + ' failed to render:', err);
    }
  }
}

async function buildTextLayer(p, token) {
  try {
    const container = document.createElement('div');
    container.className = 'textLayer';
    p.el.appendChild(container);

    // Built at scale 1: every span is placed in percentages and
    // calc(var(--scale-factor) * …), so the layer tracks zoom by itself.
    const layer = new pdfjsLib.TextLayer({
      textContentSource: p.page.streamTextContent(),
      container,
      viewport: p.page.getViewport({ scale: 1 }),
    });
    await layer.render();
    if (token !== state.token) {
      container.remove();
      return;
    }
    p.textEl = container;
    // One span per text item, in the order getTextContent() yields them, so
    // a match found in the index can be painted onto the right span later.
    p.textDivs = layer.textDivs;
    p.textStrs = layer.textContentItemsStr;
    paintHits(p);
  } catch {
    /* selection is a bonus; a failure here must not break the page */
  }
}

function releasePage(p) {
  // Bump the ticket too, so a render still in flight cannot hand a canvas
  // back to a page that has just been let go.
  p.gen = (p.gen || 0) + 1;
  if (p.task) {
    p.task.cancel();
    p.task = null;
  }
  if (p.canvas) {
    p.canvas.remove();
    p.canvas = null;
  }
  if (p.textEl) {
    p.textEl.remove();
    p.textEl = null;
    p.textDivs = null;
    p.textStrs = null;
  }
  if (!p.el.querySelector('.pdf-page__skel')) {
    const skel = document.createElement('div');
    skel.className = 'pdf-page__skel';
    p.el.insertBefore(skel, p.el.firstChild);
  }
  p.pendingPx = null;
}

/* ------------------------------------------------------------------- find */

/*
 * Ctrl+F. The browser's find only sees the text layers that exist, and only
 * the pages around the viewport have one, so a search for a name on page 19
 * from page 2 finds nothing. This indexes every page's text once per edition
 * (getTextContent is cheap; it is the same stream the text layer is built
 * from), searches that, and paints the hits into whichever text layers are on
 * screen — including ones built later, when the reader scrolls to them.
 *
 * Items are joined with no separator and a newline on hasEOL, which is what
 * pdf.js's own find controller does: an item carries its own spaces, and a
 * word split across two items (a bold name mid-sentence) stays one word.
 */

async function buildFindIndex() {
  const f = state.find;
  if (f.index || f.indexing) return f.indexing;
  const token = state.token;
  const doc = state.doc;
  f.indexing = (async () => {
    const index = [];
    for (let n = 1; n <= doc.numPages; n++) {
      if (token !== state.token) return null;
      const page = state.pages[n - 1].page || (await doc.getPage(n));
      const tc = await page.getTextContent();
      if (token !== state.token) return null;
      let text = '';
      const starts = [];
      for (const item of tc.items) {
        if (item.str === undefined) continue; // marked content, no span
        starts.push(text.length);
        text += item.str;
        if (item.hasEOL) text += '\n';
      }
      index.push({ text, starts });
    }
    if (token !== state.token) return null;
    f.index = index;
    f.indexing = null;
    return index;
  })();
  return f.indexing;
}

function findPattern(query) {
  const q = query.trim();
  if (!q) return null;
  // Whitespace in the query matches any run of whitespace, including the
  // newline that stands in for a line break; everything else is literal.
  const src = q
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  return new RegExp(src, 'gi');
}

async function runFind(query) {
  const f = state.find;
  f.query = query;
  if (!state.doc) return;
  const token = state.token;

  const pattern = findPattern(query);
  if (!pattern) {
    f.matches = [];
    f.current = -1;
    repaintAllHits();
    syncFindUI();
    return;
  }

  if (!f.index) {
    el.findCount.textContent = 'indexing…';
    el.findCount.classList.remove('is-none');
    await buildFindIndex();
    if (token !== state.token || f.query !== query) return;
  }

  const matches = [];
  f.index.forEach((pg, i) => {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(pg.text))) {
      if (m[0].length === 0) {
        pattern.lastIndex++;
        continue;
      }
      matches.push({ n: i + 1, start: m.index, end: m.index + m[0].length });
    }
  });
  f.matches = matches;

  // Start from the first hit at or after the page being read, so a search
  // continues from where the reader is rather than flinging them to page 1.
  let first = matches.findIndex((m) => m.n >= state.current);
  if (first === -1) first = matches.length ? 0 : -1;
  f.current = first;
  repaintAllHits();
  syncFindUI();
  if (first !== -1) revealMatch(matches[first]);
}

function stepFind(dir) {
  const f = state.find;
  if (!f.matches.length) return;
  f.current = (f.current + dir + f.matches.length) % f.matches.length;
  repaintAllHits();
  syncFindUI();
  revealMatch(f.matches[f.current]);
}

function syncFindUI() {
  const f = state.find;
  if (!f.query.trim()) {
    el.findCount.textContent = '';
    el.findCount.classList.remove('is-none');
  } else if (!f.matches.length) {
    el.findCount.textContent = 'no matches';
    el.findCount.classList.add('is-none');
  } else {
    el.findCount.textContent = f.current + 1 + ' of ' + f.matches.length;
    el.findCount.classList.remove('is-none');
  }
  const none = !f.matches.length;
  el.findPrev.disabled = none;
  el.findNext.disabled = none;
}

/*
 * Paint this page's hits into its text layer: each span that the match runs
 * through gets the matched slice wrapped in a highlight, the rest of its text
 * left as plain text nodes. Spans are restored from the layer's own copy of
 * the strings first, so repainting is idempotent.
 */
function paintHits(p) {
  const f = state.find;
  if (!p.textDivs || !p.textStrs) return;
  const index = f.index && f.index[p.n - 1];

  if (p.painted) {
    for (const i of p.painted) {
      if (p.textDivs[i]) p.textDivs[i].textContent = p.textStrs[i];
    }
    p.painted = null;
  }
  if (!index || !f.matches.length || !f.query.trim()) return;

  const hits = f.matches.filter((m) => m.n === p.n);
  if (!hits.length) return;

  const { starts } = index;
  const lengths = starts.map((s, i) => (p.textStrs[i] || '').length);
  // Per span: the highlighted ranges, as [from, to, current] in span-local
  // offsets. A match can straddle several spans.
  const ranges = new Map();
  hits.forEach((m) => {
    const current = f.matches[f.current] === m;
    for (let i = 0; i < starts.length; i++) {
      const s0 = starts[i];
      const s1 = s0 + lengths[i];
      if (s1 <= m.start) continue;
      if (s0 >= m.end) break;
      const from = Math.max(0, m.start - s0);
      const to = Math.min(lengths[i], m.end - s0);
      if (to <= from) continue;
      if (!ranges.has(i)) ranges.set(i, []);
      ranges.get(i).push([from, to, current]);
    }
  });

  p.painted = [];
  for (const [i, list] of ranges) {
    const div = p.textDivs[i];
    const str = p.textStrs[i];
    if (!div || str === undefined) continue;
    list.sort((a, b) => a[0] - b[0]);
    div.textContent = '';
    let at = 0;
    for (const [from, to, current] of list) {
      if (from > at) div.append(document.createTextNode(str.slice(at, from)));
      const mark = document.createElement('span');
      mark.className = 'find-hit' + (current ? ' is-current' : '');
      mark.textContent = str.slice(from, to);
      div.append(mark);
      at = to;
    }
    if (at < str.length) div.append(document.createTextNode(str.slice(at)));
    p.painted.push(i);
  }
}

function repaintAllHits() {
  for (const p of state.pages) if (p.textEl) paintHits(p);
}

/*
 * Bring a match on screen. The page is scrolled to first; its text layer may
 * not exist yet (it is built after the canvas, which is rendered on demand),
 * so the fine scroll to the hit itself waits for the layer to appear.
 */
function revealMatch(m) {
  const p = state.pages[m.n - 1];
  if (!p) return;
  const token = state.token;
  const target = m;
  if (state.current !== m.n) goToPage(m.n, { resetX: true });
  renderVisible();

  const tries = 40;
  const attempt = (left) => {
    if (token !== state.token || state.find.matches[state.find.current] !== target) return;
    const hit = p.textEl && p.textEl.querySelector('.find-hit.is-current');
    if (hit) {
      const vp = el.viewport.getBoundingClientRect();
      const r = hit.getBoundingClientRect();
      // Centre the hit, but only scroll if it is not already comfortably in
      // view — stepping through hits on one page should not bounce the page.
      const margin = 60;
      if (r.top < vp.top + margin || r.bottom > vp.bottom - margin) {
        el.viewport.scrollTop += r.top + r.height / 2 - (vp.top + vp.height / 2);
      }
      if (r.left < vp.left + margin || r.right > vp.right - margin) {
        el.viewport.scrollLeft += r.left + r.width / 2 - (vp.left + vp.width / 2);
      }
      syncPage();
      return;
    }
    if (left > 0) setTimeout(() => attempt(left - 1), 75);
  };
  attempt(tries);
}

function openFind() {
  const f = state.find;
  f.open = true;
  el.findBar.hidden = false;
  el.findBtn.setAttribute('aria-pressed', 'true');
  el.findInput.focus();
  el.findInput.select();
  if (!f.index && state.doc) buildFindIndex();
}

function closeFind() {
  const f = state.find;
  f.open = false;
  f.query = '';
  f.matches = [];
  f.current = -1;
  el.findBar.hidden = true;
  el.findBtn.setAttribute('aria-pressed', 'false');
  el.findInput.value = '';
  repaintAllHits();
  syncFindUI();
  el.viewport.focus({ preventScroll: true });
}

/* A new edition means a new index; the bar stays open and re-runs the query. */
function resetFind() {
  const f = state.find;
  f.index = null;
  f.indexing = null;
  f.matches = [];
  f.current = -1;
  for (const p of state.pages) p.painted = null;
  syncFindUI();
}

function bindFind() {
  el.findBtn.addEventListener('click', () => {
    if (state.find.open) closeFind();
    else openFind();
  });
  el.findClose.addEventListener('click', closeFind);
  el.findPrev.addEventListener('click', () => stepFind(-1));
  el.findNext.addEventListener('click', () => stepFind(1));

  let typeTick;
  el.findInput.addEventListener('input', () => {
    clearTimeout(typeTick);
    typeTick = setTimeout(() => runFind(el.findInput.value), 160);
  });
  el.findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(typeTick);
      if (el.findInput.value !== state.find.query) runFind(el.findInput.value);
      else stepFind(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    }
    // Everything else is left alone so the input behaves like an input; the
    // document-level shortcuts already ignore keys typed into a field.
  });
}

/* ---------------------------------------------------------------- paging */

function currentIndex() {
  const vpRect = el.viewport.getBoundingClientRect();
  const mid = vpRect.top + vpRect.height * 0.4;
  let best = 0;
  let bestDist = Infinity;
  state.pages.forEach((p, i) => {
    const r = p.el.getBoundingClientRect();
    if (r.top <= mid && r.bottom >= mid) {
      best = i;
      bestDist = -1;
      return;
    }
    if (bestDist === -1) return;
    const d = Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

function goToPage(n, opts = {}) {
  const p = state.pages[Math.min(state.pages.length, Math.max(1, n)) - 1];
  if (!p) return;
  const vpRect = el.viewport.getBoundingClientRect();
  const r = p.el.getBoundingClientRect();
  el.viewport.scrollTop += r.top - vpRect.top - 20;
  if (opts.resetX) el.viewport.scrollLeft = 0;
  syncPage();
  scheduleRender(60);
}

function syncPage() {
  const n = currentIndex() + 1;
  if (n === state.current) return;
  state.current = n;
  if (document.activeElement !== el.pageInput) el.pageInput.value = String(n);
  el.prev.disabled = n <= 1;
  el.next.disabled = n >= state.pages.length;
  markThumb(n);
  const hash = '#/' + state.edition.slug + '/' + n;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

/* ------------------------------------------------------------- thumbnails */

function buildThumbs() {
  el.thumbs.innerHTML = '';
  state.pages.forEach((p) => {
    const btn = document.createElement('button');
    btn.className = 'thumb';
    btn.dataset.page = String(p.n);
    const shot = document.createElement('div');
    shot.className = 'thumb__shot';
    shot.style.aspectRatio = p.w + ' / ' + p.h;
    const label = document.createElement('span');
    label.className = 'thumb__label';
    label.textContent = String(p.n);
    btn.appendChild(shot);
    btn.appendChild(label);
    btn.addEventListener('click', () => goToPage(p.n, { resetX: true }));
    el.thumbs.appendChild(btn);
    p.thumbShot = shot;
  });
  state.thumbsDrawn = false;
  markThumb(state.current);
}

/* Thumbs render one at a time, behind the main pages, so opening the strip on
 * a 25-page issue never stalls the reader. */
async function drawThumbs() {
  if (state.thumbsDrawn) return;
  state.thumbsDrawn = true;
  const token = state.token;
  for (const p of state.pages) {
    if (token !== state.token) return;
    if (p.thumbDone) continue;
    try {
      const page = p.page || (await state.doc.getPage(p.n));
      if (token !== state.token) return;
      const scale = 150 / p.w;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport })
        .promise;
      if (token !== state.token) return;
      p.thumbShot.innerHTML = '';
      p.thumbShot.appendChild(canvas);
      p.thumbDone = true;
    } catch {
      /* a missing thumbnail is cosmetic */
    }
    await new Promise((r) => setTimeout(r, 0));
  }
}

function markThumb(n) {
  const nodes = el.thumbs.querySelectorAll('.thumb');
  nodes.forEach((node) => {
    const on = Number(node.dataset.page) === n;
    node.classList.toggle('is-current', on);
    if (on && state.thumbsOpen) {
      const r = node.getBoundingClientRect();
      const cr = el.thumbs.getBoundingClientRect();
      if (r.top < cr.top || r.bottom > cr.bottom) {
        node.scrollIntoView({ block: 'nearest' });
      }
    }
  });
}

function toggleThumbs(force) {
  state.thumbsOpen = force === undefined ? !state.thumbsOpen : force;
  el.thumbs.hidden = !state.thumbsOpen;
  el.thumbsBtn.setAttribute('aria-pressed', String(state.thumbsOpen));
  if (state.thumbsOpen) {
    drawThumbs();
    markThumb(state.current);
  }
  if (state.fit) applyFit(state.fit);
}

/* ------------------------------------------------------- loading editions */

async function openEdition(slug, page) {
  const ed =
    state.manifest.editions.find((e) => e.slug === slug) ||
    state.manifest.editions[state.manifest.editions.length - 1];
  if (!ed) return;

  const token = ++state.token;

  if (state.loadingTask) {
    try {
      await state.loadingTask.destroy();
    } catch {
      /* already gone */
    }
  }
  for (const p of state.pages) releasePage(p);

  state.edition = ed;
  state.pages = [];
  resetFind();
  state.current = 0;
  state.thumbsDrawn = false;
  el.pages.innerHTML = '';
  el.thumbs.innerHTML = '';
  el.select.value = ed.slug;
  el.download.href = ed.pdf;
  el.download.setAttribute(
    'download',
    'The Phil Chat Times - ' + ed.title + ' - ' + ed.date + '.pdf'
  );
  document.title = ed.title + ' — The Phil Chat Times';
  progress(0.02);

  const task = pdfjsLib.getDocument({
    url: ed.pdf,
    standardFontDataUrl: STANDARD_FONTS,
  });
  state.loadingTask = task;
  task.onProgress = ({ loaded, total }) => {
    if (token === state.token) progress(total ? loaded / total : 0.4);
  };

  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    if (token !== state.token) return;
    progress(1);
    toast('Could not open this edition');
    console.error(err);
    return;
  }
  if (token !== state.token) return;

  state.doc = doc;
  el.pageTotal.textContent = String(doc.numPages);

  // Measure every page up front so all the boxes are correctly sized before a
  // single one renders — that is what keeps scrolling stable.
  const first = await doc.getPage(1);
  const firstVp = first.getViewport({ scale: 1 });
  for (let n = 1; n <= doc.numPages; n++) {
    const box = document.createElement('div');
    box.className = 'pdf-page';
    const skel = document.createElement('div');
    skel.className = 'pdf-page__skel';
    box.appendChild(skel);
    const num = document.createElement('span');
    num.className = 'pdf-page__num';
    num.textContent = n + ' / ' + doc.numPages;
    box.appendChild(num);
    el.pages.appendChild(box);
    state.pages.push({
      n,
      w: firstVp.width,
      h: firstVp.height,
      el: box,
      canvas: null,
      textEl: null,
      page: n === 1 ? first : null,
      task: null,
      pendingPx: null,
    });
  }

  // Then correct any page whose size differs from page 1 (rare, but a spread
  // or an insert would otherwise sit in a wrongly sized box).
  (async () => {
    for (let n = 2; n <= doc.numPages; n++) {
      if (token !== state.token) return;
      const pg = await doc.getPage(n);
      if (token !== state.token) return;
      const vp = pg.getViewport({ scale: 1 });
      const p = state.pages[n - 1];
      p.page = pg;
      if (Math.abs(vp.width - p.w) > 0.5 || Math.abs(vp.height - p.h) > 0.5) {
        p.w = vp.width;
        p.h = vp.height;
        p.el.style.width = Math.round(p.w * state.zoom) + 'px';
        p.el.style.height = Math.round(p.h * state.zoom) + 'px';
      }
    }
  })();

  buildThumbs();
  applyFit(state.fit || 'width', { silent: true });
  progress(1);

  goToPage(page || 1, { resetX: true });
  state.current = 0;
  syncPage();
  renderVisible();
  if (state.thumbsOpen) drawThumbs();
  if (state.find.open) {
    const q = el.findInput.value;
    if (q.trim()) runFind(q);
    else buildFindIndex();
  }
}

/* -------------------------------------------------------------- pan + zoom */

function bindPanning() {
  let panning = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let pointerId = null;

  el.viewport.addEventListener('pointerdown', (e) => {
    // Touch drags are left to the scroll container, which pans them with
    // momentum; taking them over here would scroll everything twice as fast.
    if (e.pointerType === 'touch') return;
    if (e.button !== 0 && e.button !== 1) return;
    if (pinch.active) return;
    // Middle-drag pans regardless of tool; a left-drag only pans when the text
    // layer is inert, which is exactly when the drag tool is active.
    if (state.tool === 'select' && e.button === 0) return;
    panning = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = el.viewport.scrollLeft;
    startTop = el.viewport.scrollTop;
    el.viewport.classList.add('is-grabbing');
    el.viewport.setPointerCapture(e.pointerId);
  });

  el.viewport.addEventListener('pointermove', (e) => {
    if (!panning || e.pointerId !== pointerId || pinch.active) return;
    el.viewport.scrollLeft = startLeft - (e.clientX - startX);
    el.viewport.scrollTop = startTop - (e.clientY - startY);
  });

  const end = (e) => {
    if (!panning || (pointerId !== null && e.pointerId !== pointerId)) return;
    panning = false;
    pointerId = null;
    el.viewport.classList.remove('is-grabbing');
    scheduleRender(80);
  };
  el.viewport.addEventListener('pointerup', end);
  el.viewport.addEventListener('pointercancel', end);

  // Double-click steps in on the spot, and back out to the previous fit.
  el.viewport.addEventListener('dblclick', (e) => {
    if (state.fit) setZoom(Math.max(state.zoom * 2, 1.6), { x: e.clientX, y: e.clientY });
    else applyFit('width');
  });
}

/* Ctrl/⌘ + wheel and trackpad pinch both arrive as wheel events with ctrlKey
 * set; plain wheel is left to the scroll container. */
function bindWheelZoom() {
  el.viewport.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0022);
      setZoom(state.zoom * factor, { x: e.clientX, y: e.clientY });
    },
    { passive: false }
  );
}

const pinch = { active: false, points: new Map(), startDist: 0, startZoom: 1 };

function bindPinch() {
  const vp = el.viewport;

  vp.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    pinch.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.points.size === 2) {
      const [a, b] = [...pinch.points.values()];
      pinch.active = true;
      pinch.startDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      pinch.startZoom = state.zoom;
      vp.classList.remove('is-grabbing');
    }
  });

  vp.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'touch' || !pinch.points.has(e.pointerId)) return;
      pinch.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!pinch.active || pinch.points.size < 2) return;
      e.preventDefault();
      const [a, b] = [...pinch.points.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      setZoom(pinch.startZoom * (dist / pinch.startDist), {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      });
    },
    { passive: false }
  );

  const drop = (e) => {
    if (e.pointerType !== 'touch') return;
    pinch.points.delete(e.pointerId);
    if (pinch.points.size < 2 && pinch.active) {
      pinch.active = false;
      scheduleRender(80);
    }
  };
  vp.addEventListener('pointerup', drop);
  vp.addEventListener('pointercancel', drop);
}

/* ------------------------------------------------------------------- wiring */

function bindChrome() {
  el.prev.addEventListener('click', () =>
    goToPage(state.current - 1, { resetX: true })
  );
  el.next.addEventListener('click', () =>
    goToPage(state.current + 1, { resetX: true })
  );

  el.zoomIn.addEventListener('click', () => setZoom(state.zoom * 1.25));
  el.zoomOut.addEventListener('click', () => setZoom(state.zoom / 1.25));
  el.zoomLevel.addEventListener('click', cycleFit);

  el.thumbsBtn.addEventListener('click', () => toggleThumbs());
  el.toolBtn.addEventListener('click', () => {
    setTool(state.tool === 'pan' ? 'select' : 'pan');
    toast(state.tool === 'pan' ? 'Drag to move the page' : 'Drag to select text');
  });

  el.pageInput.addEventListener('focus', () => el.pageInput.select());
  el.pageInput.addEventListener('change', commitPageInput);
  el.pageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commitPageInput();
      el.pageInput.blur();
    }
  });

  el.select.addEventListener('change', () => {
    location.hash = '#/' + el.select.value + '/1';
  });

  el.helpBtn.addEventListener('click', () => (el.help.hidden = false));
  el.helpClose.addEventListener('click', () => (el.help.hidden = true));
  el.help.addEventListener('click', (e) => {
    if (e.target === el.help) el.help.hidden = true;
  });

  let scrollTick;
  el.viewport.addEventListener(
    'scroll',
    () => {
      syncPage();
      clearTimeout(scrollTick);
      scrollTick = setTimeout(renderVisible, 90);
    },
    { passive: true }
  );

  let resizeTick;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTick);
    resizeTick = setTimeout(() => {
      if (state.fit) applyFit(state.fit);
      else {
        layout();
        scheduleRender();
      }
    }, 120);
  });

  window.addEventListener('hashchange', routeFromHash);
}

function commitPageInput() {
  const n = parseInt(el.pageInput.value, 10);
  if (!isNaN(n) && n >= 1 && n <= state.pages.length) {
    goToPage(n, { resetX: true });
  } else {
    el.pageInput.value = String(state.current);
  }
}

function cycleFit() {
  const next =
    state.fit === 'width' ? 'page' : state.fit === 'page' ? null : 'width';
  if (next) {
    applyFit(next);
    toast(next === 'width' ? 'Fit width' : 'Fit page');
  } else {
    setZoom(1);
    toast('100%');
  }
}

function bindKeys() {
  document.addEventListener('keydown', (e) => {
    // Find is taken over wherever the focus is: the browser's own would only
    // search the handful of pages that currently hold a text layer.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      openFind();
      return;
    }
    if (e.key === 'F3' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (state.find.open && state.find.matches.length) stepFind(e.shiftKey ? -1 : 1);
      else openFind();
      return;
    }

    const typing =
      e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT';
    if (typing && e.key !== 'Escape') return;

    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
        e.preventDefault();
        goToPage(state.current + 1, { resetX: true });
        break;
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault();
        goToPage(state.current - 1, { resetX: true });
        break;
      case 'Home':
        e.preventDefault();
        goToPage(1, { resetX: true });
        break;
      case 'End':
        e.preventDefault();
        goToPage(state.pages.length, { resetX: true });
        break;
      case '+':
      case '=':
        e.preventDefault();
        setZoom(state.zoom * 1.25);
        break;
      case '-':
      case '_':
        e.preventDefault();
        setZoom(state.zoom / 1.25);
        break;
      case 'f':
      case 'F':
        cycleFit();
        break;
      case 't':
      case 'T':
        toggleThumbs();
        break;
      case 's':
      case 'S':
        setTool(state.tool === 'pan' ? 'select' : 'pan');
        break;
      case '?':
        el.help.hidden = false;
        break;
      case 'Escape':
        if (!el.help.hidden) el.help.hidden = true;
        else if (state.find.open) closeFind();
        if (e.target.blur) e.target.blur();
        break;
    }
  });
}

/* ------------------------------------------------------------------ routing */

function parseHash() {
  const m = location.hash.match(/^#\/([a-z0-9-]+)(?:\/(\d+))?/i);
  return m ? { slug: m[1], page: m[2] ? parseInt(m[2], 10) : 1 } : null;
}

function routeFromHash() {
  const route = parseHash();
  if (!route) return;
  if (state.edition && route.slug === state.edition.slug) {
    if (route.page !== state.current) goToPage(route.page, { resetX: true });
    return;
  }
  openEdition(route.slug, route.page);
}

/* --------------------------------------------------------------------- boot */

async function boot() {
  setTool('pan');
  bindChrome();
  bindKeys();
  bindFind();
  bindPanning();
  bindWheelZoom();
  bindPinch();

  let manifest;
  try {
    const res = await fetch('editions.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    manifest = await res.json();
  } catch (err) {
    toast('Could not load the archive');
    console.error(err);
    return;
  }

  state.manifest = manifest;
  const list = manifest.editions.slice().reverse();
  for (const ed of list) {
    const opt = document.createElement('option');
    opt.value = ed.slug;
    opt.textContent = ed.title + ' · ' + ed.date;
    el.select.appendChild(opt);
  }

  const route = parseHash();
  await openEdition(route ? route.slug : list[0].slug, route ? route.page : 1);
}

boot();

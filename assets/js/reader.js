/*
 * reader.js — the edition viewer.
 *
 * Pages live in a plain scrolling container, one sized box each, so the browser
 * handles panning, momentum and scrollbars natively. On top of that:
 *
 *   - only pages near the viewport hold a canvas (the rest keep their box, so
 *     scroll offsets never jump)
 *   - zoom re-lays-out the boxes and redraws, anchored on whatever the pointer
 *     was over; pages are rasterised finer than the screen strictly needs, so
 *     small type survives being shown small, and a canvas that already holds
 *     enough detail is reused rather than redrawn
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
 * Rasterise at twice the screen's own pixel density and let the browser scale
 * the result down. Newsprint is set in 8pt type on hairline rules, and drawing
 * that at 1:1 makes a mess of it — stems merge, counters fill in, and the
 * whole column goes muddy. Rendering finer and downsampling is what keeps a
 * zoomed-out page legible. Chrome's CSS downscale is as good here as doing the
 * resample by hand, so the oversized canvas simply goes straight into the DOM.
 *
 * 3x was measured too: indistinguishable from 2x, at 2.25x the memory.
 */
const SUPERSAMPLE = 2;

/*
 * Ceiling on one page's canvas. Sized so the views people actually sit at —
 * fit width and fit page — get the full supersample, while deep zoom gives
 * some of it back; by then the type is large on screen and needs it least.
 * Past the ceiling the page is drawn below the ideal resolution rather than
 * failing outright, which is what browsers do to oversized canvases anyway.
 */
const MAX_CANVAS_PIXELS =
  (navigator.deviceMemory && navigator.deviceMemory <= 4 ? 6 : 12) * 1e6;

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

function layout() {
  for (const p of state.pages) {
    p.el.style.width = Math.round(p.w * state.zoom) + 'px';
    p.el.style.height = Math.round(p.h * state.zoom) + 'px';
    p.el.style.setProperty('--scale-factor', String(state.zoom));
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

/*
 * Device pixels to draw per CSS pixel for a page of this on-screen size:
 * the screen's density times the supersample, trimmed back if that would
 * exceed what a canvas can reasonably hold.
 */
function outputScaleFor(cssW, cssH) {
  let scale = (window.devicePixelRatio || 1) * SUPERSAMPLE;
  const area = cssW * cssH;
  if (area * scale * scale > MAX_CANVAS_PIXELS) {
    scale = Math.sqrt(MAX_CANVAS_PIXELS / area);
  }
  return Math.max(scale, 0.05);
}

function pageIsNear(p, margin) {
  const vpRect = el.viewport.getBoundingClientRect();
  const r = p.el.getBoundingClientRect();
  const pad = vpRect.height * margin;
  return r.bottom > vpRect.top - pad && r.top < vpRect.bottom + pad;
}

/*
 * Render a screen's worth ahead in each direction and let go two and a half
 * screens out. Supersampled canvases cost four times the pixels of a plain
 * one, so the live set has to stay small — at fit-width that is a couple of
 * pages, which is still far enough ahead that scrolling never catches up with
 * the renderer.
 */
function renderVisible() {
  if (!state.doc) return;
  for (const p of state.pages) {
    if (pageIsNear(p, 1)) renderPage(p);
    else if (!pageIsNear(p, 2.5)) releasePage(p);
  }
}

async function renderPage(p) {
  const token = state.token;
  const zoom = state.zoom;

  const cssW = p.w * zoom;
  const cssH = p.h * zoom;
  const wantPx = Math.round(cssW * outputScaleFor(cssW, cssH));

  /*
   * Decided on pixels, not on zoom. A canvas is left alone whenever it already
   * carries at least the detail the page now needs — so zooming out never
   * throws detail away, and never shows a softer page than it did a moment
   * before. Once it holds well over what is needed it is redrawn smaller to
   * give the memory back; the old canvas stays on screen until the new one
   * lands, so that swap is invisible.
   */
  const enough = (px) => px >= wantPx * 0.98 && px <= wantPx * 1.4;
  if (p.canvas && enough(p.canvas.width)) return;
  if (p.pendingPx && enough(p.pendingPx)) return;

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
  p.pendingPx = wantPx;

  try {
    if (!p.page) p.page = await state.doc.getPage(p.n);
    if (gen !== p.gen || token !== state.token) return;

    const outputScale = outputScaleFor(cssW, cssH);
    const viewport = p.page.getViewport({ scale: zoom * outputScale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
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
  }
  if (!p.el.querySelector('.pdf-page__skel')) {
    const skel = document.createElement('div');
    skel.className = 'pdf-page__skel';
    p.el.insertBefore(skel, p.el.firstChild);
  }
  p.pendingPx = null;
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
        el.help.hidden = true;
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

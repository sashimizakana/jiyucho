// 無限キャンバスの描画エンジン。
// 描画内容は 512px のタイルに分けて必要な分だけ確保する(中央原点・無限遠まで)。
// 「筆」レイヤーの上に常に「線」レイヤーが重なる。
const TILE = 512;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.layers = { brush: new Map(), line: new Map() };
    this.strokes = [];
    this.redoStack = [];
    this.paper = '#e8dcbc';
    this.view = { cx: 0, cy: 0, zoom: 1 };
    this.bbox = null; // {x0,y0,x1,y1}
    this.sprites = new Map();
    this.cur = null; // 描画中のストローク
    this.scratch = new Map(); // 描画中の筆ストローク用レイヤー
    this._raf = 0;
    this.onChange = null;
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.W = Math.max(1, r.width);
    this.H = Math.max(1, r.height);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.requestRender();
  }

  setPaper(c) { this.paper = c; this.requestRender(); }

  // ---- 座標 ----
  screenToWorld(sx, sy) {
    const v = this.view;
    return [(sx - this.W / 2) / v.zoom + v.cx, (sy - this.H / 2) / v.zoom + v.cy];
  }

  panBy(dx, dy) {
    this.view.cx -= dx / this.view.zoom;
    this.view.cy -= dy / this.view.zoom;
    this.requestRender();
  }

  zoomAt(sx, sy, factor) {
    const v = this.view;
    const [wx, wy] = this.screenToWorld(sx, sy);
    v.zoom = Math.min(16, Math.max(0.05, v.zoom * factor));
    v.cx = wx - (sx - this.W / 2) / v.zoom;
    v.cy = wy - (sy - this.H / 2) / v.zoom;
    this.requestRender();
  }

  resetView() { this.view = { cx: 0, cy: 0, zoom: 1 }; this.requestRender(); }

  fitView() {
    const b = this.getBBox();
    if (!b) return this.resetView();
    const z = Math.min(this.W / (b.w + 80), this.H / (b.h + 80), 4);
    this.view = { cx: b.x + b.w / 2, cy: b.y + b.h / 2, zoom: Math.max(0.05, z) };
    this.requestRender();
  }

  // ---- タイル ----
  tile(layer, tx, ty, create) {
    const key = tx + ',' + ty;
    const m = this.layers[layer];
    let t = m.get(key);
    if (!t && create) {
      const c = document.createElement('canvas');
      c.width = c.height = TILE;
      t = { c, ctx: c.getContext('2d'), tx, ty };
      m.set(key, t);
    }
    return t;
  }

  sprite(kind, color, r) {
    const rq = Math.max(0.5, Math.round(r * 2) / 2);
    const key = kind + color + rq;
    let s = this.sprites.get(key);
    if (s) return s;
    const size = Math.ceil(rq * 2) + 2;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const [R, G, B] = hexToRgb(color);
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, rq);
    if (kind === 'brush') {
      grad.addColorStop(0, `rgba(${R},${G},${B},1)`);
      grad.addColorStop(0.45, `rgba(${R},${G},${B},0.85)`);
      grad.addColorStop(1, `rgba(${R},${G},${B},0)`);
    } else {
      grad.addColorStop(0, `rgba(${R},${G},${B},1)`);
      grad.addColorStop(0.7, `rgba(${R},${G},${B},1)`);
      grad.addColorStop(1, `rgba(${R},${G},${B},0)`);
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    if (this.sprites.size > 300) this.sprites.clear();
    this.sprites.set(key, s = c);
    return s;
  }

  stampAt(layer, x, y, spr, alpha) {
    const half = spr.width / 2;
    const x0 = x - half, y0 = y - half;
    const tx0 = Math.floor(x0 / TILE), tx1 = Math.floor((x0 + spr.width) / TILE);
    const ty0 = Math.floor(y0 / TILE), ty1 = Math.floor((y0 + spr.width) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = this.tile(layer, tx, ty, true);
        t.ctx.globalAlpha = alpha;
        t.ctx.drawImage(spr, x0 - tx * TILE, y0 - ty * TILE);
      }
    }
  }

  // ---- ストローク描画 ----
  // 筆圧 p(0..1) → 半径・濃さ
  params(st, p) {
    const s = st.stroke;
    if (s.t === 'brush') {
      const r = Math.max(1, (s.s / 2) * (0.55 + 0.45 * p));
      const spacing = Math.max(0.8, r * 0.22);
      const A = Math.min(0.9, 0.04 + Math.pow(p, 1.5) * 0.5); // 1回なぞったときの濃さ
      const n = Math.max(1, (1.2 * r) / spacing);
      return { r, spacing, alpha: 1 - Math.pow(1 - A, 1 / n) };
    }
    const r = Math.max(0.5, (s.s / 2) * (0.55 + 0.45 * p));
    const spacing = Math.max(0.4, r * 0.35);
    return { r, spacing, alpha: 0.12 + 0.3 * p };
  }

  stampStroke(st, x, y, p) {
    const s = st.stroke;
    const { r, alpha } = this.params(st, p);
    let a = alpha, px = x, py = y;
    if (s.t === 'line') {
      // 鉛筆: ざらつきと軽いブレ
      a *= 0.5 + 0.7 * st.rng();
      px += (st.rng() - 0.5) * r * 0.6;
      py += (st.rng() - 0.5) * r * 0.6;
    }
    this.stampAt(s.t, px, py, this.sprite(s.t, s.c, r), Math.min(1, a));
    const b = this.bbox;
    if (!b) this.bbox = { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
    else {
      b.x0 = Math.min(b.x0, x - r); b.y0 = Math.min(b.y0, y - r);
      b.x1 = Math.max(b.x1, x + r); b.y1 = Math.max(b.y1, y + r);
    }
  }

  newState(stroke) {
    const p = stroke.p;
    const seed = Math.floor(Math.abs((p[0] || 0) * 7919 + (p[1] || 0) * 104729));
    return { stroke, rng: mulberry32(seed), x: 0, y: 0, pr: 0, carry: 0, started: false };
  }

  growBBox(x, y, r) {
    const b = this.bbox;
    if (!b) this.bbox = { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
    else {
      b.x0 = Math.min(b.x0, x - r); b.y0 = Math.min(b.y0, y - r);
      b.x1 = Math.max(b.x1, x + r); b.y1 = Math.max(b.y1, y + r);
    }
  }

  // 筆: ふち取りのない塗りつぶし。区間ごとに一定の透明度で塗り、筆圧で濃さと太さが変わる
  brushR(st, p) { return Math.max(1, (st.stroke.s / 2) * (0.55 + 0.45 * p)); }
  brushA(p) { return Math.min(0.95, 0.08 + 0.6 * Math.pow(p, 1.3)); }

  fillShape(layer, color, alpha, bx0, by0, bx1, by1, path) {
    const tx0 = Math.floor(bx0 / TILE), tx1 = Math.floor(bx1 / TILE);
    const ty0 = Math.floor(by0 / TILE), ty1 = Math.floor(by1 / TILE);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const g = this.tile(layer, tx, ty, true).ctx;
      g.save();
      g.translate(-tx * TILE, -ty * TILE);
      g.globalAlpha = alpha;
      g.fillStyle = color;
      g.beginPath();
      path(g);
      g.fill();
      g.restore();
    }
  }

  // 筆: ストローク専用のレイヤー(scratch)に「上書き」で描き、終わったら紙に重ねる。
  // ストローク内では重ねても濃くならない(局所の筆圧どおりの濃さ)ので継ぎ目も出ない。
  replaceShape(c, alpha, bx0, by0, bx1, by1, path) {
    const tx0 = Math.floor(bx0 / TILE), tx1 = Math.floor(bx1 / TILE);
    const ty0 = Math.floor(by0 / TILE), ty1 = Math.floor(by1 / TILE);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const key = tx + ',' + ty;
      let t = this.scratch.get(key);
      if (!t) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = TILE;
        this.scratch.set(key, t = { c: cv, ctx: cv.getContext('2d'), tx, ty });
      }
      const g = t.ctx;
      g.save();
      g.translate(-tx * TILE, -ty * TILE);
      g.beginPath();
      path(g);
      g.clip();
      g.clearRect(bx0, by0, bx1 - bx0, by1 - by0);
      g.globalAlpha = alpha;
      g.fillStyle = c;
      g.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
      g.restore();
    }
  }

  brushDisc(st, x, y, r, a) {
    this.replaceShape(st.stroke.c, a, x - r - 1, y - r - 1, x + r + 1, y + r + 1, (g) => g.arc(x, y, r, 0, Math.PI * 2));
    this.growBBox(x, y, r);
  }

  brushFeed(st, x, y, p) {
    const r1 = this.brushR(st, p);
    if (!st.started) {
      st.started = true; st.x = x; st.y = y; st.pr = p;
      this.brushDisc(st, x, y, r1, this.brushA(p));
      return;
    }
    const dx = x - st.x, dy = y - st.y, len = Math.hypot(dx, dy);
    if (len < 0.8) return;
    const r0 = this.brushR(st, st.pr), a = this.brushA((st.pr + p) / 2);
    const nx = -dy / len, ny = dx / len, x0 = st.x, y0 = st.y;
    const R = Math.max(r0, r1) + 1;
    this.replaceShape(st.stroke.c, a, Math.min(x0, x) - R, Math.min(y0, y) - R, Math.max(x0, x) + R, Math.max(y0, y) + R, (g) => {
      g.moveTo(x0 + nx * r0, y0 + ny * r0);
      g.lineTo(x + nx * r1, y + ny * r1);
      g.lineTo(x - nx * r1, y - ny * r1);
      g.lineTo(x0 - nx * r0, y0 - ny * r0);
      g.closePath();
    });
    this.brushDisc(st, x0, y0, r0, a);
    this.brushDisc(st, x, y, r1, a);
    st.x = x; st.y = y; st.pr = p;
  }

  brushFinish(st) {
    for (const t of this.scratch.values()) {
      this.tile('brush', t.tx, t.ty, true).ctx.drawImage(t.c, 0, 0);
    }
    this.scratch.clear();
    this.requestRender();
  }

  // 消しゴム: 筆・線の両レイヤーの既存タイルから円/カプセル状に消す
  eraseFeed(st, x, y, p) {
    const r = Math.max(1, st.stroke.s / 2);
    const px = st.started ? st.x : x, py = st.started ? st.y : y;
    st.started = true; st.x = x; st.y = y; st.pr = p;
    const bx0 = Math.min(px, x) - r - 1, by0 = Math.min(py, y) - r - 1;
    const bx1 = Math.max(px, x) + r + 1, by1 = Math.max(py, y) + r + 1;
    const tx0 = Math.floor(bx0 / TILE), tx1 = Math.floor(bx1 / TILE);
    const ty0 = Math.floor(by0 / TILE), ty1 = Math.floor(by1 / TILE);
    // stroke.c に対象レイヤー('line' / 'brush')が入る。それ以外は両方消す
    const target = st.stroke.c === 'line' || st.stroke.c === 'brush' ? [st.stroke.c] : ['brush', 'line'];
    for (const layer of target) {
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const t = this.layers[layer].get(tx + ',' + ty);
        if (!t) continue;
        const g = t.ctx;
        g.save();
        g.globalCompositeOperation = 'destination-out';
        g.globalAlpha = 1;
        g.strokeStyle = g.fillStyle = '#000';
        g.lineCap = 'round';
        g.lineWidth = r * 2;
        g.beginPath();
        g.moveTo(px - tx * TILE, py - ty * TILE);
        g.lineTo(x - tx * TILE, y - ty * TILE);
        g.stroke();
        g.beginPath();
        g.arc(x - tx * TILE, y - ty * TILE, r, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
  }

  feed(st, x, y, p) {
    if (st.stroke.t === 'erase') return this.eraseFeed(st, x, y, p);
    if (st.stroke.t === 'brush') return this.brushFeed(st, x, y, p);
    if (!st.started) {
      st.started = true;
      st.x = x; st.y = y; st.pr = p;
      this.stampStroke(st, x, y, p);
      st.carry = this.params(st, p).spacing;
      return;
    }
    const dx = x - st.x, dy = y - st.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    let d = st.carry;
    while (d <= len) {
      const t = d / len;
      const pp = st.pr + (p - st.pr) * t;
      this.stampStroke(st, st.x + dx * t, st.y + dy * t, pp);
      d += this.params(st, pp).spacing;
    }
    st.carry = d - len;
    st.x = x; st.y = y; st.pr = p;
  }

  replay(stroke) {
    const st = this.newState(stroke);
    const p = stroke.p;
    for (let i = 0; i < p.length; i += 3) this.feed(st, p[i], p[i + 1], p[i + 2]);
    if (stroke.t === 'brush') this.brushFinish(st);
  }

  rebuild() {
    this.layers.brush.clear();
    this.layers.line.clear();
    this.bbox = null;
    for (const s of this.strokes) this.replay(s);
    this.requestRender();
  }

  load(strokes) {
    this.strokes = strokes || [];
    this.redoStack = [];
    this.cur = null;
    this.rebuild();
    // 開いたときは 100% で、絵の中心を表示する
    const b = this.getBBox();
    this.view = { cx: b ? b.x + b.w / 2 : 0, cy: b ? b.y + b.h / 2 : 0, zoom: 1 };
    this.requestRender();
  }

  beginStroke(tool, color, size) {
    this.cur = this.newState({ t: tool, c: color, s: size, p: [] });
    this.redoStack = [];
  }

  // x,y はワールド座標
  addPoint(x, y, p) {
    const st = this.cur;
    if (!st) return;
    x = Math.round(x * 10) / 10; y = Math.round(y * 10) / 10; p = Math.round(p * 100) / 100;
    const arr = st.stroke.p;
    if (arr.length === 0) {
      // 乱数シードを決めるため、最初の点が入ってから状態を作り直す
      arr.push(x, y, p);
      this.cur = this.newState(st.stroke);
      this.feed(this.cur, x, y, p);
    } else {
      arr.push(x, y, p);
      this.feed(st, x, y, p);
    }
    this.requestRender();
  }

  endStroke() {
    const st = this.cur;
    this.cur = null;
    if (!st || st.stroke.p.length === 0) return;
    if (st.stroke.t === 'brush') this.brushFinish(st);
    this.strokes.push(st.stroke);
    if (this.onChange) this.onChange();
  }

  undo() {
    if (!this.strokes.length) return;
    this.redoStack.push(this.strokes.pop());
    this.rebuild();
    if (this.onChange) this.onChange();
  }

  redo() {
    if (!this.redoStack.length) return;
    const s = this.redoStack.pop();
    this.strokes.push(s);
    this.replay(s);
    this.requestRender();
    if (this.onChange) this.onChange();
  }

  // ---- 描画範囲 ----
  getBBox(margin = 0) {
    const b = this.bbox;
    if (!b) return null;
    return { x: b.x0 - margin, y: b.y0 - margin, w: b.x1 - b.x0 + margin * 2, h: b.y1 - b.y0 + margin * 2 };
  }

  // ---- 表示 ----
  requestRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); });
  }

  drawTiles(ctx, x0, y0, x1, y1) {
    const tx0 = Math.floor(x0 / TILE), tx1 = Math.floor(x1 / TILE);
    const ty0 = Math.floor(y0 / TILE), ty1 = Math.floor(y1 / TILE);
    for (const m of [this.layers.brush, this.scratch, this.layers.line]) {
      // 範囲が広いときはタイルを走査、狭いときは座標で引く
      if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > m.size) {
        for (const t of m.values()) {
          if (t.tx >= tx0 && t.tx <= tx1 && t.ty >= ty0 && t.ty <= ty1) ctx.drawImage(t.c, t.tx * TILE, t.ty * TILE);
        }
      } else {
        for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
          const t = m.get(tx + ',' + ty);
          if (t) ctx.drawImage(t.c, tx * TILE, ty * TILE);
        }
      }
    }
  }

  render() {
    const { ctx, view: v, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.paper;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * (this.W / 2 - v.cx * v.zoom), dpr * (this.H / 2 - v.cy * v.zoom));
    ctx.imageSmoothingEnabled = true;
    const [x0, y0] = this.screenToWorld(0, 0);
    const [x1, y1] = this.screenToWorld(this.W, this.H);
    this.drawTiles(ctx, x0, y0, x1, y1);
    if (this.onView) this.onView();
  }

  // ---- 書き出し用 ----
  // bb(ワールド座標の矩形)を scale 倍で描いた canvas を返す。bg が null なら透明。
  renderRegion(bb, scale, bg) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(bb.w * scale));
    c.height = Math.max(1, Math.ceil(bb.h * scale));
    const g = c.getContext('2d');
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); }
    g.setTransform(scale, 0, 0, scale, -bb.x * scale, -bb.y * scale);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    this.drawTiles(g, bb.x, bb.y, bb.x + bb.w, bb.y + bb.h);
    return c;
  }
}

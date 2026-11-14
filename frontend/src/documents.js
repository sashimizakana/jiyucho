// 絵の読み込み・保存・書き出しと、描画エンジンの保持
import { Engine } from './engine.js';
import { cur, tool, images, status, zoom, canUndo, canRedo, persist, loadSettings, playback } from './store.js';

const PLAY_BASE = 200; // 再生速度 1倍 = 200点/秒

let engine = null;
export const getEngine = () => engine;

export function createEngine(canvas) {
  engine = new Engine(canvas);
  engine.onPlayback = (s) => {
    if (!s) { playback.active = false; playback.playing = false; return; }
    Object.assign(playback, { active: true, playing: s.playing, pos: s.pos, total: s.total });
  };
  engine.onChange = () => { updateUndo(); scheduleSave(); };
  engine.onView = () => { zoom.value = engine.view.zoom; };
  return engine;
}

function updateUndo() {
  canUndo.value = engine.strokes.length > 0;
  canRedo.value = engine.redoStack.length > 0;
}

// ---------- 保存 ----------
let saveTimer = 0;
let saving = false;
let pending = false;
// サーバーに保存済みのストローク(参照で比較して、先頭からの共通部分だけを残し、残りを差分として送る)
let savedStrokes = [];

export function scheduleSave() {
  status.value = '未保存…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 500);
}

function makeThumb(bb) {
  const W = 240, H = 180;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = cur.paper;
  g.fillRect(0, 0, W, H);
  if (bb) {
    const pad = 10;
    const s = Math.min((W - pad * 2) / bb.w, (H - pad * 2) / bb.h, 1);
    const r = engine.renderRegion(bb, s, null, true);
    g.drawImage(r, (W - r.width) / 2, (H - r.height) / 2);
  }
  return c.toDataURL('image/png');
}

async function save() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (!cur.id) return;
  // 再生中はキャンバスが途中の状態なので、終わってから保存する
  if (engine.pb) { saveTimer = setTimeout(save, 500); return; }
  if (saving) { pending = true; return; }
  saving = true;
  status.value = '保存中…';
  const id = cur.id;
  try {
    const bb = engine.getBBoxAll(8); // 画像も含める(MCP の get_image はこのキャッシュを返す)
    let layers = '', scale = 1;
    if (bb) {
      scale = Math.min(1, 2048 / Math.max(bb.w, bb.h));
      layers = engine.renderRegion(bb, scale, null, true).toDataURL('image/png');
    }
    // 未アップロードの貼り付け画像を先に送る
    for (const p of engine.pics.slice()) {
      if (p.uploaded) continue;
      const r = await fetch('/api/images/' + id + '/pics/' + p.id, { method: 'PUT', body: p.blob });
      if (!r.ok) throw new Error(await r.text());
      p.uploaded = true; p.blob = null;
    }
    const pics = engine.pics.map((p) => ({ id: p.id, x: p.x, y: p.y, w: p.w, h: p.h }));
    const strokes = engine.strokes.slice();
    let base = 0;
    while (base < savedStrokes.length && base < strokes.length && savedStrokes[base] === strokes[base]) base++;
    const res = await fetch('/api/images/' + id, {
      method: 'PUT',
      body: JSON.stringify({
        title: cur.title, paper: cur.paper, base, append: strokes.slice(base),
        pics, bbox: bb, cacheScale: scale, strokeCount: engine.strokes.length,
        layers, thumb: makeThumb(bb),
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const meta = await res.json();
    const i = images.value.findIndex((m) => m.id === id);
    if (i >= 0) images.value.splice(i, 1);
    images.value.unshift(meta);
    savedStrokes = strokes;
    status.value = '保存しました';
  } catch (e) {
    savedStrokes = []; // 次回は全ストロークを送り直す
    status.value = '保存に失敗: ' + e.message;
  } finally {
    saving = false;
    if (pending) { pending = false; save(); }
  }
}

async function flush() {
  if (saveTimer) await save();
  while (saving) await new Promise((r) => setTimeout(r, 30));
}

// ---------- 絵の操作 ----------
async function refreshList() {
  images.value = await (await fetch('/api/images')).json();
}

// 何も描かず離れた空の絵は片付ける
async function dropIfEmpty() {
  if (!cur.id || engine.strokes.length || engine.pics.length || cur.title.trim()) return;
  const id = cur.id;
  cur.id = '';
  await fetch('/api/images/' + id, { method: 'DELETE' });
  images.value = images.value.filter((m) => m.id !== id);
}

function loadPic(imageId, p) {
  const img = new Image();
  img.onload = () => engine.requestRender();
  img.src = '/api/images/' + imageId + '/pics/' + p.id;
  return { ...p, img, blob: null, uploaded: true };
}

// クリップボードの画像を貼り付け(PNGに変換して別レイヤーとして置く)
export async function pasteImageBlob(blob) {
  if (!cur.id || engine.pb) return;
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 4096 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const png = await new Promise((r) => c.toBlob(r, 'image/png'));
  engine.addPic(c, png);
  tool.value = 'image';
}
export const deleteSelectedPic = () => engine.removeSelPic();

export async function openImage(id) {
  if (id === cur.id) return;
  engine.stopPlayback();
  await flush();
  await dropIfEmpty();
  const d = await (await fetch('/api/images/' + id)).json();
  cur.id = d.meta.id; cur.title = d.meta.title; cur.paper = d.meta.paper;
  engine.setPaper(cur.paper);
  engine.load(d.strokes, (d.pics || []).map((p) => loadPic(cur.id, p)));
  savedStrokes = engine.strokes.slice();
  updateUndo();
  status.value = '';
  persist();
}

export async function newImage() {
  engine.stopPlayback();
  await flush();
  const paper = cur.paper || undefined;
  await dropIfEmpty();
  const meta = await (await fetch('/api/images', { method: 'POST', body: JSON.stringify({ paper }) })).json();
  images.value.unshift(meta);
  cur.id = meta.id; cur.title = ''; cur.paper = meta.paper;
  engine.setPaper(cur.paper);
  engine.load([], []);
  savedStrokes = [];
  updateUndo();
  status.value = '';
  persist();
}

export async function removeImage(im) {
  if (!confirm(`「${im.title || '(無題)'}」を削除しますか?`)) return;
  await fetch('/api/images/' + im.id, { method: 'DELETE' });
  images.value = images.value.filter((m) => m.id !== im.id);
  if (im.id === cur.id) {
    cur.id = '';
    clearTimeout(saveTimer); saveTimer = 0;
    if (images.value.length) await openImage(images.value[0].id);
    else await newImage();
  }
}

export function setPaper(c) {
  cur.paper = c;
  engine.setPaper(c);
  scheduleSave();
}

export async function startPlayback() {
  if (!engine.strokes.length || engine.pb) return;
  await flush();
  engine.startPlayback(playback.speed * PLAY_BASE);
}
export const stopPlayback = () => engine.stopPlayback();
export const playPause = () => engine.pbSetPlaying(!playback.playing);
export const seekPlayback = (n) => engine.pbSeek(n);
export const setPlaySpeed = (x) => { playback.speed = x; engine.pbSetRate(x * PLAY_BASE); };

export const undo = () => engine.undo();
export const redo = () => engine.redo();
export function resetView() { engine.resetView(); zoom.value = 1; }
export function fitView() { engine.fitView(); zoom.value = engine.view.zoom; }

// bg: 背景色(null なら透明)
export function exportPng(bg) {
  const bb = engine.getBBoxAll(16) || { x: -256, y: -256, w: 512, h: 512 };
  const s = Math.min(1, 8192 / Math.max(bb.w, bb.h));
  const c = engine.renderRegion(bb, s, bg, true);
  c.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (cur.title.trim() || 'sketch').replace(/[\\/:*?"<>|]/g, '_') + '.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
}

// ---------- 起動 ----------
export async function init() {
  window.addEventListener('beforeunload', () => { if (saveTimer) save(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) save(); });

  // ブラウザが開いている間だけサーバーを生かすための接続
  new EventSource('/api/live');

  try {
    const s = await loadSettings();
    await refreshList();
    const target = images.value.find((m) => m.id === s.last) || images.value[0];
    if (target) await openImage(target.id);
    else await newImage();
  } catch (e) {
    status.value = '読み込みに失敗: ' + e.message;
  }
}

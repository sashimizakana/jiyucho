<script setup>
// 描画キャンバス: ポインタ入力・ズーム・ブラシ円の表示
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { cur, frame, framePx, tool, st, zoom, spaceDown, pushColor, persist, playback } from '../store.js';
import { createEngine } from '../documents.js';
import PlaybackBar from './PlaybackBar.vue';

const canvas = ref(null);
const stage = ref(null);
const penInfo = ref('');
const cursor = reactive({ x: 0, y: 0, in: false });
let engine = null;
let ro = null;

const showRing = computed(() => tool.value !== 'image' && tool.value !== 'frame' && !spaceDown.value && !playback.active);
const ringStyle = computed(() => {
  const d = Math.max(4, st[tool.value] ? st[tool.value].size * zoom.value : 4);
  return { width: d + 'px', height: d + 'px', transform: `translate(${cursor.x - d / 2}px, ${cursor.y - d / 2}px)` };
});

function trackCursor(e) {
  const r = canvas.value.getBoundingClientRect();
  cursor.x = e.clientX - r.left; cursor.y = e.clientY - r.top; cursor.in = true;
  if (engine) engine.pointer = { x: cursor.x, y: cursor.y };
}

function pressureOf(e) {
  penInfo.value = `${e.pointerType} 筆圧 ${e.pressure.toFixed(2)}`;
  if (e.pointerType === 'pen') return Math.min(1, Math.max(0.02, e.pressure));
  return 0.5; // マウス・タッチは一定の筆圧
}

// ---------- 入力 ----------
let mode = null; // 'draw' | 'pan'
let frameOff = [0, 0];
let lastX = 0, lastY = 0, smoothX = 0, smoothY = 0, smoothP = 0.5;

function onDown(e) {
  if (!cur.id || mode) return;
  canvas.value.setPointerCapture(e.pointerId);
  const r = canvas.value.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (e.button === 1 || e.button === 2 || spaceDown.value) {
    mode = 'pan'; lastX = e.clientX; lastY = e.clientY;
    return;
  }
  if (e.button !== 0 || engine.pb) return; // 再生中は描けない
  if (tool.value === 'frame') {
    const [wx, wy] = engine.screenToWorld(sx, sy);
    if (frame.on && wx >= frame.x && wx <= frame.x + framePx(frame.wCm, frame.dpi) && wy >= frame.y && wy <= frame.y + framePx(frame.hCm, frame.dpi)) {
      mode = 'frame'; frameOff = [wx - frame.x, wy - frame.y];
    } else { mode = 'pan'; lastX = e.clientX; lastY = e.clientY; }
    return;
  }
  if (tool.value === 'image') {
    const [wx, wy] = engine.screenToWorld(sx, sy);
    if (engine.picDown(wx, wy)) mode = 'pic';
    else { mode = 'pan'; lastX = e.clientX; lastY = e.clientY; } // 画像の外はドラッグで視点移動
    return;
  }
  mode = 'draw';
  const k = tool.value;
  if (k === 'eraseLine') engine.beginStroke('erase', 'line', st[k].size);
  else if (k === 'eraseBrush') engine.beginStroke('erase', 'brush', st[k].size);
  else engine.beginStroke(k, st[k].color, st[k].size);
  const [wx, wy] = engine.screenToWorld(sx, sy);
  smoothX = wx; smoothY = wy; smoothP = pressureOf(e);
  engine.addPoint(wx, wy, smoothP);
}

function onMove(e) {
  trackCursor(e);
  if (mode === 'pan') {
    engine.panBy(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
  } else if (mode === 'frame') {
    const r = canvas.value.getBoundingClientRect();
    const [wx, wy] = engine.screenToWorld(e.clientX - r.left, e.clientY - r.top);
    frame.x = Math.round(wx - frameOff[0]); frame.y = Math.round(wy - frameOff[1]);
  } else if (mode === 'pic') {
    const r = canvas.value.getBoundingClientRect();
    const [wx, wy] = engine.screenToWorld(e.clientX - r.left, e.clientY - r.top);
    engine.picDrag(wx, wy);
  } else if (mode === 'draw') {
    const r = canvas.value.getBoundingClientRect();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const [wx, wy] = engine.screenToWorld(ev.clientX - r.left, ev.clientY - r.top);
      const f = 0.65;
      smoothX += (wx - smoothX) * f; smoothY += (wy - smoothY) * f;
      smoothP += (pressureOf(ev) - smoothP) * 0.5;
      engine.addPoint(smoothX, smoothY, smoothP);
    }
  }
}

function onUp(e) {
  if (mode === 'pic') engine.picUp();
  if (mode === 'draw') {
    const r = canvas.value.getBoundingClientRect();
    const [wx, wy] = engine.screenToWorld(e.clientX - r.left, e.clientY - r.top);
    engine.addPoint(wx, wy, smoothP);
    engine.endStroke();
    const k = tool.value;
    if (k === 'line' || k === 'brush') pushColor(k, st[k].color);
    persist();
  }
  mode = null;
}

function onWheel(e) {
  e.preventDefault();
  const r = canvas.value.getBoundingClientRect();
  engine.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  zoom.value = engine.view.zoom;
}

watch(() => [frame.on, frame.x, frame.y, frame.wCm, frame.hCm, frame.dpi], () => {
  if (!engine) return;
  engine.setFrame(frame.on ? { x: frame.x, y: frame.y, w: framePx(frame.wCm, frame.dpi), h: framePx(frame.hCm, frame.dpi) } : null);
});
watch(tool, (t) => { if (t !== 'image' && engine) engine.deselect(); });

onMounted(() => {
  engine = createEngine(canvas.value);
  ro = new ResizeObserver(() => engine.resize());
  ro.observe(stage.value);

  const c = canvas.value;
  c.addEventListener('pointerdown', onDown);
  c.addEventListener('pointermove', onMove);
  c.addEventListener('pointerup', onUp);
  c.addEventListener('pointercancel', onUp);
  c.addEventListener('pointerleave', () => { cursor.in = false; if (engine) engine.pointer = null; });
  c.addEventListener('pointerenter', trackCursor);
  c.addEventListener('wheel', onWheel, { passive: false });
  c.addEventListener('contextmenu', (e) => e.preventDefault());
});
onBeforeUnmount(() => ro && ro.disconnect());
</script>

<template>
  <main class="stage" ref="stage">
    <canvas ref="canvas" :class="{pan: spaceDown, ring: showRing}"></canvas>
    <div class="brush-cursor" v-show="showRing && cursor.in" :style="ringStyle"></div>
    <PlaybackBar />
    <div class="hud">{{ Math.round(zoom * 100) }}%<span v-if="penInfo"> ・ {{ penInfo }}</span></div>
  </main>
</template>

<script setup>
// 印刷枠: DPI・サイズの設定、画面上での移動、枠どおりのPNG書き出し
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { frame, framePx, FRAME_PRESETS, tool } from '../store.js';
import { getEngine } from '../documents.js';

const emit = defineEmits(['print']);

const pxW = computed(() => framePx(frame.wCm, frame.dpi));
const pxH = computed(() => framePx(frame.hCm, frame.dpi));
// サイズがプリセットと同じ(縦横どちらでも)ならその名前、変えたら「カスタム」
const presetName = computed(() => {
  const p = FRAME_PRESETS.find((x) => (x.w === frame.wCm && x.h === frame.hCm) || (x.h === frame.wCm && x.w === frame.hCm));
  return p ? p.n : 'カスタム';
});
const menu = ref(false);
const root = ref(null);
const closeMenu = (e) => { if (root.value && !root.value.contains(e.target)) menu.value = false; };
onMounted(() => document.addEventListener('pointerdown', closeMenu));
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeMenu));

const lastPrint = computed(() => {
  const l = frame.lastPrint;
  if (!l) return '';
  const d = new Date(l.at);
  const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const name = FRAME_PRESETS.find((x) => (x.w === l.wCm && x.h === l.hCm) || (x.h === l.wCm && x.w === l.hCm))?.n || 'カスタム';
  return `${when} ${name} ${l.wCm}×${l.hCm}cm ${l.dpi}dpi`;
});

function toggle() {
  frame.on = !frame.on;
  if (frame.on && !frame.placed) center();
  if (!frame.on && tool.value === 'frame') tool.value = 'line';
}
function center() {
  const e = getEngine();
  const [cx, cy] = e ? [e.view.cx, e.view.cy] : [0, 0];
  frame.x = Math.round(cx - pxW.value / 2);
  frame.y = Math.round(cy - pxH.value / 2);
  frame.placed = true;
}
function preset(p) {
  frame.wCm = p.w; frame.hCm = p.h;
  menu.value = false;
}
function rotate() { [frame.wCm, frame.hCm] = [frame.hCm, frame.wCm]; }
function num(key, v, min, max) {
  const n = parseFloat(v);
  if (n >= min && n <= max) frame[key] = n;
}
const active = computed(() => tool.value === 'frame');
// ブロックを触ると印刷枠ツールになり、キャンバス上で枠をドラッグできる
function activate() { tool.value = 'frame'; }
</script>

<template>
  <section class="group tool" :class="{active}" @pointerdown="activate">
    <h3><i class="fa-solid fa-vector-square"></i> 印刷枠
      <label class="switch"><input type="checkbox" :checked="frame.on" @change="toggle"> ON</label>
    </h3>
    <template v-if="frame.on">
      <div class="row frm">
        <input type="number" :value="frame.wCm" min="1" max="100" step="0.1" @change="num('wCm', $event.target.value, 1, 100)">
        <span>×</span>
        <input type="number" :value="frame.hCm" min="1" max="100" step="0.1" @change="num('hCm', $event.target.value, 1, 100)">
        <span>cm</span>
        <span class="pick" ref="root">
          <button class="link" @click="menu = !menu">{{ presetName }} <i class="fa-solid fa-caret-down"></i></button>
          <ul v-if="menu" class="menu">
            <li v-for="p in FRAME_PRESETS" :key="p.n"><button @click="preset(p)">{{ p.n }} <small>{{ p.w }}×{{ p.h }}</small></button></li>
          </ul>
        </span>
      </div>
      <div class="row frm">
        <input type="number" :value="frame.dpi" min="30" max="1200" step="10" @change="num('dpi', $event.target.value, 30, 1200)">
        <span>dpi</span>
        <button class="btn" @click="rotate" title="縦横を入れ替え"><i class="fa-solid fa-rotate"></i> 縦横</button>
      </div>
      <p class="hint">出力: {{ pxW }} × {{ pxH }} px</p>
      <p class="hint" v-if="lastPrint"><i class="fa-solid fa-clock-rotate-left"></i> 前回印刷: {{ lastPrint }}</p>
      <p class="hint">このブロックを選んでいる間、画面上で枠をドラッグして動かせます。</p>
      <button class="btn primary wide" @click="emit('print')"><i class="fa-solid fa-print"></i> 印刷用に書き出し</button>
    </template>
  </section>
</template>

<style scoped>
.frm { margin-top: 6px; flex-wrap: wrap; }
.frm input[type=number] { width: 58px; font: inherit; color: inherit; background: var(--panel);
  border: 1px solid var(--line); border-radius: 6px; padding: 3px 4px; }
.pick { position: relative; }
.link { background: none; border: none; padding: 2px 4px; font: inherit; color: var(--accent); text-decoration: underline; cursor: pointer; }
.menu { position: absolute; z-index: 5; top: 100%; left: 0; margin: 2px 0 0; padding: 4px; list-style: none; min-width: 130px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,.3); }
.menu button { width: 100%; display: flex; justify-content: space-between; gap: 10px; padding: 5px 8px; border: none;
  background: none; color: inherit; font: inherit; border-radius: 4px; cursor: pointer; text-align: left; }
.menu button:hover { background: var(--hover); }
.menu small { color: var(--sub); }
.switch { float: right; font-weight: normal; font-size: 12px; cursor: pointer; }
.wide { width: 100%; margin-top: 8px; }
</style>

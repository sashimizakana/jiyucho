// アプリ全体で共有する状態と、設定(色の履歴など)の保存
import { reactive, ref, watch } from 'vue';

const MAX_HISTORY = 24;

export const PAPERS = [
  { n: 'わら半紙', c: '#e8dcbc' },
  { n: '白', c: '#ffffff' },
  { n: '生成り', c: '#f4efe1' },
  { n: '灰色', c: '#9aa0a6' },
  { n: '黒板', c: '#2f4a3c' },
  { n: '夜', c: '#1d2230' },
];

// 開いている絵
export const cur = reactive({ id: '', title: '', paper: '#e8dcbc' });
export const images = ref([]);

// ツール: 'line' | 'brush' | 'eraseLine' | 'eraseBrush' | 'image' | 'frame'
export const tool = ref('line');
export const st = reactive({
  line: { color: '#2b2b2b', size: 3, history: ['#2b2b2b', '#c0392b', '#2c6fbb'] },
  brush: { color: '#c0392b', size: 36, history: ['#c0392b', '#e0a030', '#3f8f5a', '#2c6fbb', '#ffffff'] },
  eraseLine: { size: 12 },
  eraseBrush: { size: 40 },
});

// 印刷枠(ワールド座標1単位 = 書き出し1px。x,y は枠の左上)
export const FRAME_PRESETS = [
  { n: 'A3', w: 29.7, h: 42 }, { n: 'A4', w: 21, h: 29.7 }, { n: 'A5', w: 14.8, h: 21 },
  { n: 'B5', w: 18.2, h: 25.7 }, { n: 'B6', w: 12.8, h: 18.2 },
  { n: 'L版', w: 8.9, h: 12.7 }, { n: '2L版', w: 12.7, h: 17.8 },
  { n: 'はがき', w: 10, h: 14.8 }, { n: '名刺', w: 5.5, h: 9.1 },
];
// 絵ごとに保存される。lastPrint は前回の印刷内容 {at, bg, dpi, wCm, hCm}
const frameDefaults = () => ({ on: false, dpi: 350, wCm: 21, hCm: 29.7, x: 0, y: 0, placed: false, lastPrint: null });
export const frame = reactive(frameDefaults());
export const frameData = () => ({ ...frame });
export const setFrame = (f) => Object.assign(frame, frameDefaults(), f || {});
export const framePx = (cm, dpi) => Math.max(1, Math.round(cm / 2.54 * dpi));

export const status = ref('');
export const zoom = ref(1);
export const canUndo = ref(false);
export const canRedo = ref(false);
export const spaceDown = ref(false);

// 再生モード(speed は倍率。基準は documents.js の PLAY_BASE 点/秒)
export const playback = reactive({ active: false, playing: false, pos: 0, total: 0, speed: 4 });

// 'line' → 'eraseLine'
export const eraserOf = (kind) => (kind === 'line' ? 'eraseLine' : 'eraseBrush');

// ---------- 設定をサーバーに保存 ----------
let settingsTimer = 0;
export function persist() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    fetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        line: st.line, brush: st.brush, eraseLine: st.eraseLine, eraseBrush: st.eraseBrush,
        tool: tool.value === 'image' || tool.value === 'frame' ? 'line' : tool.value, last: cur.id,
      }),
    }).catch(() => {});
  }, 400);
}
watch(tool, persist);

export async function loadSettings() {
  const s = await (await fetch('/api/settings')).json();
  for (const k of ['line', 'brush']) {
    if (!s[k]) continue;
    Object.assign(st[k], s[k]);
    if (!st[k].history.includes(st[k].color)) st[k].history.unshift(st[k].color);
  }
  for (const k of ['eraseLine', 'eraseBrush']) if (s[k] && s[k].size) st[k].size = s[k].size;
  if (['line', 'brush', 'eraseLine', 'eraseBrush'].includes(s.tool)) tool.value = s.tool;
  return s;
}

// ---------- 色の履歴 ----------
export function pushColor(kind, c) {
  c = c.toLowerCase();
  const h = st[kind].history.filter((x) => x !== c);
  h.unshift(c);
  st[kind].history = h.slice(0, MAX_HISTORY);
}
export function commitColor(kind) { pushColor(kind, st[kind].color); persist(); }
export function pickColor(kind, c) { st[kind].color = c; pushColor(kind, c); persist(); }

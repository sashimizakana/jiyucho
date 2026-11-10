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

// ツール: 'line' | 'brush' | 'eraseLine' | 'eraseBrush' | 'hand'
export const tool = ref('line');
export const st = reactive({
  line: { color: '#2b2b2b', size: 3, history: ['#2b2b2b', '#c0392b', '#2c6fbb'] },
  brush: { color: '#c0392b', size: 36, history: ['#c0392b', '#e0a030', '#3f8f5a', '#2c6fbb', '#ffffff'] },
  eraseLine: { size: 12 },
  eraseBrush: { size: 40 },
});

export const status = ref('');
export const zoom = ref(1);
export const canUndo = ref(false);
export const canRedo = ref(false);
export const spaceDown = ref(false);

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
        tool: tool.value === 'hand' ? 'line' : tool.value, last: cur.id,
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

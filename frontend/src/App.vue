<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { spaceDown, playback, tool } from './store.js';
import { init, undo, redo, stopPlayback, pasteImageBlob, deleteSelectedPic } from './documents.js';
import AppHeader from './components/AppHeader.vue';
import ImageList from './components/ImageList.vue';
import CanvasStage from './components/CanvasStage.vue';
import ImagePanel from './components/ImagePanel.vue';
import ToolPanel from './components/ToolPanel.vue';
import PaperPanel from './components/PaperPanel.vue';
import ViewControls from './components/ViewControls.vue';
import FramePanel from './components/FramePanel.vue';
import ExportDialog from './components/ExportDialog.vue';

const showExport = ref(''); // '' | 'normal' | 'frame'

function onKey(e) {
  const el = document.activeElement;
  const typing = ['INPUT', 'TEXTAREA'].includes(el?.tagName) && el.type !== 'range' && el.type !== 'color';
  if (e.code === 'Space' && !typing) { spaceDown.value = true; e.preventDefault(); }
  if (e.key === 'Escape' && playback.active) stopPlayback();
  if (typing) return;
  if (tool.value === 'image' && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); deleteSelectedPic(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
}
function onPaste(e) {
  const el = document.activeElement;
  if (['INPUT', 'TEXTAREA'].includes(el?.tagName) && el.type !== 'range' && el.type !== 'color') return;
  for (const it of e.clipboardData?.items || []) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) { e.preventDefault(); pasteImageBlob(f); return; }
    }
  }
}
function onKeyUp(e) { if (e.code === 'Space') spaceDown.value = false; }

// 子(キャンバスのエンジン作成)のマウント後に実行される
onMounted(() => {
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('paste', onPaste);
  init();
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('paste', onPaste);
});
</script>

<template>
  <AppHeader @export="showExport = 'normal'" />
  <ImageList />
  <CanvasStage />
  <aside class="right">
    <ToolPanel kind="line" />
    <ToolPanel kind="brush" />
    <ImagePanel />
    <PaperPanel />
    <FramePanel @print="showExport = 'frame'" />
    <ViewControls />
  </aside>
  <ExportDialog v-if="showExport" :frame="showExport === 'frame'" @close="showExport = ''" />
</template>

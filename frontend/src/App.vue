<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { spaceDown } from './store.js';
import { init, undo, redo } from './documents.js';
import AppHeader from './components/AppHeader.vue';
import ImageList from './components/ImageList.vue';
import CanvasStage from './components/CanvasStage.vue';
import ToolPicker from './components/ToolPicker.vue';
import ToolPanel from './components/ToolPanel.vue';
import PaperPanel from './components/PaperPanel.vue';
import ViewControls from './components/ViewControls.vue';
import ExportDialog from './components/ExportDialog.vue';

const showExport = ref(false);

function onKey(e) {
  const el = document.activeElement;
  const typing = ['INPUT', 'TEXTAREA'].includes(el?.tagName) && el.type !== 'range' && el.type !== 'color';
  if (e.code === 'Space' && !typing) { spaceDown.value = true; e.preventDefault(); }
  if (typing) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
}
function onKeyUp(e) { if (e.code === 'Space') spaceDown.value = false; }

// 子(キャンバスのエンジン作成)のマウント後に実行される
onMounted(() => {
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  init();
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('keyup', onKeyUp);
});
</script>

<template>
  <AppHeader @export="showExport = true" />
  <ImageList />
  <CanvasStage />
  <aside class="right">
    <ToolPicker />
    <ToolPanel kind="line" />
    <ToolPanel kind="brush" />
    <PaperPanel />
    <ViewControls />
  </aside>
  <ExportDialog v-if="showExport" @close="showExport = false" />
</template>

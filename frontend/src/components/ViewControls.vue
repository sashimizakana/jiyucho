<script setup>
// 元に戻す / やり直し / 表示位置のリセット
import { canUndo, canRedo } from '../store.js';
import { undo, redo, resetView, fitView } from '../documents.js';
</script>

<template>
  <section class="group">
    <div class="tools small">
      <button @click="undo" :disabled="!canUndo" title="元に戻す (Ctrl+Z)"><i class="fa-solid fa-rotate-left"></i></button>
      <button @click="redo" :disabled="!canRedo" title="やり直し (Ctrl+Y)"><i class="fa-solid fa-rotate-right"></i></button>
      <button @click="resetView" title="原点・100%に戻す"><i class="fa-solid fa-crosshairs"></i></button>
      <button @click="fitView" title="絵全体を表示"><i class="fa-solid fa-expand"></i></button>
    </div>
    <p class="hint">ホイール: 拡大縮小 / スペース or 中ボタン+ドラッグ: 移動</p>
  </section>
</template>

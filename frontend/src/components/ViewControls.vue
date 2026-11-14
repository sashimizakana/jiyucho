<script setup>
// 元に戻す / やり直し / 表示位置のリセット
import { canUndo, canRedo, playback } from '../store.js';
import { undo, redo, resetView, fitView, startPlayback } from '../documents.js';
</script>

<template>
  <section class="group">
    <div class="tools small">
      <button @click="undo" :disabled="!canUndo || playback.active" title="元に戻す (Ctrl+Z)"><i class="fa-solid fa-rotate-left"></i></button>
      <button @click="redo" :disabled="!canRedo || playback.active" title="やり直し (Ctrl+Y)"><i class="fa-solid fa-rotate-right"></i></button>
      <button @click="resetView" title="原点・100%に戻す"><i class="fa-solid fa-crosshairs"></i></button>
      <button @click="fitView" title="絵全体を表示"><i class="fa-solid fa-expand"></i></button>
      <button @click="startPlayback" :disabled="playback.active" title="描画を再生"><i class="fa-solid fa-play"></i></button>
    </div>
    <p class="hint">ホイール: 拡大縮小 / スペース or 中ボタン+ドラッグ: 移動</p>
  </section>
</template>

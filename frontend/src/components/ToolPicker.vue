<script setup>
// 線 / 筆 / 移動 の切り替え。消しゴム中も親の線・筆がオン表示になる
import { tool, eraserOf } from '../store.js';

const isOn = (kind) => tool.value === kind || tool.value === eraserOf(kind);
</script>

<template>
  <section class="group">
    <div class="tools">
      <button :class="{on: isOn('line')}" @click="tool = 'line'" title="線 (鉛筆)"><i class="fa-solid fa-pencil"></i><span>線</span></button>
      <button :class="{on: isOn('brush')}" @click="tool = 'brush'" title="筆"><i class="fa-solid fa-paintbrush"></i><span>筆</span></button>
      <button :class="{on: tool === 'image'}" @click="tool = 'image'" title="画像 (Ctrl+Vで貼り付け / ドラッグで移動 / 角でリサイズ / Deleteで削除)"><i class="fa-solid fa-image"></i><span>画像</span></button>
      <button :class="{on: tool === 'hand'}" @click="tool = 'hand'" title="移動 (スペース+ドラッグ)"><i class="fa-solid fa-hand"></i><span>移動</span></button>
    </div>
  </section>
</template>

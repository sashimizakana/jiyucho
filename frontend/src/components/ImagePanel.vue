<script setup>
// 画像(貼り付け画像)ツール。ブロックを選ぶとアクティブになり、キャンバス上で画像を動かせる
import { computed } from 'vue';
import { tool } from '../store.js';

const active = computed(() => tool.value === 'image');
function activate() { tool.value = 'image'; }
</script>

<template>
  <section class="group tool" :class="{active}" @pointerdown="activate">
    <h3><i class="fa-solid fa-image"></i> 画像</h3>
    <p class="hint" style="margin-top:0">Ctrl+V で貼り付け。ドラッグで移動、角でリサイズ、Delete で削除。</p>
  </section>
</template>

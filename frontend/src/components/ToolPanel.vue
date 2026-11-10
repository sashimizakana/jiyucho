<script setup>
// 線 または 筆 の設定パネル。消しゴムはこのパネルの中で切り替える
import { computed } from 'vue';
import { tool, st, eraserOf, commitColor, pickColor, persist } from '../store.js';

const props = defineProps({
  kind: { type: String, required: true }, // 'line' | 'brush'
});

const eraser = computed(() => eraserOf(props.kind));
const erasing = computed(() => tool.value === eraser.value);
const active = computed(() => tool.value === props.kind || erasing.value);
const label = computed(() => (props.kind === 'line' ? '線' : '筆'));
const icon = computed(() => (erasing.value ? 'fa-eraser' : props.kind === 'line' ? 'fa-pencil' : 'fa-paintbrush'));
const maxSize = computed(() => (props.kind === 'line' ? 24 : 120));
const eraserTitle = computed(() => (props.kind === 'line' ? '消しゴム(線だけ消す)' : '消しゴム(筆だけ消す)'));

// パネルのどこかを触ったら、このツールを選ぶ(消しゴム中はそのまま)
function activate() { if (!active.value) tool.value = props.kind; }
function toggleEraser() { tool.value = erasing.value ? props.kind : eraser.value; }
function pick(c) { tool.value = props.kind; pickColor(props.kind, c); }
</script>

<template>
  <section class="group tool" :class="{active}" @pointerdown="activate">
    <h3>
      <i class="fa-solid" :class="icon"></i>
      {{ label }}<span v-if="erasing"> ・ 消しゴム</span>
    </h3>
    <div class="row" v-if="erasing">
      <input type="range" min="2" max="200" v-model.number="st[eraser].size" @change="persist">
      <span class="num">{{ st[eraser].size }}</span>
    </div>
    <div class="row" v-else>
      <input type="color" v-model="st[kind].color" @change="commitColor(kind)">
      <input type="range" min="1" :max="maxSize" v-model.number="st[kind].size" @change="persist">
      <span class="num">{{ st[kind].size }}</span>
    </div>
    <div class="swatches-wrap">
      <div class="swatches">
        <button v-for="c in st[kind].history" :key="c" class="sw" :class="{sel: c === st[kind].color}" :style="{background: c}" :title="c" @click="pick(c)"></button>
      </div>
      <button class="erase-sq" :class="{on: erasing}" :title="eraserTitle" @pointerdown.stop @click="toggleEraser"><i class="fa-solid fa-eraser"></i></button>
    </div>
  </section>
</template>

<script setup>
import { ref } from 'vue';
import { cur } from '../store.js';
import { exportPng } from '../documents.js';

const emit = defineEmits(['close']);

const bgs = [
  { k: 'transparent', n: '透明' },
  { k: 'paper', n: '紙の色' },
  { k: 'white', n: '白' },
  { k: 'black', n: '黒' },
];
const bg = ref('transparent');
const custom = ref('#ffffff');

const bgValue = (k) => ({
  transparent: 'transparent', paper: cur.paper, white: '#ffffff', black: '#000000', custom: custom.value,
})[k];

function download() {
  exportPng(bg.value === 'transparent' ? null : bgValue(bg.value));
  emit('close');
}
</script>

<template>
  <div class="modal" @click.self="emit('close')">
    <div class="dialog">
      <h2><i class="fa-solid fa-file-export"></i> PNG書き出し</h2>
      <p class="sub">背景色</p>
      <div class="bgs">
        <label v-for="b in bgs" :key="b.k" :class="{on: bg === b.k}">
          <input type="radio" :value="b.k" v-model="bg">
          <span class="chip" :class="{checker: b.k === 'transparent'}" :style="{background: bgValue(b.k)}"></span>{{ b.n }}
        </label>
        <label :class="{on: bg === 'custom'}">
          <input type="radio" value="custom" v-model="bg">
          <input type="color" v-model="custom" @input="bg = 'custom'"> 好きな色
        </label>
      </div>
      <div class="actions">
        <button class="btn" @click="emit('close')">キャンセル</button>
        <button class="btn primary" @click="download"><i class="fa-solid fa-download"></i> ダウンロード</button>
      </div>
    </div>
  </div>
</template>

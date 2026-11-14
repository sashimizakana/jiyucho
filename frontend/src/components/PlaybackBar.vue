<script setup>
// 再生モードの操作バー: 再生/一時停止・シーク・速度・終了
import { playback } from '../store.js';
import { playPause, seekPlayback, setPlaySpeed, stopPlayback } from '../documents.js';

const SPEEDS = [1, 2, 4, 8, 16, 32, 64];
</script>

<template>
  <div class="playbar" v-if="playback.active">
    <button @click="playPause" :title="playback.playing ? '一時停止' : '再生'">
      <i class="fa-solid" :class="playback.playing ? 'fa-pause' : 'fa-play'"></i>
    </button>
    <input type="range" min="0" :max="playback.total" step="1" :value="playback.pos"
      @input="seekPlayback(+$event.target.value)" />
    <select :value="playback.speed" @change="setPlaySpeed(+$event.target.value)" title="再生速度">
      <option v-for="s in SPEEDS" :key="s" :value="s">×{{ s }}</option>
    </select>
    <button @click="stopPlayback" title="再生を終了 (Esc)"><i class="fa-solid fa-xmark"></i></button>
  </div>
</template>

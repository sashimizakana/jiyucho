<script setup>
import { cur, PAPERS as papers } from '../store.js';
import { setPaper } from '../documents.js';
</script>

<template>
  <section class="group">
    <h3><i class="fa-regular fa-note-sticky"></i> 紙の色</h3>
    <div class="row">
      <input type="color" :value="cur.paper" @input="setPaper($event.target.value)" :disabled="!cur.id">
      <div class="swatches inline">
        <button v-for="p in papers" :key="p.c" class="sw" :style="{background: p.c}" :title="p.n" @click="setPaper(p.c)"></button>
      </div>
    </div>
  </section>
</template>

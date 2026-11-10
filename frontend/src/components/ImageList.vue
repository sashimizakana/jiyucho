<script setup>
import { cur, images } from '../store.js';
import { newImage, openImage, removeImage } from '../documents.js';

function fmtDate(s) {
  const d = new Date(s);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
</script>

<template>
  <aside class="left">
    <button class="btn primary wide" @click="newImage"><i class="fa-solid fa-plus"></i> 新しい絵</button>
    <div class="history">
      <div v-for="im in images" :key="im.id" class="item" :class="{active: im.id === cur.id}" @click="openImage(im.id)">
        <div class="thumb" :style="{background: im.paper}">
          <img :src="'/api/images/' + im.id + '/thumb.png?v=' + encodeURIComponent(im.updatedAt)" @error="$event.target.style.display='none'" @load="$event.target.style.display=''">
        </div>
        <div class="meta">
          <div class="name">{{ im.title || '(無題)' }}</div>
          <div class="date">{{ fmtDate(im.updatedAt) }}</div>
        </div>
        <button class="del" title="削除" @click.stop="removeImage(im)"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    </div>
  </aside>
</template>

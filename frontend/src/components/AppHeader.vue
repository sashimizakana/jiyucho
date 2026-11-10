<script setup>
import { cur, status } from '../store.js';
import { scheduleSave } from '../documents.js';

defineEmits(['export']);
</script>

<template>
  <header class="top">
    <div class="brand"><i class="fa-solid fa-pencil"></i> 自由帳</div>
    <input class="title" v-model="cur.title" @input="scheduleSave" placeholder="タイトルを入力" :disabled="!cur.id" maxlength="100">
    <span class="status">{{ status }}</span>
    <button class="btn" @click="$emit('export')" :disabled="!cur.id"><i class="fa-solid fa-file-export"></i> PNG書き出し</button>
  </header>
</template>

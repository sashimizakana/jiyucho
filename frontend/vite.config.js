import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 開発時: `jiyucho -port 8787 -no-open` を起動しておき、`npm run dev` で API をそこへ中継する
const API = process.env.JIYUCHO_API || 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [vue()],
  server: { proxy: { '/api': API } },
});

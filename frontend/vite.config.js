import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 開発時: `jiyucho -port 8787 -no-open` を起動しておき、`npm run dev` で API をそこへ中継する
const API = process.env.JIYUCHO_API || 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [vue()],
  // ビルド結果は Go 側が go:embed する ../web に出力する
  build: { outDir: '../web', emptyOutDir: true },
  server: { proxy: { '/api': API } },
});

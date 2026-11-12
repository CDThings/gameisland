import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// 引擎以 @space/shared 别名指向上级 shared/ 目录（与上游仓库 packages/shared 同构，
// 引擎单测 node --test shared/test/ 直跑，无需打包器参与）
export default defineConfig({
  base: './', // 插件包 / 本地文件 / 任意子路径托管都需要相对寻址（DBX 沙箱硬要求）
  plugins: [vue()],
  resolve: {
    alias: [
      { find: '@space/shared/cards', replacement: path.resolve(root, '../shared/src/cards') },
      { find: '@space/shared/orientation', replacement: path.resolve(root, '../shared/src/orientation.js') },
      { find: '@space/shared', replacement: path.resolve(root, '../shared/src/index.js') },
    ],
  },
  server: { port: 5173 },
  build: {
    sourcemap: false,
    outDir: '../ui', // 直接产出 DBX 插件包 ui/ 目录
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    // 单文件内联：DBX 开发宿主的沙箱 CSP 只放行 inline/blob（connect-src 'none'），
    // 懒加载 chunk 无法在沙箱内取回；插件体积小（~240KB），关掉代码分割换全环境可跑
    rollupOptions: { output: { inlineDynamicImports: true } }
  }
});

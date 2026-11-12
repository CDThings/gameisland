import { createApp } from 'vue';
import App from './App.vue';
import router from './router.js';
import { bindTapSfx } from './ui/sfx.js';
import { hydrateStorage } from './env.js';
import './style.css';

// 启动时序：先等宿主桥就绪 + 存档水合（DBX 插件沙箱），再挂载——
// 保证牌桌续档、静音偏好等在首帧渲染前就位。非插件环境 hydrateStorage 立即返回。
hydrateStorage().finally(() => {
  bindTapSfx();
  createApp(App).use(router).mount('#app');
});

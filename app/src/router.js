import { createRouter, createMemoryHistory } from 'vue-router';

// 插件版只保留离线可玩路由：岛首页 + 四牌桌 + 亲子小游戏。
// 培育小游戏（依赖服务端开局/结算会话）与登录、积分、排行榜页不随插件分发。
//
// 路由用 memory 模式：DBX 宿主与开发宿主的插件 UI 都跑在沙箱 iframe 里
// （真宿主 dbx-plugin://、开发宿主 about:srcdoc），hash 写入在 srcdoc 上会
// 触发 iframe 导航炸掉沙箱；memory 模式零 URL 依赖，入口固定落岛首页。
const routes = [
  { path: '/', redirect: '/island' },
  { path: '/island', name: 'island', component: () => import('./pages/Island.vue') },
  { path: '/cards/guandan', name: 'guandan', component: () => import('./pages/GuandanRoom.vue') },
  { path: '/cards/niuniu', name: 'niuniu', component: () => import('./pages/NiuNiuRoom.vue') },
  { path: '/cards/holdem', name: 'holdem', component: () => import('./pages/HoldemRoom.vue') },
  { path: '/cards/mahjong', name: 'mahjong', component: () => import('./pages/MahjongRoom.vue') },
  { path: '/kids/:id', name: 'kid', component: () => import('./pages/KidHost.vue'), props: true },
  { path: '/:pathMatch(.*)*', redirect: '/island' }
];

const router = createRouter({
  history: createMemoryHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
});

export default router;

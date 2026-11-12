// v1.94 亲子小游戏注册表：六款纯本地游戏（零 API，离线/访客可玩，与四牌桌同模式）
// recordType 决定 KidHost 战绩 chip 与结算写档：
//   best-high=分越高越好（打地鼠） / best-low=秒数越短越好（扫雷） / wins=累计胜场（棋类） / null=无数值（自由玩）
// rules = 「玩法」弹层文案（可爱短句，孩子能直接读懂；v1.94 UI/UE 轮加入）
import { defineAsyncComponent } from 'vue';
import { localGet, localSet } from '../env.js';
// v1.97 懒加载：每款游戏独立 chunk，岛面/壳秒开，进哪个游戏才拉哪个（本地文件几乎无感）
const lazy = (load) => defineAsyncComponent(load);

export const KID_GAMES = {
  whack: {
    id: 'whack', name: '打地鼠', goal: '冒头的地鼠，快点它！', comp: lazy(() => import('./WhackGame.vue')), recordType: 'best-high', recordText: '最佳 {n} 分',
    rules: [
      '地鼠冒头就快点它，点中 +1 分！',
      '戴星星的金地鼠要 +3 分哦',
      '30 秒，看看你能敲到多少只！',
    ],
  },
  fishing: {
    id: 'fishing', name: '小猫钓鱼', goal: '翻到同点数，中间全收走！', comp: lazy(() => import('./FishingGame.vue')), recordType: 'wins', recordText: '胜 {n} 场',
    rules: [
      '大家轮流向桌上翻一张牌',
      '翻出和桌上一样点数的牌，中间的牌全归你！',
      '先没牌的出局，坚持到最后就赢啦',
      '同屏玩的时候，轮到谁谁点自己的牌堆',
    ],
  },
  mines: {
    id: 'mines', name: '扫雷', goal: '避开地雷，翻开所有格子', comp: lazy(() => import('./MinesGame.vue')), recordType: 'best-low', recordText: '最快 {n} 秒',
    rules: [
      '翻开所有没有地雷的格子就赢！',
      '数字 = 它周围藏着几颗地雷',
      '拿不准就用「旗子」标出来，长按也能插旗',
      '不小心踩到也不怕，重来一局就好',
    ],
  },
  checkers: {
    id: 'checkers', name: '跳棋', goal: '把棋子全跳到对面就赢', comp: lazy(() => import('./CheckersGame.vue')), recordType: 'wins', recordText: '胜 {n} 场',
    rules: [
      '棋子每次走相邻一格，或者隔着棋子跳过去',
      '跳过去还能继续连跳，一口气跳很远！',
      '把自己的 10 颗棋子全跳进对角营地就赢',
      '进了营地的棋子就安家啦，不能再动',
      '同屏玩的时候，轮到谁谁走自己的颜色',
    ],
  },
  ludo: {
    id: 'ludo', name: '飞行棋', goal: '掷到 6 起飞，四个棋都到终点', comp: lazy(() => import('./LudoGame.vue')), recordType: 'wins', recordText: '胜 {n} 场',
    rules: [
      '掷到 6 才能起飞，掷到 6 还能再掷一次',
      '落在自己颜色的格子，往前跳 4 格',
      '追上敌机，把它撞回机库重新起飞',
      '绕一圈走进自己的跑道，正好数到头才算到',
      '4 架飞机全部到达终点就赢啦',
    ],
  },
  gomoku: {
    id: 'gomoku', name: '五子棋', goal: '连成五个一列就赢', comp: lazy(() => import('./GomokuGame.vue')), recordType: 'wins', recordText: '胜 {n} 场',
    rules: [
      '黑白轮流落子，黑棋先走',
      '横、竖、斜，先连成 5 个一列就赢',
      '电脑会挡你成五，也会冲着自己成五',
      '走错可以点「悔棋」，人机局一次退两手',
      '双人同屏：轮流点同一块棋盘，轮到谁谁落子',
    ],
  },
};

/** 岛内专区的展示顺序（Island.vue 与 KidHost 共用） */
export const KID_ORDER = ['whack', 'fishing', 'mines', 'checkers', 'ludo', 'gomoku'];

export function loadKidRecord(id) {
  try { return JSON.parse(localGet('cando.kids.rec.' + id) || '{}'); }
  catch { return {}; }
}
export function saveKidRecord(id, rec) {
  try { localSet('cando.kids.rec.' + id, JSON.stringify(rec)); } catch { /* quota 忽略 */ }
}

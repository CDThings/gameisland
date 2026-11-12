<script setup>
// v1.94 扫雷（儿童版）：8×8 · 10 雷 · 首点必安全（含邻格）。
// 旗子模式按钮 + 长按插旗；赢了记最快用时（best-low）；踩雷温柔提示不吓人。
// 纯本地零 API；冒烟钩子 window.__cando.kidGame = G。
import { onBeforeUnmount, reactive, ref } from 'vue';
import { sfx } from '../ui/sfx.js';

const emit = defineEmits(['finish']);

const N = 8, MINES = 10;
const NUM_COLOR = ['', '#4A90C4', '#397D59', '#B65F3B', '#6C4BB6', '#A96D1E', '#0E8A8A', '#7A5230', '#5A5A5A'];

const G = reactive({
  phase: 'idle',        // idle | playing | over
  cells: [],            // { mine, adj, revealed, flagged, boom }
  flagMode: false,
  minesLeft: MINES,
  revealed: 0,
  seconds: 0,
  result: '',           // win | lose
});
let timer = null, alive = true, longPressTimer = null, longPressed = false;

function neighbors(i) {
  const r = Math.floor(i / N), c = i % N, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < N && nc >= 0 && nc < N) out.push(nr * N + nc);
  }
  return out;
}

function start() {
  G.cells = Array.from({ length: N * N }, () => ({ mine: false, adj: 0, revealed: false, flagged: false, boom: false }));
  G.phase = 'playing';
  G.flagMode = false; G.minesLeft = MINES; G.revealed = 0; G.seconds = 0; G.result = '';
  sfx.tap();
  clearInterval(timer);
  timer = setInterval(() => { if (alive && G.phase === 'playing' && G.cells.some(c => c.revealed)) G.seconds += 1; }, 1000);
  window.__cando = window.__cando || {};
  window.__cando.kidGame = G;
}

function placeMines(firstIdx) {
  // 首点及其邻格都不放雷（儿童保护：第一步永远有数字可看）
  const banned = new Set([firstIdx, ...neighbors(firstIdx)]);
  const pool = [];
  for (let i = 0; i < N * N; i++) if (!banned.has(i)) pool.push(i);
  for (let k = 0; k < MINES; k++) {
    const j = k + Math.floor(Math.random() * (pool.length - k));
    [pool[k], pool[j]] = [pool[j], pool[k]];
    G.cells[pool[k]].mine = true;
  }
  for (let i = 0; i < N * N; i++) {
    if (!G.cells[i].mine) G.cells[i].adj = neighbors(i).filter(n => G.cells[n].mine).length;
  }
}

function reveal(idx) {
  if (G.phase !== 'playing') return;
  const c = G.cells[idx];
  if (c.revealed || c.flagged) return;
  if (!G.cells.some(x => x.mine)) placeMines(idx);
  if (c.mine) {
    c.revealed = true; c.boom = true;
    G.cells.forEach(x => { if (x.mine) x.revealed = true; });
    endGame('lose');
    return;
  }
  // 泛洪展开
  const stack = [idx];
  while (stack.length) {
    const i = stack.pop();
    const cc = G.cells[i];
    if (cc.revealed || cc.flagged || cc.mine) continue;
    cc.revealed = true;
    G.revealed += 1;
    if (cc.adj === 0) for (const n of neighbors(i)) if (!G.cells[n].revealed) stack.push(n);
  }
  sfx.flip();
  if (G.revealed >= N * N - MINES) {
    G.cells.forEach(x => { if (x.mine) x.flagged = true; });
    endGame('win');
  }
}

function toggleFlag(idx) {
  if (G.phase !== 'playing') return;
  const c = G.cells[idx];
  if (c.revealed) return;
  c.flagged = !c.flagged;
  G.minesLeft = MINES - G.cells.filter(x => x.flagged).length;
  sfx.tap();
}

function cellDown(idx) {
  longPressed = false;
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    longPressed = true;
    toggleFlag(idx);
  }, 420);
}
function cellUp(idx) {
  clearTimeout(longPressTimer);
  if (!longPressed) {
    if (G.flagMode) toggleFlag(idx);
    else reveal(idx);
  }
}

function endGame(result) {
  if (G.phase !== 'playing') return;
  G.phase = 'over';
  G.result = result;
  clearInterval(timer);
  if (result === 'win') {
    emit('finish', {
      title: '全部找出来啦！', win: true, value: G.seconds, score: G.seconds,
      stars: 3, sub: `用时 ${G.seconds} 秒 · 一个地雷都没踩到`,
    });
  } else {
    emit('finish', {
      title: '哎呀，踩到地雷', win: false, stars: 1,
      sub: '红旗标出来再慢慢翻，再来一局！',
    });
  }
}

onBeforeUnmount(() => {
  alive = false;
  clearInterval(timer);
  clearTimeout(longPressTimer);
});
</script>

<template>
  <div class="mines">
    <!-- 开始页 -->
    <div class="m-intro" v-if="G.phase === 'idle'">
      <div class="m-big">
        <svg viewBox="0 0 48 48"><circle cx="24" cy="26" r="13" fill="#2F2C27"/><path d="M24 8v7M24 37v7M6 26h7M35 26h7M11 13l5 5M32 34l5 5M37 13l-5 5M16 34l-5 5" stroke="#2F2C27" stroke-width="3.4" stroke-linecap="round"/><circle cx="20" cy="22" r="3" fill="#fff"/></svg>
      </div>
      <p class="m-tip">翻开所有<b>没有地雷</b>的格子，<br/>数字告诉它周围有几颗雷，<br/>点旗子按钮可以标记地雷。</p>
      <button class="m-start" @click="start">开始游戏</button>
    </div>

    <template v-if="G.phase !== 'idle'">
      <!-- 工具条：剩余雷数 / 旗子模式 / 重开 -->
      <div class="m-bar">
        <div class="m-chip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V4"/><path d="M6 4h12l-2.5 3.5L18 11H6"/></svg>
          剩 <b>{{ G.minesLeft }}</b>
        </div>
        <div class="m-chip">第 <b>{{ G.seconds }}</b> 秒</div>
        <button class="m-flagbtn" :class="{ on: G.flagMode }" @click="G.flagMode = !G.flagMode; sfx.tap()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V4"/><path d="M6 4h12l-2.5 3.5L18 11H6"/></svg>
          {{ G.flagMode ? '插旗中' : '旗子' }}
        </button>
        <button class="m-again" @click="start">重开</button>
      </div>

      <!-- 雷区 -->
      <div class="m-grid">
        <button v-for="(c, i) in G.cells" :key="i"
          class="m-cell"
          :class="{ open: c.revealed, boom: c.boom, n1: c.revealed && c.adj === 1, n2: c.revealed && c.adj === 2, n3: c.revealed && c.adj === 3, n4: c.revealed && c.adj >= 4 }"
          @pointerdown.prevent="cellDown(i)" @pointerup="cellUp(i)" @pointerleave="clearTimeout(longPressTimer)" @contextmenu.prevent="toggleFlag(i)">
          <template v-if="c.revealed">
            <span v-if="c.adj" class="m-num">{{ c.adj }}</span>
            <svg v-else-if="c.mine" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="#2F2C27"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" stroke="#2F2C27" stroke-width="2" stroke-linecap="round"/></svg>
          </template>
          <svg v-else-if="c.flagged" class="m-flag" viewBox="0 0 24 24" fill="none" stroke="#B65F3B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21V4"/><path d="M7 4h10l-2.5 3.5L17 11H7" fill="#E0784A"/></svg>
        </button>
      </div>
      <div class="m-help">长按或用「旗子」按钮标记地雷</div>
    </template>
  </div>
</template>

<style scoped>
.mines { width: 100%; max-width: 500px; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.m-intro { text-align: center; padding-top: 4px; }
.m-big { width: 96px; height: 96px; margin: 0 auto; }
.m-big svg { width: 100%; height: 100%; }
.m-tip { margin: 12px 0 0; font-size: 15px; line-height: 2; color: var(--hn-muted, #777168); }
.m-tip b { color: var(--hn-coral, #E0784A); }
.m-start {
  margin-top: 16px; border: 0; cursor: pointer;
  background: var(--hn-green, #3E9B6E); color: #fff;
  font-size: 19px; font-weight: 800; font-family: inherit;
  border-radius: 20px; padding: 16px 52px;
  box-shadow: 0 6px 0 var(--hn-green-deep, #397D59);
  transition: transform 0.1s ease, box-shadow 0.1s ease;
}
.m-start:active { transform: translateY(5px); box-shadow: 0 1px 0 var(--hn-green-deep, #397D59); }

.m-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; justify-content: center; }
.m-chip {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--hn-paper, #FFFCF7); border-radius: 999px; padding: 7px 13px;
  font-size: 13px; color: var(--hn-muted, #777168);
  box-shadow: var(--hn-shadow-card, 0 8px 22px rgba(86, 66, 43, 0.045));
}
.m-chip b { color: var(--hn-ink, #2F2C27); font-size: 15px; }
.m-chip svg { width: 15px; height: 15px; color: var(--hn-coral, #E0784A); }
.m-flagbtn, .m-again {
  border: 0; cursor: pointer; border-radius: 999px; padding: 8px 15px;
  font-size: 13px; font-weight: 800; font-family: inherit;
  background: var(--hn-paper, #FFFCF7); color: var(--hn-ink, #2F2C27);
  box-shadow: var(--hn-shadow-card, 0 8px 22px rgba(86, 66, 43, 0.045));
  display: inline-flex; align-items: center; gap: 5px;
}
.m-flagbtn svg { width: 15px; height: 15px; }
.m-flagbtn.on { background: var(--hn-orange-soft, #F9EBD8); color: var(--hn-orange-deep, #A96D1E); }
.m-again { background: var(--hn-sand, #E9E0D3); }

.m-grid {
  display: grid; grid-template-columns: repeat(8, 1fr); gap: 3px;
  background: var(--hn-paper, #FFFCF7); border-radius: 18px; padding: 8px;
  box-shadow: var(--hn-shadow-card, 0 8px 22px rgba(86, 66, 43, 0.045));
  /* v1.99 正形盘按真实视口高钳制（横屏 8 行放不下时整体缩进屏内） */
  width: min(100%, calc(var(--vh, 100vh) - 180px));
  margin: 0 auto;
}
.m-cell {
  aspect-ratio: 1; border: 0; cursor: pointer; padding: 0;
  border-radius: 7px;
  background: linear-gradient(180deg, #F3EBDD 0%, #E9E0D3 100%);
  box-shadow: inset 0 -2px 0 rgba(86, 66, 43, 0.14);
  display: flex; align-items: center; justify-content: center;
  touch-action: manipulation;
  font: inherit;
}
.m-cell.open { background: var(--hn-paper, #FFFCF7); box-shadow: inset 0 0 0 1.5px var(--hn-line-soft, #EEE6DA); cursor: default; }
.m-cell.boom { background: var(--hn-coral-soft, #F8E7DF); }
.m-cell svg { width: 62%; height: 62%; }
.m-num { font-size: 17px; font-weight: 900; }
.n1 .m-num { color: #4A90C4; } .n2 .m-num { color: #397D59; } .n3 .m-num { color: #B65F3B; }
.n4 .m-num { color: #6C4BB6; }
.m-help { margin-top: 10px; font-size: 11px; color: var(--hn-faint, #A69D91); }
/* v1.99 手机横屏：格距/字号收紧，数字仍可读 */
@media (orientation: landscape) and (max-height: 500px) {
  .m-grid { gap: 2px; padding: 6px; border-radius: 14px; }
  .m-num { font-size: 13px; }
  .m-cell { border-radius: 5px; }
  .m-help { margin-top: 6px; font-size: 10px; }
}
</style>

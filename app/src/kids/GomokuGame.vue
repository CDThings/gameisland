<script setup>
// v1.96 亲子小游戏·五子棋：15×15 标准盘，支持 人机对战（你执黑先走）/ 2 人同屏热座。
// 规则：轮流落子，先连成五连者胜；满盘无五连为和。AI=启发式（四向连型打分：进攻+防御，会挡五/冲四）。
// 纯本地零 API；冒烟钩子 window.__cando.kidGame = G, kidApi = { tap, undo, aiMove, checkWin, cellVal }。
import { computed, onBeforeUnmount, reactive } from 'vue';
import { sfx } from '../ui/sfx.js';

const emit = defineEmits(['finish']);

const N = 15;
const B = 310, PAD = 20;
const CELL = (B - 2 * PAD) / (N - 1);
const idx = (x, y) => y * N + x;
const inB = (x, y) => x >= 0 && x < N && y >= 0 && y < N;
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const STARS = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];

const MODES = [
  { id: 'ai', label: '人机对战', hint: '你执黑先走，电脑执白' },
  { id: 'p2', label: '2 人同屏', hint: '黑先白后，轮流落子' },
];
const nameOf = (mode, p) => {
  if (mode === 'ai') return p === 1 ? '你' : '电脑';
  return p === 1 ? '玩家1（黑）' : '玩家2（白）';
};

const G = reactive({
  phase: 'idle',        // idle | playing | over
  mode: '',
  board: new Array(N * N).fill(0),
  history: [],          // [{ x, y, p }]
  turn: 1,
  busy: false,          // AI 思考中
  winner: 0,
  winLine: [],
  msg: '',
});
let aiTimer = null, alive = true;

function start(modeId) {
  G.mode = modeId;
  G.board = new Array(N * N).fill(0);
  G.history = [];
  G.turn = 1;
  G.busy = false;
  G.winner = 0;
  G.winLine = [];
  G.phase = 'playing';
  G.msg = '黑棋先走';
  sfx.tap();
  window.__cando = window.__cando || {};
  window.__cando.kidGame = G;
  window.__cando.kidApi = { tap, undo, aiMove, checkWin, cellVal, N };
}

function tap(x, y) {
  if (G.phase !== 'playing' || G.busy || G.winner) return;
  if (G.board[idx(x, y)] !== 0) return;
  place(x, y, G.turn);
  if (G.winner) return endGame(G.winner);
  G.turn = G.turn === 1 ? 2 : 1;
  G.msg = '轮到 ' + nameOf(G.mode, G.turn);
  if (G.mode === 'ai' && G.turn === 2) {
    G.busy = true;
    G.msg = '电脑思考中…';
    aiTimer = setTimeout(() => { if (alive) aiMove(); }, 480 + Math.random() * 280);
  }
}

/** SVG 指针落点 → 最近交叉点（viewBox 缩放还原） */
function onBoard(evt) {
  if (G.phase !== 'playing' || G.busy || G.winner) return;
  const svg = evt.currentTarget;
  const r = svg.getBoundingClientRect();
  const scale = B / r.width;
  const x = Math.round(((evt.clientX - r.left) * scale - PAD) / CELL);
  const y = Math.round(((evt.clientY - r.top) * scale - PAD) / CELL);
  if (!inB(x, y)) return;
  tap(x, y);
}

function place(x, y, p) {
  G.board[idx(x, y)] = p;
  G.history.push({ x, y, p });
  sfx.tap();
  sfx.buzz(14); // 落子轻震（成五另有结算反馈）
  G.winLine = checkWin(x, y, p);
  if (G.winLine.length) G.winner = p;
}

/** 五连（含 >5）判定：返回连线坐标数组，未成空数组 */
function checkWin(x, y, p) {
  for (const [dx, dy] of DIRS) {
    let line = [{ x, y }];
    let i = 1;
    while (inB(x + dx * i, y + dy * i) && G.board[idx(x + dx * i, y + dy * i)] === p) { line.push({ x: x + dx * i, y: y + dy * i }); i++; }
    i = 1;
    while (inB(x - dx * i, y - dy * i) && G.board[idx(x - dx * i, y - dy * i)] === p) { line.unshift({ x: x - dx * i, y: y - dy * i }); i++; }
    if (line.length >= 5) return line;
  }
  return [];
}

/** v1.97 方向连型值（窗口式，假设 p 落 (x,y)）：以落点为中心取 9 格线滑 5 窗打分。
 *  旧版只数「连续同色子」，对跳三(●●_●)/跳四(●●●_●)全盲易被破解；窗口式天然看见空档连型。
 *  五=1e7 / 活四(_●●●●_)=1e6 / 冲四(含跳四)=1e5 / 活三(含跳三)=5e4 / 活二=2e3 / 活一=200 */
function dirVal(x, y, dx, dy, p) {
  const cells = new Array(9);
  for (let i = -4; i <= 4; i++) {
    if (i === 0) { cells[i + 4] = 1; continue; }
    const nx = x + dx * i, ny = y + dy * i;
    cells[i + 4] = !inB(nx, ny) ? 3 : (G.board[idx(nx, ny)] === 0 ? 0 : (G.board[idx(nx, ny)] === p ? 1 : 3));
  }
  let best = 0;
  for (let s = 0; s <= 4; s++) {
    let stones = 0, bad = false;
    for (let k = s; k < s + 5; k++) {
      if (cells[k] === 3) { bad = true; break; }
      if (cells[k] === 1) stones++;
    }
    if (bad) continue;
    const empt = 5 - stones;
    const sc = stones === 5 ? 10000000
      : stones === 4 ? (empt === 1 ? 100000 : 0)
      : stones === 3 ? (empt === 2 ? 50000 : 0)
      : stones === 2 ? (empt === 3 ? 2000 : 0)
      : stones === 1 ? (empt === 4 ? 200 : 0) : 0;
    if (sc > best) best = sc;
  }
  if (cells.join('').includes('011110')) best = Math.max(best, 1000000); // 真·活四（两端都空）
  return best;
}
function cellVal(x, y, p) {
  let v = 0;
  for (const d of DIRS) v += dirVal(x, y, d[0], d[1], p);
  return v;
}

/** AI（白棋）四级战术：①自己能成五立即下 ②对方要成五必须挡
 *  ③自己已有活四（两端成五点，挡不住）→ 立即摆上（旧版会去挡对方活三错失必胜节奏）
 *  ④综合启发分（进攻 + 1.05×威胁，挡对方活三/冲四由权重自然涌现） */
function aiMove() {
  if (!alive || G.phase !== 'playing' || G.winner) { G.busy = false; return; }
  const p = 2, o = 1;
  const cands = new Set();
  let any = false;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (G.board[idx(x, y)] === 0) continue;
    any = true;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (inB(nx, ny) && G.board[idx(nx, ny)] === 0) cands.add(idx(nx, ny));
    }
  }
  if (!any) cands.add(idx(7, 7));
  const vals = [];
  for (const c of cands) {
    const x = c % N, y = (c / N) | 0;
    vals.push({ c, x, y, own: cellVal(x, y, p), opp: cellVal(x, y, o) });
  }
  // ① 自己能成五 → 立即赢
  const winNow = vals.find(v => v.own >= 10000000);
  if (winNow) return doAiPlace(winNow.c, p);
  // ② 挡对方成五
  const mustBlock = vals.filter(v => v.opp >= 10000000).sort((a, b) => b.opp - a.opp)[0];
  if (mustBlock) return doAiPlace(mustBlock.c, p);
  // ③ 自己的活四（下一手双点成五，对方挡不完）
  const liveFour = vals.find(v => v.own >= 1000000);
  if (liveFour) return doAiPlace(liveFour.c, p);
  // ③ 综合分（进攻 + 1.05×对方威胁，活四/活三自然浮现）
  let best = null, bestS = -1;
  for (const v of vals) {
    const s = v.own + v.opp * 1.05 + Math.random() * 3;   // 微量随机，避免每局同走法
    if (s > bestS) { bestS = s; best = v; }
  }
  if (!best) { G.busy = false; return; }
  doAiPlace(best.c, p);
}
function doAiPlace(c, p) {
  const bx = c % N, by = (c / N) | 0;
  place(bx, by, p);
  G.busy = false;
  if (G.winner) { G.msg = '电脑五连了'; setTimeout(() => alive && endGame(2), 500); return; }
  G.turn = 1;
  G.msg = '轮到 你';
}

function undo() {
  if (G.phase !== 'playing' || G.winner) return;
  if (G.mode === 'ai') {
    if (G.busy || G.history.length < 2) return;      // AI 思考中/不足两步不悔
    for (let k = 0; k < 2; k++) { const m = G.history.pop(); G.board[idx(m.x, m.y)] = 0; }
    G.turn = 1;
    G.msg = '已悔一步，重新落子';
  } else {
    if (G.history.length < 1) return;
    const m = G.history.pop();
    G.board[idx(m.x, m.y)] = 0;
    G.turn = m.p;
    G.msg = '已悔一步';
  }
  sfx.flip();
}

function endGame(winner) {
  G.phase = 'over';
  clearTimeout(aiTimer);
  const isDraw = winner === 0;
  if (!isDraw) {
    const humanWon = G.mode === 'p2' ? true : winner === 1;
    emit('finish', {
      title: isDraw ? '平局！' : (G.mode === 'ai' ? (winner === 1 ? '你赢啦！' : '电脑赢啦') : `${nameOf(G.mode, winner)} 赢啦！`),
      win: !isDraw && humanWon,
      stars: isDraw ? 2 : humanWon ? 3 : 1,
      sub: isDraw ? '盘满了也没成五连，再来一局！' : (G.mode === 'ai' ? (winner === 1 ? '连出五子，太厉害了！' : '电脑先连成五连，再战一局！') : `${nameOf(G.mode, winner)} 先连成五连，真棒！`),
      value: G.history.length,
    });
  } else {
    emit('finish', { title: '平局！', win: false, stars: 2, sub: '盘满了也没成五连，再来一局！', value: G.history.length });
  }
}

// ── SVG 渲染辅助 ──
const px = v => PAD + v * CELL;
const lastMove = () => G.history[G.history.length - 1] || null;
const winSet = () => new Set(G.winLine.map(c => c.x + ',' + c.y));

const stonesView = computed(() => {
  const last = lastMove();
  const ws = winSet();
  const out = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = G.board[idx(x, y)];
    if (v) out.push({ x, y, p: v, last: !!last && last.x === x && last.y === y, win: ws.has(x + ',' + y) });
  }
  return out;
});

onBeforeUnmount(() => {
  alive = false;
  clearTimeout(aiTimer);
});
</script>

<template>
  <div class="gmk">
    <!-- 开局：选模式 -->
    <div class="g-intro" v-if="G.phase === 'idle'">
      <p class="g-tip">轮流落子，谁先<b>连成五个一列</b><br/>（横竖斜都算）谁就赢！</p>
      <div class="g-modes">
        <button v-for="m in MODES" :key="m.id" class="g-mode" @click="start(m.id)">
          <b>{{ m.label }}</b><span>{{ m.hint }}</span>
        </button>
      </div>
    </div>

    <template v-else>
      <!-- 局面条：轮次 + 手数 + 操作 -->
      <div class="g-top">
        <span class="g-turn" :class="{ w: G.turn === 2 }">
          <i class="g-dot" :class="{ w: G.turn === 2 }"></i>
          {{ G.phase === 'over' ? '终局' : G.busy ? '电脑思考中…' : '轮到 ' + nameOf(G.mode, G.turn) }}
        </span>
        <span class="g-count">{{ G.history.length }} 手</span>
        <span class="g-actions">
          <button class="g-btn" @click="undo()" :disabled="G.phase !== 'playing' || (G.mode === 'ai' && (G.busy || G.history.length < 2))">悔棋</button>
          <button class="g-btn" @click="start(G.mode)">重开</button>
        </span>
      </div>

      <!-- 棋盘 -->
      <svg class="g-board" :viewBox="`0 0 ${B} ${B}`" @pointerdown.prevent="onBoard">
        <rect x="0" y="0" :width="B" :height="B" rx="10" fill="var(--hn-paper, #FFFCF7)" />
        <g stroke="#D9CBb3" stroke-width="1">
          <line v-for="i in N" :key="'v' + i" :x1="px(i - 1)" :x2="px(i - 1)" :y1="px(0)" :y2="px(N - 1)" />
          <line v-for="i in N" :key="'h' + i" :x1="px(0)" :x2="px(N - 1)" :y1="px(i - 1)" :y2="px(i - 1)" />
        </g>
        <circle v-for="[sx, sy] in STARS" :key="'s' + sx + sy" :cx="px(sx)" :cy="px(sy)" r="3.2" fill="#B99f7e" />
        <!-- 棋子（key=坐标：挂载点稳定，新子 pop-in 恰好只在落子那刻播一次） -->
        <g v-for="c in stonesView" :key="c.x + ',' + c.y" :class="{ 'g-stone-new': c.last }">
          <circle :cx="px(c.x)" :cy="px(c.y)" :r="CELL * 0.42"
            :fill="c.p === 1 ? '#2F2C27' : '#FFFCF7'"
            :stroke="c.p === 1 ? 'none' : '#2F2C27'" stroke-width="1.5" />
          <circle v-if="c.last" :cx="px(c.x)" :cy="px(c.y)" r="3.4" :fill="c.p === 1 ? '#FFFCF7' : '#2F2C27'" />
          <circle v-if="c.win" class="g-winring" :cx="px(c.x)" :cy="px(c.y)" :r="CELL * 0.42 + 2.5" fill="none" stroke="var(--hn-orange, #E8A24B)" stroke-width="3" />
        </g>
      </svg>

      <div class="g-msg">{{ G.msg }}</div>
    </template>
  </div>
</template>

<style scoped>
.gmk { width: 100%; max-width: 430px; display: flex; flex-direction: column; align-items: center; }
.g-intro { text-align: center; padding-top: 12px; }
.g-tip { font-size: 14px; line-height: 1.9; color: var(--hn-muted, #777168); margin: 0 0 14px; }
.g-tip b { color: var(--hn-coral, #E0784A); }
.g-modes { display: flex; flex-direction: column; gap: 10px; width: 240px; }
.g-mode {
  border: 0; cursor: pointer; text-align: left;
  background: var(--hn-paper, #FFFCF7); color: var(--hn-ink, #2F2C27);
  border-radius: 16px; padding: 13px 18px;
  box-shadow: var(--hn-shadow-card, 0 8px 22px rgba(86, 66, 43, 0.045));
  display: flex; align-items: baseline; justify-content: space-between;
  transition: transform 0.12s ease;
}
.g-mode:active { transform: scale(0.97); }
.g-mode b { font-size: 16px; font-weight: 800; }
.g-mode span { font-size: 12px; color: var(--hn-faint, #A69D91); }

.g-top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; width: 100%; }
.g-turn {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--hn-ink, #2F2C27); color: var(--hn-paper, #FFFCF7);
  border-radius: 999px; padding: 6px 13px; font-size: 13px; font-weight: 800;
}
.g-turn.w { background: var(--hn-paper, #FFFCF7); color: var(--hn-ink, #2F2C27); box-shadow: 0 0 0 2px var(--hn-ink, #2F2C27); }
.g-dot { width: 11px; height: 11px; border-radius: 50%; background: #2F2C27; display: inline-block; }
.g-dot.w { background: #fff; box-shadow: inset 0 0 0 2px #2F2C27; }
.g-count { font-size: 12px; color: var(--hn-muted, #777168); font-weight: 700; }
.g-actions { margin-left: auto; display: flex; gap: 6px; }
.g-btn {
  border: 0; cursor: pointer; border-radius: 10px; padding: 6px 12px;
  font-size: 12px; font-weight: 800; font-family: inherit;
  background: var(--hn-sand, #E9E0D3); color: var(--hn-ink, #2F2C27);
}
.g-btn:disabled { opacity: 0.45; cursor: default; }

.g-board { width: min(100%, 430px, calc(var(--vh, 100vh) - 150px)); height: auto; display: block; touch-action: manipulation; }
/* 落子弹入 + 五连金环呼吸（SVG 变换盒定位到自身包围盒） */
.g-stone-new { transform-box: fill-box; transform-origin: center; animation: gmk-pop 0.22s cubic-bezier(0.34, 1.56, 0.64, 1); }
@keyframes gmk-pop { from { transform: scale(0.4); opacity: 0.4; } to { transform: scale(1); opacity: 1; } }
.g-winring { animation: gmk-ring 1.1s ease-in-out infinite alternate; }
@keyframes gmk-ring { from { opacity: 0.55; } to { opacity: 1; } }
.g-msg { margin-top: 8px; font-size: 13px; font-weight: 700; color: var(--hn-muted, #777168); min-height: 1.2em; }
</style>

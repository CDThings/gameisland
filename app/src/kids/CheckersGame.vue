<script setup>
// v1.94 跳棋（中国跳棋·六角星盘 121 格）：支持 人机对战 / 2·3·4 人同屏热座（v1.94 用户需求）。
// 规则：相邻走一步 / 隔子连跳（可连锁，不限己方他方子）；进对角营地的子锁定；己方十子全进对角营获胜。
// 角营 = 顶角营绕盘心旋转 k×60° 得到的六个角；AI=贪心（朝目标营推进 + 优先跳 + 照顾最落后子）。
// 纯本地零 API；冒烟钩子 window.__cando.kidGame = G, kidApi = { movesFor, applyMove, ADJ, cellByKey }。
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import { sfx } from '../ui/sfx.js';

const emit = defineEmits(['finish']);

// ── 星盘几何：17 行宽度；等边三角格（横距 1，斜距也为 1） ──
const ROWS = [1, 2, 3, 4, 13, 12, 11, 10, 9, 10, 11, 12, 13, 4, 3, 2, 1];
const DY = Math.sqrt(3) / 2;
const SQ3 = Math.sqrt(3);
const CELLS = [];
const cellByKey = new Map();
const cellByPos = new Map();   // "x,y"(×100 取整) → cell
for (let r = 0; r < 17; r++) {
  for (let c = 0; c < ROWS[r]; c++) {
    const x = c - (ROWS[r] - 1) / 2;
    const y = (r - 8) * DY;
    const key = r + ':' + c;
    const cell = { key, r, c, x, y };
    CELLS.push(cell);
    cellByKey.set(key, cell);
    cellByPos.set(Math.round(x * 100) + ',' + Math.round(y * 100), cell);
  }
}
// 邻接表：距离恰为 1 的六向
const ADJ = new Map();
for (const a of CELLS) {
  const list = [];
  for (const b of CELLS) {
    if (a === b) continue;
    const dx = a.x - b.x, dy = a.y - b.y;
    if (Math.abs(dx * dx + dy * dy - 1) < 1e-6) list.push(b.key);
  }
  ADJ.set(a.key, list);
}
// 修 v1.94：必须返回 key 字符串（此前返回 cell 对象，连跳落点混入 frontier 导致 ADJ.get(对象) 崩）
const keyOf = (x, y) => {
  const c = cellByPos.get(Math.round(x * 100) + ',' + Math.round(y * 100));
  return c ? c.key : null;
};

// ── 六个角营：顶角（0–3 行 10 格）绕盘心旋转 k×60° ──
function rotKey(cell, k) {
  let x = cell.x, y = cell.y;
  for (let i = 0; i < k; i++) {
    const nx = (x - SQ3 * y) / 2, ny = (SQ3 * x + y) / 2;
    x = nx; y = ny;
  }
  return keyOf(x, y);
}
const topCells = CELLS.filter(c => c.r <= 3);
const CORNERS = Array.from({ length: 6 }, (_, k) => topCells.map(c => rotKey(c, k)));
const CORNER_TIP = CORNERS.map(keys => cellByKey.get(keys[0]));   // keys[0] = 顶点格

// 角营配色（C3=下方红营=2 人局的主玩家位）
const CORNER_COLORS = [
  { c: '#4A90C4', deep: '#3E79A5', soft: '#E4EEF6' },  // C0 上
  { c: '#B58BFF', deep: '#7C5CD6', soft: '#F0E9FD' },  // C1 右上
  { c: '#E8A24B', deep: '#A96D1E', soft: '#F9EBD8' },  // C2 右下
  { c: '#E0784A', deep: '#B65F3B', soft: '#F8E7DF' },  // C3 下（红）
  { c: '#3E9B6E', deep: '#397D59', soft: '#E5F1E8' },  // C4 左下
  { c: '#FFB3C6', deep: '#D96A8B', soft: '#FDEDF1' },  // C5 左上
];

// ── 模式：ai=人机对战；p2/p3/p4=同屏热座 ──
const MODES = [
  { id: 'ai', label: '人机对战', hint: '你 vs 电脑', seats: [{ corner: 3, ai: false }, { corner: 0, ai: true }] },
  { id: 'p2', label: '2 人同屏', hint: '上下对角', seats: [{ corner: 3 }, { corner: 0 }] },
  { id: 'p3', label: '3 人同屏', hint: '三足鼎立', seats: [{ corner: 3 }, { corner: 0 }, { corner: 2 }] },
  { id: 'p4', label: '4 人同屏', hint: '四角开战', seats: [{ corner: 3 }, { corner: 0 }, { corner: 1 }, { corner: 4 }] },
];

const G = reactive({
  phase: 'idle',          // idle | playing | over
  mode: '',
  board: new Map(),       // key → 席位下标 | 无
  seats: [],              // { corner, target, color, deep, soft, name, ai, pegs:[] }
  turn: 0, busy: false,
  selected: '', moves: [],
  msg: '',
});
let aiTimer = null, alive = true;

function start(modeId) {
  const mode = MODES.find(m => m.id === modeId);
  if (!mode) return;
  G.seats = mode.seats.map((s, i) => {
    const col = CORNER_COLORS[s.corner];
    return {
      corner: s.corner,
      target: (s.corner + 3) % 6,
      ...col,
      name: s.ai ? '电脑' : (mode.seats.length > 2 || mode.id === 'ai' ? (s.ai ? '电脑' : '玩家' + (i + 1)) : '玩家' + (i + 1)),
      ai: !!s.ai,
      pegs: CORNERS[s.corner].slice(),
    };
  });
  if (mode.id === 'ai') { G.seats[0].name = '你'; G.seats[1].name = '电脑'; }
  G.board = new Map();
  for (const s of G.seats) for (const k of s.pegs) G.board.set(k, G.seats.indexOf(s));
  G.mode = modeId;
  G.turn = 0; G.busy = false; G.selected = ''; G.moves = [];
  G.phase = 'playing';
  G.msg = G.seats[0].ai ? '' : '点你的棋子，再点要去的地方';
  sfx.tap();
  window.__cando = window.__cando || {};
  window.__cando.kidGame = G;
  window.__cando.kidApi = { movesFor, applyMove, ADJ, cellByKey }; // 冒烟/回归钩子
  if (G.seats[0].ai) aiTimer = setTimeout(() => alive && aiMove(), 700);
}

const cornerSet = i => new Set(CORNERS[i]);

/** 一颗子的全部可落点：相邻空位 + 连跳链可达空位（跳过任意棋子）。locked=已在对角营地 */
function movesFor(key, seatIdx) {
  const seat = G.seats[seatIdx];
  if (!seat || cornerSet(seat.target).has(key)) return [];
  const out = [];
  for (const n of ADJ.get(key)) if (G.board.get(n) == null) out.push(n);   // 席位下标 0 也是占位
  const seen = new Set([key]);
  let frontier = [key];
  while (frontier.length) {
    const next = [];
    for (const cur of frontier) {
      const cc = cellByKey.get(cur);
      for (const mid of ADJ.get(cur)) {
        if (G.board.get(mid) == null) continue;
        const mc = cellByKey.get(mid);
        const land = keyOf(2 * mc.x - cc.x, 2 * mc.y - cc.y);
        if (!land || seen.has(land) || G.board.get(land) != null) continue;
        seen.add(land);
        out.push(land);
        next.push(land);
      }
    }
    frontier = next;
  }
  return out;
}

function tapCell(key) {
  if (G.phase !== 'playing' || G.busy) return;
  const seat = G.seats[G.turn];
  if (seat.ai) return;
  const occ = G.board.get(key);
  if (occ === G.turn) {
    if (G.selected === key) { G.selected = ''; G.moves = []; return; }
    G.selected = key;
    G.moves = movesFor(key, G.turn);
    sfx.tap();
    G.msg = G.moves.length ? '亮圈的地方都能去' : '这颗子现在走不了，换一颗';
    return;
  }
  if (G.selected && G.moves.includes(key)) applyMove(G.selected, key, G.turn);
}

function applyMove(from, to, seatIdx) {
  const seat = G.seats[seatIdx];
  G.board.set(from, null);
  G.board.set(to, seatIdx);
  seat.pegs[seat.pegs.indexOf(from)] = to;
  const f = cellByKey.get(from), t = cellByKey.get(to);
  const isJump = Math.abs(f.y - t.y) > DY * 1.5 || Math.abs(f.x - t.x) > 1.5;
  sfx.tap();
  if (seat.pegs.every(k => cornerSet(seat.target).has(k))) return endGame(seatIdx);
  G.selected = ''; G.moves = [];
  advanceTurn(seatIdx);
}

const hasAnyMove = seatIdx => G.seats[seatIdx].pegs.some(k => movesFor(k, seatIdx).length);

/** 轮转到下一席；无棋可走的席位自动跳过（全员卡死则提示） */
function advanceTurn(fromIdx) {
  const n = G.seats.length;
  let next = fromIdx;
  for (let i = 0; i < n; i++) {
    next = (next + 1) % n;
    if (hasAnyMove(next)) break;
    G.msg = `${G.seats[next].name}走不了，跳过`;
    if (i === n - 1) { G.msg = '大家都走不了，和局'; G.phase = 'over'; emit('finish', { title: '和局', win: false, stars: 2, sub: '局面卡住啦，再来一局！' }); return; }
  }
  G.turn = next;
  G.busy = G.seats[next].ai;
  G.msg = G.seats[next].ai ? `${G.seats[next].name}想一下…` : `轮到 ${G.seats[next].name}`;
  if (G.seats[next].ai) aiTimer = setTimeout(() => { if (alive) aiMove(); }, 700);
}

function distToTip(key, cornerIdx) {
  const c = cellByKey.get(key), tip = CORNER_TIP[cornerIdx];
  return Math.hypot(c.x - tip.x, c.y - tip.y);
}

function aiMove() {
  const seatIdx = G.turn;
  const seat = G.seats[seatIdx];
  if (!seat || !seat.ai || G.phase !== 'playing') return;
  let best = null, bestScore = -Infinity;
  const rear = seat.pegs.reduce((a, b) => distToTip(a, seat.target) > distToTip(b, seat.target) ? a : b);
  for (const from of seat.pegs) {
    for (const to of movesFor(from, seatIdx)) {
      let score = (distToTip(from, seat.target) - distToTip(to, seat.target)) * 2 + Math.random() * 0.3;
      const f = cellByKey.get(from), t = cellByKey.get(to);
      if (Math.abs(t.y - f.y) > DY * 1.5 || Math.abs(t.x - f.x) > 1.5) score += 0.5;   // 优先跳
      if (from === rear) score += 0.4;                                                  // 别落下最落后的子
      if (score > bestScore) { bestScore = score; best = [from, to]; }
    }
  }
  if (!best) {
    advanceTurn(seatIdx);
    return;
  }
  applyMove(best[0], best[1], seatIdx);
}

function endGame(winnerIdx) {
  G.phase = 'over';
  clearTimeout(aiTimer);
  const seat = G.seats[winnerIdx];
  const anyHumanWon = !seat.ai;
  emit('finish', {
    title: `${seat.name}赢啦！`,
    win: anyHumanWon,
    stars: anyHumanWon ? 3 : 1,
    sub: anyHumanWon ? '十颗棋子全跳进对面营地，真棒！' : '电脑先到齐了，下次抢先手',
  });
}

const pegsView = computed(() => {
  const out = [];
  G.seats.forEach((seat, si) => {
    for (const k of seat.pegs) out.push({ key: k, si, ...cellByKey.get(k), seat });
  });
  return out;
});
const cornerTint = computed(() => {
  const m = new Map();
  for (let k = 0; k < 6; k++) for (const key of CORNERS[k]) m.set(key, CORNER_COLORS[k].soft);
  return m;
});

onBeforeUnmount(() => {
  alive = false;
  clearTimeout(aiTimer);
});
</script>

<template>
  <div class="ckb">
    <!-- 开始页：选模式 -->
    <div class="c-intro" v-if="G.phase === 'idle'">
      <p class="c-tip">谁先把自己的棋子<b>全部跳进对角营地</b>谁就赢，<br/>可以隔着任意棋子连跳！</p>
      <div class="c-modes">
        <button v-for="m in MODES" :key="m.id" class="c-mode" @click="start(m.id)">
          <b>{{ m.label }}</b><span>{{ m.hint }}</span>
        </button>
      </div>
    </div>

    <template v-if="G.phase !== 'idle'">
      <!-- 席位条 -->
      <div class="c-seats">
        <span v-for="(s, i) in G.seats" :key="i" class="c-seat" :class="{ act: G.turn === i }"
          :style="{ background: s.soft, color: s.deep, borderColor: G.turn === i ? s.c : 'transparent' }">
          {{ s.name }} · {{ s.pegs.length }}子
        </span>
      </div>
      <div class="c-msg">{{ G.msg }}</div>
      <svg class="c-board" viewBox="-7.2 -8 14.4 16">
        <g v-for="c in CELLS" :key="c.key" :transform="`translate(${c.x}, ${c.y})`" @pointerdown.prevent="tapCell(c.key)">
          <circle r="0.44" :fill="cornerTint.get(c.key) || 'var(--hn-sand, #E9E0D3)'" class="c-hole"/>
          <circle v-if="G.moves.includes(c.key)" r="0.3" fill="none" stroke="var(--hn-green, #3E9B6E)" stroke-width="0.09" class="c-target"/>
        </g>
        <g v-for="p in pegsView" :key="p.key" class="pegg" :transform="`translate(${p.x}, ${p.y})`">
          <circle r="0.36" :fill="p.seat.c" :stroke="p.seat.deep" stroke-width="0.08" :class="{ sel: G.selected === p.key }"/>
          <circle r="0.13" cy="-0.1" fill="rgba(255,255,255,0.55)"/>
        </g>
      </svg>
      <div class="c-legend">
        <span v-for="(s, i) in G.seats" :key="i" class="c-dot" :style="{ '--dot': s.c }">{{ s.name }} → 对面同位营</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ckb { width: 100%; max-width: 430px; display: flex; flex-direction: column; align-items: center; }
.c-intro { text-align: center; padding-top: 4px; }
.c-tip { font-size: 14px; line-height: 1.9; color: var(--hn-muted, #777168); margin: 0 0 12px; }
.c-tip b { color: var(--hn-coral, #E0784A); }
.c-modes { display: flex; flex-direction: column; gap: 10px; width: 240px; }
.c-mode {
  border: 0; cursor: pointer; text-align: left;
  background: var(--hn-paper, #FFFCF7); color: var(--hn-ink, #2F2C27);
  border-radius: 16px; padding: 13px 18px;
  box-shadow: var(--hn-shadow-card, 0 8px 22px rgba(86, 66, 43, 0.045));
  display: flex; align-items: baseline; justify-content: space-between;
  transition: transform 0.12s ease;
}
.c-mode:active { transform: scale(0.97); }
.c-mode b { font-size: 16px; font-weight: 800; }
.c-mode span { font-size: 12px; color: var(--hn-faint, #A69D91); }

.c-seats { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; margin-bottom: 4px; }
.c-seat {
  border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 800;
  border: 2px solid transparent; opacity: 0.75;
}
.c-seat.act { opacity: 1; }
.c-msg { font-size: 13px; font-weight: 700; color: var(--hn-muted, #777168); margin-bottom: 4px; min-height: 1.1em; }
.c-board { width: 100%; max-height: min(74vh, calc(var(--vh, 100vh) - 140px)); flex: 1; min-height: 0; touch-action: manipulation; }
.c-hole { stroke: rgba(86, 66, 43, 0.14); stroke-width: 0.03; cursor: pointer; }
.pegg { pointer-events: none; }
.pegg circle { transition: transform 0.25s ease; }
.pegg circle.sel { stroke-width: 0.14; }
.c-target { animation: c-pulse 1s ease-in-out infinite; cursor: pointer; }
@keyframes c-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
.c-legend { display: flex; gap: 12px; margin-top: 4px; font-size: 11px; color: var(--hn-muted, #777168); flex-wrap: wrap; justify-content: center; }
.c-dot { display: inline-flex; align-items: center; gap: 5px; }
.c-dot::before { content: ''; width: 10px; height: 10px; border-radius: 50%; background: var(--dot, #999); }
</style>

<script setup>
// v1.94 小猫钓鱼（多席位）：经典儿童牌局——翻牌点数与桌面相同=从那张到桌尾全收走，先打空手牌的一方出局。
// 支持 人机对战 / 2·3·4 人同屏热座（v1.94 用户需求）；纯本地零 API。
// 冒烟钩子 window.__cando.kidGame = G。
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import { sfx } from '../ui/sfx.js';

const emit = defineEmits(['finish']);

const RANK_TEXT = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
const SUITS = [
  { s: '♠', red: false }, { s: '♥', red: true }, { s: '♣', red: false }, { s: '♦', red: true },
];
const rankText = r => RANK_TEXT[r] || String(r);

// 席位配色（同屏各玩家一眼可辨）
const SEAT_COLORS = [
  { c: '#E0784A', deep: '#B65F3B', soft: '#F8E7DF' },
  { c: '#4A90C4', deep: '#3E79A5', soft: '#E4EEF6' },
  { c: '#3E9B6E', deep: '#397D59', soft: '#E5F1E8' },
  { c: '#E8A24B', deep: '#A96D1E', soft: '#F9EBD8' },
];
const MODES = [
  { id: 'ai', label: '人机对战', hint: '你 vs 电脑', count: 2, aiSeats: [1] },
  { id: 'p2', label: '2 人同屏', hint: '轮流翻牌', count: 2, aiSeats: [] },
  { id: 'p3', label: '3 人同屏', hint: '轮流翻牌', count: 3, aiSeats: [] },
  { id: 'p4', label: '4 人同屏', hint: '轮流翻牌', count: 4, aiSeats: [] },
];

let uid = 1;
function newDeck() {
  const deck = [];
  for (const su of SUITS) for (let r = 1; r <= 13; r++) deck.push({ id: uid++, rank: r, suit: su.s, red: su.red });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const G = reactive({
  phase: 'idle',        // idle | playing | over
  mode: '',
  players: [],          // { name, ai, out, c, deep, soft, hand: [] }
  turn: 0, busy: false,
  table: [],            // { id, rank, suit, red, seat, matched? }
  flips: 0,
  msg: '',
});
let aiTimer = null, collectTimer = null, alive = true;

function start(modeId) {
  const mode = MODES.find(m => m.id === modeId);
  if (!mode) return;
  G.mode = modeId;
  G.players = Array.from({ length: mode.count }, (_, i) => ({
    name: mode.aiSeats.includes(i) ? '电脑' : (mode.id === 'ai' && i === 0 ? '你' : '玩家' + (i + 1)),
    ai: mode.aiSeats.includes(i),
    out: false,
    ...SEAT_COLORS[i % SEAT_COLORS.length],
    hand: [],
  }));
  const deck = newDeck();
  deck.forEach((card, i) => G.players[i % mode.count].hand.push(card));
  G.table = []; G.flips = 0; G.turn = 0; G.busy = false;
  G.phase = 'playing';
  G.msg = '轮到 ' + G.players[0].name + '，点牌堆出牌';
  sfx.tap();
  window.__cando = window.__cando || {};
  window.__cando.kidGame = G;
  scheduleAi();
}

function scheduleAi() {
  clearTimeout(aiTimer);
  aiTimer = setTimeout(() => {
    if (alive && G.phase === 'playing' && !G.busy && G.players[G.turn] && G.players[G.turn].ai) play(G.turn);
  }, 950);
}

function tapPile() {
  if (G.phase !== 'playing' || G.busy) return;
  const p = G.players[G.turn];
  if (!p || p.ai) return;
  play(G.turn);
}

function play(seatIdx) {
  const p = G.players[seatIdx];
  const card = p.hand.shift();
  if (!card) return markOut(seatIdx);
  G.flips += 1;
  card.seat = seatIdx;
  G.table.push(card);
  sfx.deal();
  G.msg = p.name + ' 翻出 ' + rankText(card.rank);

  const idx = G.table.findIndex((c, j) => j < G.table.length - 1 && c.rank === card.rank);
  if (idx >= 0) {
    G.busy = true;
    for (let k = idx; k < G.table.length; k++) G.table[k].matched = true;
    sfx.payout();
    G.msg = p.name + ' 收到 ' + (G.table.length - idx) + ' 张！';
    collectTimer = setTimeout(() => {
      if (!alive) return;
      const got = G.table.splice(idx);
      p.hand.push(...got);
      got.forEach(c => { c.matched = false; });
      G.busy = false;
      nextTurn(seatIdx);
    }, 750);
  } else {
    nextTurn(seatIdx);
  }
}

function nextTurn(fromIdx) {
  if (G.flips > 600) return endGame(null);           // 极罕见长局保护：平局
  const n = G.players.length;
  let next = fromIdx;
  for (let i = 0; i < n; i++) {
    next = (next + 1) % n;
    const p = G.players[next];
    if (p.out) continue;
    if (p.hand.length === 0) { p.out = true; G.msg = p.name + ' 没牌啦，出局'; continue; }
    G.turn = next;
    G.busy = false;
    G.msg = p.ai ? p.name + ' 想一下…' : '轮到 ' + p.name + '，点牌堆出牌';
    if (p.ai) scheduleAi();
    return;
  }
  // 全部出局（理论不达）→ 平局兜底
  endGame(null);
}

function markOut(seatIdx) {
  G.players[seatIdx].out = true;
  nextTurn(seatIdx);
}

function endGame(winnerIdx) {
  G.phase = 'over';
  clearTimeout(aiTimer);
  clearTimeout(collectTimer);
  if (winnerIdx == null) {
    emit('finish', { title: '平局啦', win: false, stars: 2, sub: '牌都翻完了也没分出胜负，再来一局！' });
    return;
  }
  const w = G.players[winnerIdx];
  const win = !w.ai;
  const alive_ = G.players.filter(p => !p.out).length;
  emit('finish', {
    title: w.name + '赢啦！',
    win,
    stars: win ? 3 : 1,
    sub: win ? (alive_ > 1 || G.mode === 'ai' ? '把对手的牌全钓走了，太厉害！' : '笑到最后的赢家！') : '差一点点，牌被 ' + w.name + ' 钓走了',
  });
}

const lastCard = computed(() => G.table[G.table.length - 1] || null);
const otherPlayers = computed(() => G.players.map((p, i) => ({ ...p, idx: i })).filter(p => p.idx !== G.turn));

onBeforeUnmount(() => {
  alive = false;
  clearTimeout(aiTimer);
  clearTimeout(collectTimer);
});
</script>

<template>
  <div class="fish">
    <!-- 其他席位（含电脑） -->
    <div class="f-pills" v-if="G.phase === 'playing' || G.phase === 'over'">
      <span v-for="p in otherPlayers" :key="p.idx" class="f-pill" :class="{ act: G.turn === p.idx, out: p.out }"
        :style="{ background: p.soft, color: p.deep, borderColor: G.turn === p.idx ? p.c : 'transparent' }">
        {{ p.name }} · {{ p.hand.length }}张{{ p.out ? '（出局）' : '' }}
      </span>
    </div>

    <!-- 桌面 -->
    <div class="f-table-zone" v-if="G.phase !== 'idle'">
      <div class="f-table" v-if="G.table.length">
        <div v-for="c in G.table" :key="c.id" class="f-card f-card--sm" :class="{ red: c.red, matched: c.matched }">
          <span class="f-rank">{{ rankText(c.rank) }}</span>
          <span class="f-suit">{{ c.suit }}</span>
        </div>
      </div>
      <div class="f-empty" v-else>桌上还没有牌</div>
    </div>

    <!-- 消息条 -->
    <div class="f-msg" v-if="G.phase !== 'idle'">{{ G.msg }}</div>

    <!-- 当前席位大牌堆 -->
    <button class="f-pile" v-if="G.phase === 'playing'"
      :class="{ can: !G.busy && !G.players[G.turn].ai }"
      :style="{ borderColor: G.players[G.turn].c }"
      @click="tapPile" :disabled="G.busy || G.players[G.turn].ai">
      <div class="f-back" :style="{ background: 'linear-gradient(135deg,' + G.players[G.turn].c + ',' + G.players[G.turn].deep + ')' }" v-if="G.players[G.turn].hand.length">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12c2.5-4 6.5-6 10-6 3 0 5.5 1.5 7 3.5.6.8.6 1.7 0 2.5-1.5 2-4 3.5-7 3.5-3.5 0-7.5-2-10-3.5Z"/></svg>
        <span>{{ G.players[G.turn].name }} · 点我出牌</span>
      </div>
    </button>

    <!-- 刚翻出的大牌提示 -->
    <div class="f-last" v-if="lastCard && G.phase === 'playing'">
      <div class="f-card" :class="{ red: lastCard.red }">
        <span class="f-rank">{{ rankText(lastCard.rank) }}</span>
        <span class="f-suit">{{ lastCard.suit }}</span>
      </div>
    </div>

    <!-- 开始页：选模式 -->
    <div class="f-intro" v-if="G.phase === 'idle'">
      <p class="f-tip">轮流翻牌放到桌上，翻出和桌上<b>一样点数</b>的牌，<br/>中间的牌全归你！先没牌的出局。</p>
      <div class="f-modes">
        <button v-for="m in MODES" :key="m.id" class="f-mode" @click="start(m.id)">
          <b>{{ m.label }}</b><span>{{ m.hint }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fish { width: 100%; max-width: 430px; height: 100%; display: flex; flex-direction: column; gap: 8px; align-items: center; }
.f-pills { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
.f-pill {
  border-radius: 999px; padding: 4px 11px; font-size: 12px; font-weight: 800;
  border: 2px solid transparent; opacity: 0.75;
}
.f-pill.act { opacity: 1; }
.f-pill.out { opacity: 0.4; text-decoration: line-through; }

.f-table-zone {
  background: var(--hn-paper, #FFFCF7); border-radius: 18px; padding: 12px;
  min-height: 0; width: 100%; flex: 1; box-sizing: border-box;
  box-shadow: var(--hn-shadow-card, 0 8px 22px rgba(86, 66, 43, 0.045));
  display: flex; align-items: flex-end; justify-content: center;
}
.f-table { display: flex; flex-wrap: wrap-reverse; gap: 6px; justify-content: center; align-content: flex-end; max-height: 100%; overflow-y: auto; }
.f-empty { font-size: 12px; color: var(--hn-faint, #A69D91); }

.f-card {
  width: 52px; height: 72px; border-radius: 9px;
  background: #fff; border: 2px solid var(--hn-line, #E7DCCB);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
  color: #2F2C27; flex-shrink: 0;
  box-shadow: 0 2px 0 rgba(86, 66, 43, 0.12);
}
.f-card.red { color: #D64545; }
.f-card--sm { width: 40px; height: 56px; }
.f-card--sm.matched { outline: 3px solid var(--hn-orange, #E8A24B); outline-offset: -1px; transform: scale(1.06); }
.f-rank { font-size: 19px; font-weight: 800; line-height: 1; }
.f-card--sm .f-rank { font-size: 15px; }
.f-suit { font-size: 14px; line-height: 1; }
.f-card--sm .f-suit { font-size: 12px; }

.f-msg { text-align: center; font-size: 13px; font-weight: 700; padding: 0; color: var(--hn-muted, #777168); min-height: 1.1em; }
/* v1.99 手机横屏：牌桌摊宽、牌面收小，牌堆紧凑不顶出屏 */
@media (orientation: landscape) and (max-height: 500px) {
  .fish { max-width: 560px; gap: 6px; }
  .f-card { width: 42px; height: 59px; border-radius: 7px; }
  .f-card--sm { width: 32px; height: 45px; }
  .f-rank { font-size: 15px; }
  .f-suit { font-size: 11px; }
  .f-pile { width: 150px; height: 56px; }
  .f-msg { font-size: 11.5px; min-height: 1em; }
}
.f-pile {
  width: 210px; height: 76px; border: 3px solid; padding: 0; cursor: pointer; flex-shrink: 0;
  border-radius: 14px; background: transparent;
}
.f-back {
  width: 100%; height: 100%; border-radius: 11px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  color: #fff; font-size: 13px; font-weight: 800;
  border: 2px solid rgba(255, 255, 255, 0.35);
  box-sizing: border-box;
}
.f-back svg { width: 20px; height: 20px; opacity: 0.9; }
.f-pile:disabled { opacity: 0.8; cursor: default; }
.f-pile.can { animation: f-pulse 1s ease-in-out infinite; }
@keyframes f-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }

.f-last { position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%); pointer-events: none; opacity: 0.94; }
.fish { position: relative; }

.f-intro { text-align: center; padding-top: 4px; }
.f-tip { font-size: 14px; line-height: 1.9; color: var(--hn-muted, #777168); margin: 0 0 12px; }
.f-tip b { color: var(--hn-coral, #E0784A); }
.f-modes { display: flex; flex-direction: column; gap: 10px; width: 240px; }
.f-mode {
  border: 0; cursor: pointer; text-align: left;
  background: var(--hn-paper, #FFFCF7); color: var(--hn-ink, #2F2C27);
  border-radius: 16px; padding: 13px 18px;
  box-shadow: var(--hn-shadow-card, 0 8px 22px rgba(86, 66, 43, 0.045));
  display: flex; align-items: baseline; justify-content: space-between;
  transition: transform 0.12s ease;
}
.f-mode:active { transform: scale(0.97); }
.f-mode b { font-size: 16px; font-weight: 800; }
.f-mode span { font-size: 12px; color: var(--hn-faint, #A69D91); }
</style>

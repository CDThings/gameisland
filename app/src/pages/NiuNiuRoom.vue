<script setup>
// 牛牛（斗牛·互赔制）牌桌 v2：逻辑在 @space/shared/cards/niuniu（排牌自选+两两互赔+翻倍+8轮整场）
// 布局：真实牌桌方位——对家上、左家左、右家右、自家下（横屏紧凑一屏）
import { reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import {
  createSession, startRound, settleRound, setDouble,
  arrange, autoArrange, niuOf, rankOf, multOf, aiNiuPlan, niuDblHint, turnHint, scoreboard, roundLog, autoPlayMatch, serialize, restore,
  dealerDoubleIntent
} from '@space/shared/cards/niuniu';
import { mulberry32 } from '@space/shared';
import { sfx } from '../ui/sfx.js';
import { localGet, localSet, localRemove } from '../env.js';
import { formatChipDisplay } from '@space/shared/cards/meta';

const NAMES = { 0: '你', 1: '左家·AI', 2: '对家·AI', 3: '右家·AI' };
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RK = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
const rk = v => RK[v] || String(v);
const S = reactive({ phase: 'menu', sess: null, sel: [], x2: false, level: 1, auto: false });
let autoTimer = 0;
// v1.53 统一五档（与掼蛋/麻将/德州同命名；1=进阶=历史默认零回归）
const LV_CN = { 0: '普通', 1: '进阶', 2: '高阶', 3: '地域', 4: '绝望' };

// v1.41 单机存档（对齐掼蛋 localStorage「继续上局」）：推进/结算点落 localStorage，损坏→降级新开
const SAVE_KEY = 'niuniu.save.v1';
function save() { if (S.sess) try { localSet(SAVE_KEY, serialize(S.sess)); } catch { /* 存储满/隐私模式忽略 */ } }
// 仅菜单态计算，切到 menu 时重读（依赖 S.phase）
const saved = computed(() => {
  if (S.phase !== 'menu') return null;
  try { const j = localGet(SAVE_KEY); return j ? restore(j) : null; } catch { return null; }
});
function continueMatch() {
  try {
    S.sess = restore(localGet(SAVE_KEY));
    S.sel = []; S.x2 = false; S.phase = 'play'; S.auto = false;
    if (!S.sess.round || S.sess.round.settled) startRound(S.sess); // 停在已结算 → 直接开下一轮
    else S.x2 = !!S.sess.round.doubled; // v1.50：续打未结算轮时同步翻倍按钮态（round.doubled 为事实源）
    applyAiPlans(); // 按难度确定性重排 AI 座
    save();
  } catch { newSession(); } // 存档损坏/跨版本 → 降级新开，不把用户卡死
}
watch(() => S.sess?.over, (v) => { if (v) { try { localRemove(SAVE_KEY); } catch { /* noop */ } } });

/** 按难度给 AI 座(1-3)重新排法（确定性：seed^round^seat 派生 rng）。 */
function applyAiPlans() {
  const se = S.sess, r = se.round; if (!r) return;
  for (let seat = 1; seat < 4; seat++) {
    const rng = mulberry32(((se.seed ^ Math.imul(se.roundNo, 0x9E3779B1)) ^ seat) >>> 0);
    r.arr[seat] = aiNiuPlan(r.hands[seat], S.level, rng).chosen;
  }
  // v1.53 地域/绝望档：AI 庄家按自己手牌强度宣布翻倍（rng 通道 4 与 shared autoPlayMatch 同流，
  // 牌桌内自动与"自动打完整场"结果一致；同轮内幂等，!r.doubled 保证每轮只决定一次）
  if (S.level >= 3 && se.dealer !== 0 && !r.doubled) {
    const decl = mulberry32(((se.seed ^ Math.imul(se.roundNo, 0x9E3779B1)) ^ 4) >>> 0);
    if (dealerDoubleIntent(se, S.level, decl)) { setDouble(se, true); S.x2 = true; }
  }
}

// v1.53：AI 庄家已宣布翻倍 → 玩家 ×2 按钮交给庄家态（不可撤）；其余情况玩家自控
const dealerDeclared = computed(() => {
  const se = S.sess;
  return S.level >= 3 && !!se && se.dealer !== 0 && !!se.round && !!se.round.doubled;
});

function newSession() {
  S.sess = createSession((Date.now() ^ (Math.random() * 0xffffff)) & 0x7fffffff, 10, 8);
  S.sel = [];
  S.phase = 'play';
  startRound(S.sess);
  applyAiPlans();
  sfx.deal();
  save();
}
function clickCard(c) {
  const r = S.sess.round;
  if (r.settled) return;
  const ix = S.sel.indexOf(c.id);
  if (ix >= 0) S.sel.splice(ix, 1);
  else { S.sel.push(c.id); if (S.sel.length > 3) S.sel.shift(); }
  if (S.sel.length === 3) arrange(r, 0, S.sel); // 选满 3 张即时排牛
}
function optimal() {
  const r = autoArrange(S.sess.round, 0);
  if (r.ok) S.sel = r.niu.use.map(i => S.sess.round.hands[0][i].id); // v1.50：选牌态与排法同步（曾清 sel → 牌面 no tag 却提示有牛）
}
function reveal() {
  if (!S.sel.length) autoArrange(S.sess.round, 0);
  setDouble(S.sess, S.x2);
  settleRound(S.sess);
  S.sel = [];
  sfx.flip();
  save();
}
function next() { S.x2 = false; S.sel = []; startRound(S.sess); applyAiPlans(); sfx.deal(); save(); }

// v1.29 自动打完整场：人座也自动排最优 + 自动结算 + 自动下一轮（同时亮牌制，无逐座回合）
function toggleAuto() { S.auto = !S.auto; if (S.auto) autoStep(); else clearTimeout(autoTimer); }
function autoStep() {
  clearTimeout(autoTimer);
  if (!S.sess || S.phase !== 'play') { S.auto = false; return; }
  if (S.sess.over) { S.auto = false; S.phase = 'result'; return; }
  const r = S.sess.round;
  if (r.settled) { if (!S.sess.over) next(); }          // 已结算且整场未完 → 下一轮
  else { S.sel = []; optimal(); reveal(); }              // 未结算 → 人座自动排最优 + 结算
  autoTimer = setTimeout(autoStep, 450);
}

const round = computed(() => S.sess?.round ?? null);
const myNiu = computed(() => (round.value ? niuOf(round.value, 0) : null));
// v1.24 翻倍意向（基于玩家当前排法 myNiu，非最优摆法）
const dbl = computed(() => (myNiu.value ? niuDblHint(myNiu.value) : null));
// v1.26 当前轮提示（掼蛋 turn-hint 移植）：共享纯函数 turnHint（牛牛同时亮牌制，结算前恒 your-turn）
const nh = computed(() => turnHint(S.sess?.round));
const rankings = computed(() => {
  const se = S.sess; if (!se) return [];
  return [0, 1, 2, 3].sort((a, b) => se.scores[b] - se.scores[a]);
});
// v1.33 记分牌（掼蛋"打级方/级牌进度"等价）：领先者/分差/进度（shared scoreboard 纯函数）
const board = computed(() => scoreboard(S.sess));
// v1.34 整场结算日志（对齐德州下注日志 / 掼蛋 playlog）：最近 4 轮"庄X · 赢家 · 翻倍"
const log = computed(() => roundLog(S.sess));
// v1.15 即时反馈：结算出音效，整场结束（冠军）出 fanfare
watch(() => round.value?.settled, (v) => { if (v) sfx.payout(); });
watch(() => S.sess?.over, (v) => { if (v) sfx.fanfare(); });
// v1.39 回归钩子（对齐 __guandan / __holdem / __mahjong）：同步驱动整场，供浏览器回归一键打满
window.__niuniu = {
  get sess() { return S.sess; },
  newSession,
  finishSession(level = S.level) {
    const se = S.sess || (S.sess = createSession((Date.now() ^ (Math.random() * 0xffffff)) & 0x7fffffff, 10, 8));
    autoPlayMatch(se, level); // shared 确定性整场驱动（同 seed 可重放）
    S.sess = se;
    S.phase = se.over ? 'result' : 'play';
    return { ok: true, over: !!se.over, hands: se.hands, champ: se.champ, scores: se.scores.slice() };
  },
};
onMounted(() => {});
// v1.50：自动播放定时器泄漏——切页/卸载时清掉，避免挂在脱离的响应式状态上继续 450ms 空转
onBeforeUnmount(() => { clearTimeout(autoTimer); });
</script>

<template>
  <div class="gtable nn">
    <div class="table-wrap">
      <div class="topbar">
        <span class="title">牛牛 · 互赔制</span>
        <template v-if="S.phase === 'play' && S.sess">
          <span class="chip">第 <b>{{ S.sess.roundNo }}/8</b> 轮</span>
          <span class="chip">庄家 <b>{{ NAMES[S.sess.dealer] }}</b></span>
          <span class="chip">底注 <b>{{ round?.baseBet ?? S.sess.baseBet }}</b><template v-if="round?.doubled">（×2）</template></span>
          <span class="chip lvl">AI <b>{{ LV_CN[S.level] }}</b></span>
          <span v-if="S.sess.chips && S.sess.chips.length" class="chip term">词条 {{ formatChipDisplay(S.sess.chips) }}</span>
        </template>
        <span style="flex:1"></span>
        <span class="chip offline">单机 · 不计积分</span>
        <button class="btn ghost tiny" v-if="S.phase === 'play' && !S.sess?.over" :class="{ on: S.auto }" @click="toggleAuto()">{{ S.auto ? '停止自动' : '自动打完' }}</button>
        <button class="btn ghost tiny" @click="$router.replace('/island')">返回大厅</button>
      </div>

      <!-- 开局规则屏 -->
      <div v-if="S.phase === 'menu'" class="nn-menu">
        <h3>牛牛 · 斗牛（互赔制）</h3>
        <div class="slogan">1 人 vs 3 AI · 8 轮 · 自选 3 张组牛 · 两两互赔 · 累计净分定冠军</div>
        <ul>
          <li>每家 5 张：J/Q/K 记 10、A 记 1；<b>自己选 3 张</b>组"牛"（和为 10 的倍数），余 2 张个位 = 牛几。</li>
          <li>牌型：五小牛 &gt; 炸弹 &gt; 五花牛 &gt; 牛牛 &gt; 牛九 &gt; 牛八… &gt; 无牛；同型比最大张（♠&gt;♥&gt;♣&gt;♦）。</li>
          <li><b>互赔结算</b>（非冠军通吃）：两两比牌，弱者付强者「底注×强者倍率」；平局互抵。</li>
          <li>亮牌前可<b>翻倍</b>（底注×2）；庄家有牛<b>连庄</b>、无牛<b>过庄</b>（v1.50 通行斗牛口径）。地域/绝望档 AI 庄家会按牌力主动<b>宣布翻倍</b>。</li>
        </ul>
        <div class="lv-row">
          <span class="dim">AI 难度</span>
          <button v-for="(lab, l) in LV_CN" :key="l" class="btn tiny" :class="{ on: S.level === +l }" @click="S.level = +l">{{ lab }}</button>
        </div>
        <button class="btn" v-if="saved && !saved.over" @click="continueMatch()">继续上局（第 {{ saved.roundNo }}/{{ saved.hands }} 轮）</button>
        <button class="btn primary" @click="newSession()">开始整场（8 轮）</button>
      </div>

      <template v-else>
        <!-- 真实牌桌方位：对家上、左家左、右家右、自家下 -->
        <div class="nn-table" v-if="round">
          <div class="nn-seat nn-top">
            <span class="nn-name">对家·AI</span>
            <span class="nn-mini">
              <span v-for="c in round.hands[2]" :key="S.sess.roundNo + '-' + c.id" class="mcard" :class="{ red: c.s === 'H' || c.s === 'D', open: round.settled }">
                <template v-if="round.settled"><b>{{ rk(c.v) }}</b>{{ SUIT[c.s] }}</template>
                <template v-else><i class="back"></i></template>
              </span>
            </span>
            <span class="nn-tag" v-if="round.settled">{{ rankOf(niuOf(round, 2)).cn }}</span>
          </div>

          <div class="nn-mid">
            <div class="nn-seat nn-side">
              <span class="nn-name">左家·AI</span>
              <span class="nn-mini">
                <span v-for="c in round.hands[1]" :key="S.sess.roundNo + '-' + c.id" class="mcard" :class="{ red: c.s === 'H' || c.s === 'D', open: round.settled }">
                  <template v-if="round.settled"><b>{{ rk(c.v) }}</b>{{ SUIT[c.s] }}</template>
                  <template v-else><i class="back"></i></template>
                </span>
              </span>
              <span class="nn-tag" v-if="round.settled">{{ rankOf(niuOf(round, 1)).cn }}</span>
            </div>

            <div class="nn-center">
              <div class="nn-turnhint" :class="{ you: nh.kind === 'your-turn' }" v-if="nh.kind === 'your-turn' || nh.kind === 'done'">{{ nh.kind === 'your-turn' ? '轮到你：组牛 →（可选翻倍）→ 亮牌' : '本局已结算 · 点「下一轮」' }}</div>
              <div class="nn-hint" v-if="!round.settled">{{ myNiu?.type === 'none' ? '所选 3 张未成牛=无牛' : `你当前：${rankOf(myNiu).cn} ×${multOf(myNiu)}` }}</div>
              <div class="nn-actions" v-if="!round.settled">
                <button class="btn ghost" @click="optimal()">一键最优排</button>
                <span class="nn-dblhint" :class="{ strong: dbl?.strong, weak: dbl?.suggest === 'skip' }" v-if="dbl">{{ dbl.text }}</span>
                <button class="btn" :disabled="dealerDeclared" @click="!dealerDeclared && (S.x2 = !S.x2)">{{ dealerDeclared ? `庄家${NAMES[S.sess.dealer]}已宣布×2` : (S.x2 ? '已翻倍 ×2' : '翻倍 ×2') }}</button>
                <button class="btn primary" @click="reveal()">亮牌结算</button>
              </div>
              <div class="nn-hint dim" v-else>互赔结算</div>
            </div>

            <div class="nn-seat nn-side">
              <span class="nn-name">右家·AI</span>
              <span class="nn-mini">
                <span v-for="c in round.hands[3]" :key="S.sess.roundNo + '-' + c.id" class="mcard" :class="{ red: c.s === 'H' || c.s === 'D', open: round.settled }">
                  <template v-if="round.settled"><b>{{ rk(c.v) }}</b>{{ SUIT[c.s] }}</template>
                  <template v-else><i class="back"></i></template>
                </span>
              </span>
              <span class="nn-tag" v-if="round.settled">{{ rankOf(niuOf(round, 3)).cn }}</span>
            </div>
          </div>

          <div class="nn-me">
            <div class="nn-name you">你 · 点 3 张组牛（{{ S.sel.length }}/3）</div>
            <div class="nn-myCards">
              <div v-for="c in round.hands[0]" :key="S.sess.roundNo + '-' + c.id"
                   class="nn-card"
                   :class="{ red: c.s === 'H' || c.s === 'D', pick: S.sel.includes(c.id), dim: S.sel.length === 3 && !S.sel.includes(c.id) }"
                   @click="clickCard(c)">
                <span class="rk">{{ rk(c.v) }}{{ SUIT[c.s] }}</span>
                <span class="pip">{{ SUIT[c.s] }}</span>
                <span v-if="S.sel.includes(c.id)" class="pick-tag">牛</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 累计净分条 -->
        <div class="nn-scores" v-if="S.sess">
          <span v-for="s in [0, 1, 2, 3]" :key="s" class="nn-sc"
                :class="{ me: s === 0, win: S.sess.over && s === S.sess.champ, lead: !S.sess.over && board && s === board.leader }">
            <template v-if="!S.sess.over && board && s === board.leader">👑 </template>{{ NAMES[s] }} <b>{{ S.sess.scores[s] >= 0 ? '+' : '' }}{{ S.sess.scores[s] }}</b>
          </span>
          <span class="nn-board" v-if="board && !S.sess.over && board.spread > 0">领先 {{ NAMES[board.leader] }} · 分差 {{ board.spread }}</span>
        </div>
        <div class="nn-prog" v-if="board">
          <span class="nn-prog-track"><i :style="{ width: (board.progress * 100) + '%' }"></i></span>
          <span class="nn-prog-label">{{ board.roundNo }}/{{ board.hands }}</span>
        </div>

        <!-- v1.34 整场结算日志（对齐德州下注日志 / 掼蛋 playlog） -->
        <div class="nn-log" v-if="log.length">
          <span class="nn-log-title">整场日志</span>
          <span v-for="e in log.slice(-4)" :key="e.roundNo" class="nn-log-chip">R{{ e.roundNo }}<i>庄{{ NAMES[e.dealer] }}</i>{{ e.doubled ? '×2' : '' }} {{ e.winners.length ? e.winners.map(s => NAMES[s]).join('/') : '平' }}</span>
        </div>

        <!-- 结算 / 下一轮 -->
        <div class="controls" v-if="round?.settled">
          <div class="settle">
            <div class="big">{{ rankOf(niuOf(round, 0)).cn }} · 你净 {{ round.settled.deltas[0] >= 0 ? '+' : '' }}{{ round.settled.deltas[0] }}</div>
            <div class="line dim">本轮净：{{ [0, 1, 2, 3].map(s => `${NAMES[s]}${round.settled.deltas[s] >= 0 ? '+' : ''}${round.settled.deltas[s]}`).join(' · ') }}</div>
            <div class="line" v-for="(t, i) in round.settled.transfers" :key="i">
              {{ t.draw ? `${NAMES[t.from]} 与 ${NAMES[t.to]} 平局互抵` : `${NAMES[t.from]} 付 ${NAMES[t.to]} ${t.amount}${t.chipMult ? ` ×${t.chipMult}` : ''}` }}
            </div>
            <div class="line chipnote" v-if="round.settled.chipBonus > 0">
              桌面词条资助 +{{ round.settled.chipBonus }}（倍率零和 · 资助净和 {{ round.settled.zeroSumNet }}）
            </div>
          </div>
          <button class="btn" v-if="!S.sess.over && !S.auto" @click="next()">下一轮</button>
        </div>

        <!-- 终场排名屏 -->
        <div class="nn-final" v-if="S.sess?.over">
          <div class="big">🏁 整场结束 · 冠军 <b>{{ NAMES[S.sess.champ] }}</b>（{{ S.sess.scores[S.sess.champ] >= 0 ? '+' : '' }}{{ S.sess.scores[S.sess.champ] }}）</div>
          <div class="line" v-for="(i, k) in rankings" :key="i">
            <b>{{ k + 1 }}</b> {{ NAMES[i] }} · 净分 {{ S.sess.scores[i] >= 0 ? '+' : '' }}{{ S.sess.scores[i] }}
          </div>
          <button class="btn primary" @click="S.phase = 'menu'; newSession()">再来一整场</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style>
/* 牛牛牌桌（.nn 前缀，避免与 .pcard/.dim 等全局像素类冲突） */
.nn, .nn * { box-sizing: border-box; }
.nn .table-wrap { min-height: 100vh; display: flex; flex-direction: column; gap: 8px;
  background: radial-gradient(120% 90% at 50% 20%, #3e8e6a 0%, #1f5c43 60%, #143c2f 100%);
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom)); color: #f1faee; }
.nn .topbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.nn .topbar .title { font-size: 16px; font-weight: 800; letter-spacing: 1px; }
.nn .chip { font-size: 12px; color: #c3dccd; background: rgba(9,38,29,.55); border: 1px solid rgba(255,255,255,.08); border-radius: 999px; padding: 3px 10px; }
.nn .chip b { color: #f2b21b; }
.nn .btn { border: 2px solid var(--ink); border-radius: 0; padding: 7px 16px; font-size: 13px; font-weight: 900; cursor: pointer; background: #12453a; color: #f1faee; box-shadow: 0 3px 0 var(--ink); }
.nn .btn:active { transform: translateY(3px); box-shadow: 0 0 0 var(--ink); }
.nn .btn.primary { background: #f2b21b; color: #3a2c00; }
.nn .btn.ghost { background: transparent; border: 2px solid rgba(255,255,255,.25); box-shadow: none; }
.nn .btn.tiny { padding: 4px 10px; font-size: 12px; }
.nn .btn.on { background: #f2b21b; color: #3a2c00; }
.nn .btn:disabled { opacity: .4; }
.nn .dim { color: #c3dccd; font-weight: 400; }
.nn .small { font-size: 11px; }
.nn .chip.offline { font-size: 11px; padding: 2px 8px; border-color: rgba(255,255,255,.2); background: rgba(255,255,255,.05); color: #c3dccd; }
.nn .chip.lvl { border-color: rgba(255,150,80,.5); color: #ffd9b3; }
.nn .lv-row { display: flex; align-items: center; gap: 6px; margin: 8px 0; }
.nn .lv-row .dim { font-size: 12px; }
.nn .lv-row .btn.tiny { padding: 3px 10px; font-size: 12px; }
.nn .lv-row .btn.on { background: #f2b21b; color: #3a2c00; }
.nn .chip.term { border-color: rgba(242,178,27,.5); background: rgba(242,178,27,.12); color: #ffe8b3; font-size: 11px; }
.nn .settle .chipnote { color: #f2b21b; font-size: 11px; }

.nn-menu { text-align: left; padding: 14px; background: rgba(9,38,29,.55); border-radius: 14px; }
.nn-menu h3 { margin: 0 0 4px; font-size: 18px; }
.nn-menu .slogan { font-size: 12px; color: #c3dccd; margin-bottom: 8px; }
.nn-menu ul { margin: 8px 0 12px; padding-left: 18px; font-size: 12.5px; color: #c3dccd; line-height: 1.6; }

/* 牌桌方位：对家上、左右两侧、自家下（中列=操作区） */
.nn .nn-table { flex: 1; display: flex; flex-direction: column; gap: 6px; align-items: center; }
.nn .nn-seat { background: rgba(9,38,29,.55); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 5px 8px; }
.nn .nn-top { display: flex; align-items: center; gap: 8px; }
.nn .nn-mid { display: grid; grid-template-columns: 132px 1fr 132px; gap: 8px; align-items: center; width: 100%; max-width: 680px; flex: 1; min-height: 0; }
.nn .nn-side { display: flex; flex-direction: column; gap: 4px; align-items: center; }
.nn .nn-name { font-size: 12px; font-weight: 700; color: #c3dccd; }
.nn .nn-name.you { color: #f2b21b; }
.nn .nn-mini { display: flex; gap: 2px; }
.nn .mcard { width: 26px; height: 37px; border-radius: 4px; background: #fdfdfb; color: #22303a; position: relative; font-size: 11px; font-weight: 800; flex: 0 0 auto; }
.nn .mcard.red { color: #d64550; }
.nn .mcard b { position: absolute; top: 1px; left: 3px; font-size: 10px; }
.nn .mcard:not(.open) .back { position: absolute; inset: 0; background: linear-gradient(145deg, #3a6ea5, #1d3557); border-radius: 4px; }
/* v1.15 即时反馈：亮牌翻转（settled 时 .open 加入触发）、发牌飞入、牌型徽标弹入 */
.nn .mcard.open { animation: cardFlipK .3s steps(4) both; }
.nn .nn-card { animation: cardInK .18s steps(2) backwards; }
.nn .nn-tag { animation: cardInK .18s steps(2) backwards; }
.nn .settle .big { animation: popInK .3s steps(3) both; }
.nn .nn-final .big { animation: popInK .3s steps(3) both; }
.nn .nn-final .line { animation: cardInK .2s steps(2) backwards; }
.nn .nn-final .line:nth-child(2) { animation-delay: .06s; }
.nn .nn-final .line:nth-child(3) { animation-delay: .12s; }
.nn .nn-final .line:nth-child(4) { animation-delay: .18s; }
.nn .nn-tag { font-size: 11px; color: #f2b21b; font-weight: 700; }
.nn .nn-center { text-align: center; display: flex; flex-direction: column; gap: 8px; align-items: center; }
.nn .nn-hint { font-size: 12.5px; color: #f2b21b; font-weight: 700; }
.nn .nn-turnhint { font-size: 11px; color: #8899a8; }
.nn .nn-turnhint.you { color: #7ee787; }
.nn .nn-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
.nn .nn-dblhint { align-self: center; font-size: 11px; font-weight: 700; color: #f2b21b; }
.nn .nn-dblhint.strong { color: #7ee787; }
.nn .nn-dblhint.weak { color: #8899a8; }
.nn .nn-me { display: flex; flex-direction: column; gap: 5px; align-items: center; }
.nn .nn-myCards { display: flex; gap: 6px; flex-wrap: nowrap; }
.nn .nn-card { position: relative; width: var(--nn-cw, 58px); height: calc(var(--nn-cw, 58px) * 1.4); background: #fdfdfb; border: 1.5px solid #d9d9cf; border-radius: 7px; color: #22303a; box-shadow: 0 2px 5px rgba(0,0,0,.3); cursor: pointer; flex: 0 0 auto; }
.nn .nn-card.red { color: #d64550; }
.nn .nn-card.pick { border-color: #f2b21b; box-shadow: 0 0 0 3px rgba(242,178,27,.45); }
.nn .nn-card.dim { opacity: .45; }
.nn .nn-card .rk { position: absolute; top: 4px; left: 5px; font-size: 16px; font-weight: 800; }
.nn .nn-card .pip { position: absolute; inset: 0; display: grid; place-items: center; font-size: 24px; opacity: .9; }
.nn .nn-card .pick-tag { position: absolute; top: -8px; right: -8px; background: #f2b21b; color: #3a2c00; font-size: 10px; font-weight: 800; border-radius: 999px; padding: 1px 6px; }

/* 累计分条 */
.nn .nn-scores { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; font-size: 12px; color: #c3dccd; }
.nn .nn-sc b { color: #b9fbc0; }
.nn .nn-sc.me b { color: #f2b21b; }
.nn .nn-sc.win { color: #f2b21b; font-weight: 800; }
.nn .nn-sc.lead { color: #f2b21b; }
.nn .nn-board { font-size: 11px; color: #7ee787; font-weight: 700; }
.nn .nn-prog { display: flex; align-items: center; gap: 6px; margin-top: 5px; }
.nn .nn-prog-track { flex: 1; height: 5px; background: rgba(255,255,255,.12); border-radius: 3px; overflow: hidden; }
.nn .nn-prog-track i { display: block; height: 100%; background: #f2b21b; transition: width .3s; }
.nn .nn-prog-label { font-size: 10px; color: #c3dccd; }
.nn .nn-log { margin-top: 6px; display: flex; flex-direction: column; gap: 3px; align-items: center; }
.nn .nn-log-title { font-size: 10px; color: #8899a8; }
.nn .nn-log-chip { font-size: 10px; color: #c3dccd; background: rgba(9,38,29,.5); padding: 1px 8px; border-radius: 999px; }
.nn .nn-log-chip i { color: #f2b21b; font-style: normal; margin-right: 3px; }

/* 结算 / 排名 */
.nn .controls { display: flex; gap: 10px; justify-content: center; align-items: center; flex-wrap: wrap; padding: 4px 0; }
.nn .settle { text-align: center; }
.nn .settle .big { font-size: 15px; font-weight: 800; color: #f2b21b; }
.nn .settle .line { font-size: 11px; color: #c3dccd; margin-top: 2px; }
.nn .nn-final { text-align: center; background: rgba(9,38,29,.6); border: 1px solid rgba(242,178,27,.4); border-radius: 14px; padding: 14px; }
.nn .nn-final .big { font-size: 17px; font-weight: 800; color: #f2b21b; }
.nn .nn-final .line { font-size: 13px; color: #c3dccd; margin-top: 4px; }

/* ── 手机横屏（≤480px 高）：一屏放下，自家 5 张不折行 ── */
@media (orientation: landscape) and (max-height: 480px) {
  .nn .table-wrap { min-height: 0; height: var(--vh, 100vh); overflow-y: auto; gap: 4px; padding: 6px 8px calc(4px + env(safe-area-inset-bottom)); }
  .nn { --nn-cw: min(calc((var(--vh, 100vh) - 170px) / 1.4), 52px); }
  .nn .topbar { gap: 6px; }
  .nn .topbar .chip { font-size: 11px; padding: 2px 8px; }
  .nn .topbar .title { font-size: 14px; }
  .nn .nn-mid { grid-template-columns: 118px 1fr 118px; gap: 6px; }
  .nn .mcard { width: 22px; height: 31px; }
  .nn .btn { padding: 5px 12px; font-size: 12px; }
  .nn .nn-actions { gap: 4px; }
  .nn .nn-myCards { gap: 4px; }
}

/* ── 小竖屏（≤400px 宽）：侧栏/牌背/自家大牌全部收窄，禁止横向溢出 ── */
@media (max-width: 400px) {
  .nn .table-wrap { padding: 8px 8px calc(8px + env(safe-area-inset-bottom)); }
  .nn { --nn-cw: min(calc((100vw - 46px) / 5 - 3px), 58px); }
  .nn .nn-mid { grid-template-columns: 76px 1fr 76px; gap: 4px; }
  .nn .nn-mini { gap: 1px; flex-wrap: wrap; justify-content: center; max-width: 76px; }
  .nn .mcard { width: 14px; height: 20px; border-radius: 3px; font-size: 8px; }
  .nn .mcard b { font-size: 7px; top: 1px; left: 2px; }
  .nn .nn-myCards { gap: 3px; }
  .nn .nn-card .rk { font-size: 13px; top: 3px; left: 4px; }
  .nn .nn-card .pip { font-size: 20px; }
  .nn .nn-seat { padding: 4px 5px; }
  .nn .nn-name { font-size: 11px; }
}
</style>

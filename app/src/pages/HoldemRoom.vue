<script setup>
// 德州扑克牌桌（Space 集成版）：逻辑在 @space/shared/cards/holdem，本页只做交互与展示
// 布局：真实牌桌方位——对家上、左/右两侧、自家下；公共牌+底池居中；10 手 + rebuy×3 整场
import { reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { createSession, startNextHand, act, legalActions, aiDecide, handOver, evalText, HAND_CN, turnHint, actionHint, potBreakdown, raiseOptions, handStrength, matchStanding, serialize, restore } from '@space/shared/cards/holdem';
import { formatChipDisplay } from '@space/shared/cards/meta';
import { sfx } from '../ui/sfx.js';
import { localGet, localSet, localRemove } from '../env.js';

const NAMES = { 0: '你', 1: '左家·AI', 2: '对家·AI', 3: '右家·AI' };
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RK = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const rk = v => RK[v] || String(v);
const STREET_CN = { preflop: '底牌轮', flop: '翻牌', turn: '转牌', river: '河牌' };

const S = reactive({ sess: null, raiseTo: 0, fast: false, auto: false, hint: null, errs: [], phase: 'menu', level: 1 });
let timer = 0;
// v1.53 统一五档（与掼蛋/麻将/牛牛同命名；1=进阶=历史默认零回归；3 地域=松凶 4 绝望=最大压迫）
const LV_CN = { 0: '普通', 1: '进阶', 2: '高阶', 3: '地域', 4: '绝望' };

// v1.41 单机存档（对齐掼蛋 localStorage「继续上局」）：推进点落 localStorage，损坏→降级新开
const SAVE_KEY = 'holdem.save.v1';
function save() { if (S.sess) try { localSet(SAVE_KEY, serialize(S.sess)); } catch { /* 存储满/隐私模式忽略 */ } }
// 仅菜单态计算并随 S.phase 重读
const saved = computed(() => {
  if (S.phase !== 'menu') return null;
  try { const j = localGet(SAVE_KEY); return j ? restore(j) : null; } catch { return null; }
});
function continueMatch() {
  try {
    S.sess = restore(localGet(SAVE_KEY));
    S.raiseTo = 0; S.hint = null; S.phase = 'play'; S.auto = false;
    const t = S.sess.table;
    if (!S.sess.over && t.hand && !t.hand.results) schedule(); // 未摊的一手 → 直接续打
    else nextHand(); // 已摊/尚未开局 → 下一手（nextHand 内部守 !over）
    save();
  } catch { newSession(); } // 存档损坏/跨版本 → 降级新开
}

function newSession() {
  clearTimeout(timer);
  S.sess = createSession((Date.now() ^ (Math.random() * 0xffffff)) & 0x7fffffff, { totalHands: 10, rebuyLimit: 3 });
  S.phase = 'play';
  startNextHand(S.sess);
  sfx.deal();
  schedule();
  save();
}
function nextHand() { if (S.sess && !S.sess.over) { startNextHand(S.sess); sfx.deal(); schedule(); save(); } }
const T = () => S.sess?.table ?? null;
function myTurn() { const t = T(); return t?.hand && !t.hand.results && t.hand.toAct === 0; }
function la() { return myTurn() ? legalActions(T(), 0) : null; }
// v1.30 掼蛋「提示」移植：推荐最优动作（强档 AI），显示文案供参考（不代打）
function showHint() { if (!myTurn()) return; S.hint = actionHint(T(), 0, 2); }
function doAct(action) {
  if (!myTurn()) return;
  S.hint = null; // 行动后清提示
  // 引擎现拒绝越界金额；滑杆可能因状态刷新滞后 → 发送前钳位到当前合法区间
  let amt;
  if (action === 'raise') {
    const la0 = legalActions(T(), 0);
    amt = Math.min(Math.max(S.raiseTo, la0.minRaiseTo), la0.raiseMax);
  }
  const r = act(T(), 0, action, amt);
  if (r.ok) { sfx.tap(); save(); schedule(); }
}
function schedule() {
  clearTimeout(timer);
  const t = T();
  if (!t || S.sess?.over) return;
  if (!t.hand || t.hand.results) {
    if (S.auto) timer = setTimeout(nextHand, S.fast ? 150 : 800); // 自动：本手已摊/未开 → 推进下一手
    return; // 非自动：等玩家点"下一手"
  }
  const seat = t.hand.toAct;
  if (seat === 0 && !S.auto) return; // 人座：非自动等玩家；自动时 AI 替打
  timer = setTimeout(() => {
    const tt = T();
    if (!tt?.hand || tt.hand.results || tt.hand.toAct !== seat) return;
    const d = aiDecide(tt, seat, S.level);
    act(tt, seat, d.action, d.amount);
    schedule();
  }, S.fast ? 120 : 700);
}
// v1.29 自动打完整场：切换 auto 后重新 schedule（人座即 AI 替打 + 手手自动推进）
function toggleAuto() { S.auto = !S.auto; if (S.auto) S.fast = true; schedule(); }
watch(() => T()?.hand?.toAct, schedule);
// v1.15 即时反馈：公共牌翻出（street 推进）/ 摊牌结算 / 整场结束
watch(() => T()?.hand?.board?.length, (n, o) => { if (o !== undefined && n > o && !T()?.hand?.results) sfx.flip(); });
watch(() => T()?.hand?.results, (v) => { if (v) sfx.payout(); });
watch(() => S.sess?.over, (v) => { if (v) { sfx.fanfare(); S.auto = false; try { localRemove(SAVE_KEY); } catch { /* noop */ } } });
onMounted(() => {});
onBeforeUnmount(() => clearTimeout(timer));

const h = computed(() => T()?.hand);
const button = computed(() => T()?.button ?? -1); // v1.50：庄=button（heads-up 时 button 同时是 SB）
const pot = computed(() => (h.value ? h.value.committed.reduce((a, b) => a + b, 0) : 0));
// v1.31 边池构成说明：全下多层时按层拆池（各层 eligible 不同）
const pots = computed(() => potBreakdown(T()));
// v1.50：摊牌后中心区展示的总池（committed 已清零 → 从 results 汇总，避免"底池 0"误导）
const settledPot = computed(() => (settled.value ? settled.value.pots.reduce((n, p) => n + p.amount, 0) : 0));
// v1.32 加注档位建议（最小/半池/底池，点选设 S.raiseTo）
const ro = computed(() => (myTurn() ? raiseOptions(T(), 0) : null));
function setRaise(amt) { S.raiseTo = Math.max(raiseMin, Math.min(raiseMaxV, amt)); }
// v1.35 手牌牌力提示（你的手牌：牌型·强度档，翻牌起可用）
const myStr = computed(() => handStrength(T(), 0));
// v1.36 整场态势（掼蛋"级牌进度/打级方"等价）：领先者 + 领先差距
const standing = computed(() => matchStanding(S.sess));
const board = computed(() => h.value?.board ?? []);
const settled = computed(() => h.value?.results ?? null);
// v1.26 当前轮提示（掼蛋 turn-hint 移植）：共享纯函数 turnHint 统一驱动 4 座高亮 + 文案
const th = computed(() => turnHint(S.sess));
const raiseMin = computed(() => la()?.minRaiseTo ?? 0);
const raiseMaxV = computed(() => la()?.raiseMax ?? 0);
// v1.50：跟注是否实为全下（跟平即耗光余栈）→ 按钮文案「跟（全下）」
const callIsAllin = computed(() => {
  const la0 = la(), t = T();
  if (!la0 || !t || !la0.canCall || la0.toCall <= 0) return false;
  return la0.toCall >= t.stacks[0]; // toCall 已按余栈封顶 → 跟平=全下
});
// v1.50：中心街位标签——摊牌后按 results.street（引擎已修 runout 误报），进行中按 h.street
const streetNow = computed(() => STREET_CN[(settled.value && settled.value.street) || h.value?.street || '']);
function seatBlinds(s) {
  const hh = h.value; if (!hh) return '';
  const out = [];
  if (hh.sb === s) out.push('SB');
  if (hh.bb === s) out.push('BB');
  return out.join(' ');
}

const rankings = computed(() => {
  const t = T(); if (!t) return [];
  return [0, 1, 2, 3].sort((a, b) => t.stacks[b] - t.stacks[a]);
});
// 下注日志（最近 6 条）
const log = computed(() => {
  const hh = T()?.history ?? [];
  return hh.slice(-6).map(e => {
    if (e.type === 'hand') return `第 ${e.handNo} 手开始（庄 ${NAMES[e.button]}）`;
    if (e.type === 'fold-win') return `弃牌收池 ${NAMES[e.winner]} +${e.total}`;
    if (e.type === 'showdown') return `摊牌 → ${e.pots.map(p => p.winners.map(w => NAMES[w]).join('&')).join(' / ')}`;
    if (e.type === 'raise') return `${NAMES[e.seat]} 加注到 ${e.to}`;
    if (e.type === 'allin') return `${NAMES[e.seat]} 全下到 ${e.to}`;
    if (e.type === 'call') return `${NAMES[e.seat]} 跟 ${e.pay}`;
    if (e.type === 'check') return `${NAMES[e.seat]} 过牌`;
    if (e.type === 'fold') return `${NAMES[e.seat]} 弃牌`;
    return e.type;
  });
});
function seatState(s) {
  const hh = h.value; if (!hh) return '';
  if (hh.folded[s]) return '弃牌';
  if (hh.allin[s]) return '全下';
  if (hh.streetCommitted[s] > 0) return `已投 ${hh.streetCommitted[s]}`;
  return '';
}
// 回归钩子（对齐 GuandanRoom.__guandan 惯例）：驱动整场
window.__holdem = {
  get sess() { return S.sess; },
  get t() { return S.sess?.table ?? null; },
  newSession,
  playHands(n) { let k = 0; while (k++ < n && S.sess && !S.sess.over) { startNextHand(S.sess); const t = S.sess.table; let g = 0; while (!handOver(t) && g++ < 800) { const s = t.hand.toAct; const d = s === 0 ? { action: legalActions(t, 0).canCall ? 'call' : 'check' } : aiDecide(t, s, S.level); act(t, s, d.action, d.amount); } } },
};
watch(raiseMin, v => { S.raiseTo = v; });
function cardCls(c) { return { red: c.s === 'H' || c.s === 'D' }; }
</script>

<template>
  <div class="gtable hd">
    <div class="table-wrap">
      <div class="topbar">
        <span class="title">德州扑克 · 10 手场</span>
        <template v-if="S.sess">
          <span class="chip">第 <b>{{ S.sess.handNo }}/10</b> 手</span>
          <span class="chip lead" v-if="standing && !S.sess.over && standing.leaderGap > 0">领先 <b>{{ NAMES[standing.leader] }}</b> +{{ standing.leaderGap }}</span>
          <span class="chip">小盲 10 / 大盲 20</span>
          <span class="chip" v-if="S.sess.rebuys.some(n => n > 0)">rebuy {{ S.sess.rebuys.join('/') }}</span>
          <span class="chip lvl">AI {{ LV_CN[S.level] }}</span>
          <span v-if="S.sess.chips && S.sess.chips.length" class="chip term">词条 {{ formatChipDisplay(S.sess.chips) }}</span>
        </template>
        <span style="flex:1"></span>
        <span class="chip offline">单机 · 不计积分</span>
        <button class="btn ghost tiny" @click="S.fast = !S.fast">{{ S.fast ? '慢速' : '快速' }}</button>
        <button class="btn ghost tiny" v-if="S.phase === 'play' && !S.sess?.over" :class="{ on: S.auto }" @click="toggleAuto()">{{ S.auto ? '停止自动' : '自动打完' }}</button>
        <button class="btn ghost tiny" @click="$router.replace('/island')">返回大厅</button>
      </div>

      <!-- 开局规则屏 -->
      <div v-if="S.phase === 'menu'" class="hd-menu">
        <h3>德州扑克 · 10 手小费局</h3>
        <div class="slogan">4 人 · 起始 1000 筹码 · 盲注 10/20 · 断码可 rebuy×3 · 10 手后按筹码定冠军</div>
        <ul>
          <li>每人 2 张底牌 + 公共 5 张（翻 3 / 转 1 / 河 1），7 选 5 组最强。</li>
          <li>牌型：皇家 &gt; 同花顺 &gt; 四条 &gt; 葫芦 &gt; 同花 &gt; 顺 &gt; 三条 &gt; 两对 &gt; 一对 &gt; 高牌（A2345 最小顺）。</li>
          <li>动作：弃牌 / 过牌 / 跟注 / 加注（滑条）/ 全下；全下自动建边池。</li>
          <li>无上限加注（每次加注≥上一加注）；筹码 &lt; 5 盲自动 rebuy（最多 3 次）。</li>
          <li>难度：地域/绝望档 AI 加注尺度最大、偷牌与全下最频繁，最考验读牌与控筹。</li>
        </ul>
        <div class="lv-row">
          <span class="dim">AI 难度</span>
          <button v-for="(lab, l) in LV_CN" :key="l" class="btn tiny" :class="{ on: S.level === +l }" @click="S.level = +l">{{ lab }}</button>
        </div>
        <button class="btn" v-if="saved && !saved.over" @click="continueMatch()">继续上局（已打 {{ saved.handNo }}/{{ saved.totalHands }} 手）</button>
        <button class="btn primary" @click="newSession()">开整场（10 手 + 3 rebuy）</button>
      </div>

      <template v-else>
        <!-- 真实牌桌方位：对家上、左右两侧、自家下 -->
        <div class="hd-table" v-if="h">
          <div class="hd-seat hd-top" :class="{ act: th.activeSeat === 2 }">
            <span class="hd-name">对家·AI<em v-if="button === 2">庄</em><em class="blind" v-if="seatBlinds(2)">{{ seatBlinds(2) }}</em></span>
            <span class="hd-chips">{{ T().stacks[2] }}</span>
            <span class="hd-hole">
              <!-- v1.50：弃牌者底牌保持牌背（真扑克 muck 到摊牌），只在摊牌时亮 -->
              <span v-for="c in h.hole[2]" :key="S.sess.handNo + '-' + c.id" class="hcard sm" :class="{ ...cardCls(c), open: settled }">
                <template v-if="settled"><b>{{ rk(c.v) }}{{ SUIT[c.s] }}</b></template>
                <template v-else><i class="back"></i></template>
              </span>
            </span>
            <span class="hd-tag" v-if="seatState(2)">{{ seatState(2) }}</span>
          </div>

          <div class="hd-mid">
            <div class="hd-seat hd-side" :class="{ act: th.activeSeat === 1 }">
              <span class="hd-name">左家·AI<em v-if="button === 1">庄</em><em class="blind" v-if="seatBlinds(1)">{{ seatBlinds(1) }}</em></span>
              <span class="hd-chips">{{ T().stacks[1] }}</span>
            <span class="hd-hole">
              <span v-for="c in h.hole[1]" :key="S.sess.handNo + '-' + c.id" class="hcard sm" :class="{ ...cardCls(c), open: settled }">
                <template v-if="settled"><b>{{ rk(c.v) }}{{ SUIT[c.s] }}</b></template>
                <template v-else><i class="back"></i></template>
              </span>
            </span>
              <span class="hd-tag" v-if="seatState(1)">{{ seatState(1) }}</span>
            </div>

            <div class="hd-center">
            <div class="hd-board">
              <div v-for="i in 5" :key="S.sess.handNo + '-' + (board[i - 1]?.id ?? 'e' + i)" class="hcard" :class="{ dealt: !!board[i - 1] }">
                <template v-if="board[i - 1]"><b class="num">{{ rk(board[i - 1].v) }}{{ SUIT[board[i - 1].s] }}</b></template>
                <template v-else><i class="empty"></i></template>
              </div>
            </div>
              <div class="hd-pot">
                <template v-if="settled">
                  结算 底池 <b>{{ settledPot }}</b> · {{ streetNow }}
                </template>
                <template v-else-if="pots.length > 1">
                  <template v-for="p in pots" :key="p.potNo">
                    <b>{{ p.isMain ? '主池' : '边池' }} {{ p.amount }}<i>（{{ p.eligible.map(s => NAMES[s]).join('·') }}）</i></b>
                  </template>
                  <div>合计 <b>{{ pots.reduce((n, p) => n + p.amount, 0) }}</b> · {{ streetNow }}</div>
                </template>
                <template v-else>底池 <b>{{ pot }}</b> · {{ streetNow }}</template>
              </div>
              <div class="hd-turnhint" :class="{ you: th.kind === 'your-turn', done: th.kind === 'done' }" v-if="th.kind !== 'idle'">{{ th.kind === 'your-turn' ? '轮到你行动' : th.kind === 'ai-turn' ? `等待 ${NAMES[th.activeSeat]}…` : th.kind === 'settling' ? '本手摊牌·结算…' : '整场结束' }}</div>
              <div class="hd-log" v-if="log.length">
                <span v-for="(l, i) in log" :key="i" class="hd-log-chip" :class="{ last: i === log.length - 1 }">{{ l }}</span>
              </div>
            </div>

            <div class="hd-seat hd-side" :class="{ act: th.activeSeat === 3 }">
              <span class="hd-name">右家·AI<em v-if="button === 3">庄</em><em class="blind" v-if="seatBlinds(3)">{{ seatBlinds(3) }}</em></span>
              <span class="hd-chips">{{ T().stacks[3] }}</span>
            <span class="hd-hole">
              <span v-for="c in h.hole[3]" :key="S.sess.handNo + '-' + c.id" class="hcard sm" :class="{ ...cardCls(c), open: settled }">
                <template v-if="settled"><b>{{ rk(c.v) }}{{ SUIT[c.s] }}</b></template>
                <template v-else><i class="back"></i></template>
              </span>
            </span>
              <span class="hd-tag" v-if="seatState(3)">{{ seatState(3) }}</span>
            </div>
          </div>

          <!-- 自家 -->
          <div class="hd-me" :class="{ act: th.activeSeat === 0 }">
            <div class="hd-name you">你<em v-if="button === 0">庄</em><em class="blind" v-if="seatBlinds(0)">{{ seatBlinds(0) }}</em></div>
            <div class="hd-hole me">
              <span v-for="c in h.hole[0]" :key="S.sess.handNo + '-' + c.id" class="hcard sm" :class="cardCls(c)"><b>{{ rk(c.v) }}{{ SUIT[c.s] }}</b></span>
            </div>
            <span class="hd-chips">{{ T().stacks[0] }}</span>
            <span class="hd-tag" v-if="seatState(0)">{{ seatState(0) }}</span>
            <span class="hd-str" :class="myStr.tier" v-if="myStr.ready">{{ myStr.hand }}·{{ myStr.label }}</span>
          </div>
        </div>

        <!-- 结算 / 下一手 / 动作 -->
        <div class="controls" v-if="T()">
          <template v-if="S.sess.over">
            <div class="hd-final fx-pop">
              <div class="big">🏁 整场结束 · 共 {{ S.sess.handNo }} 手 · 冠军 <b>{{ NAMES[S.sess.champ] }}</b></div>
              <div class="line" v-for="(i, k) in rankings" :key="i"><b>{{ k + 1 }}</b> {{ NAMES[i] }} · 筹码 {{ T().stacks[i] }}（rebuy ×{{ S.sess.rebuys[i] }}）<template v-if="S.sess.chipEarnings[i] > 0"> · 词条 +{{ S.sess.chipEarnings[i] }}</template></div>
              <button class="btn primary" @click="newSession()">再来一整场</button>
            </div>
          </template>
          <template v-else-if="settled">
            <div class="settle fx-pop">
              <div v-for="(p, i) in settled.pots" :key="i" class="line">
                池 {{ p.amount }} → {{ p.winners.map(w => NAMES[w]).join(' & ') || '无人' }} {{ p.hand ? `（${p.hand}）` : '' }}
              </div>
              <div v-if="S.sess.lastHandChip && S.sess.lastHandChip.handNo === S.sess.handNo && S.sess.lastHandChip.total > 0" class="line chipnote">
                桌面词条资助 +{{ S.sess.lastHandChip.total }}（旁路台账 · 不影响筹码池）
              </div>
            </div>
            <button class="btn primary" v-if="!S.auto" @click="nextHand()">{{ S.sess.handNo >= S.sess.totalHands ? '看终场结算' : '下一手' }}</button>
          </template>
          <template v-else-if="la()">
            <button class="btn ghost" @click="showHint()">提示</button>
            <div class="hd-hint" v-if="S.hint">{{ S.hint.text }}</div>
            <button class="btn danger" @click="doAct('fold')">弃牌</button>
            <button class="btn ghost" v-if="la().canCheck" @click="doAct('check')">过牌</button>
            <button class="btn" v-if="la().canCall" @click="doAct('call')" :class="{ allin: callIsAllin }">{{ callIsAllin ? `跟（全下） ${la().toCall}` : `跟注 ${la().toCall}` }}</button>
            <template v-if="la().canRaise">
              <div class="hd-ladder" v-if="ro && ro.ladder.length">
                <button v-for="o in ro.ladder" :key="o.key" class="btn tiny" :class="{ on: S.raiseTo === o.amount }" @click="setRaise(o.amount)">{{ o.label }} {{ o.amount }}</button>
              </div>
              <button class="btn" @click="doAct('raise')">加注到 {{ S.raiseTo }}</button>
              <input type="range" :min="raiseMin" :max="raiseMaxV" :step="10" v-model.number="S.raiseTo" class="raise-slider" />
            </template>
            <button class="btn" v-if="la().canRaise" @click="doAct('allin')">全下</button>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>

<style>
.hd, .hd * { box-sizing: border-box; }
.hd .table-wrap { min-height: 100vh; display: flex; flex-direction: column; gap: 6px;
  background: radial-gradient(120% 90% at 50% 20%, #3e8e6a 0%, #1f5c43 60%, #143c2f 100%);
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom)); color: #f1faee; }
.hd .topbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hd .topbar .title { font-size: 16px; font-weight: 800; }
.hd .chip { font-size: 12px; color: #c3dccd; background: rgba(9,38,29,.55); border: 1px solid rgba(255,255,255,.08); border-radius: 999px; padding: 3px 10px; }
.hd .chip b { color: #f2b21b; }
.hd .chip.lead { border-color: rgba(126,231,135,.5); color: #7ee787; }
.hd .btn { border: 2px solid var(--ink); border-radius: 0; padding: 7px 16px; font-size: 13px; font-weight: 900; cursor: pointer; background: #12453a; color: #f1faee; box-shadow: 0 3px 0 var(--ink); }
.hd .btn:active { transform: translateY(3px); box-shadow: 0 0 0 var(--ink); }
.hd .btn.primary { background: #f2b21b; color: #3a2c00; }
.hd .btn.ghost { background: transparent; border: 2px solid rgba(255,255,255,.25); box-shadow: none; }
.hd .btn.danger { background: #a83a3a; }
.hd .btn.tiny { padding: 4px 10px; font-size: 12px; }
.hd .btn.on { background: #f2b21b; color: #3a2c00; }
.hd .chip.offline { font-size: 11px; padding: 2px 8px; border-color: rgba(255,255,255,.2); background: rgba(255,255,255,.05); color: #c3dccd; }
.hd .chip.term { border-color: rgba(242,178,27,.5); background: rgba(242,178,27,.12); color: #ffe8b3; font-size: 11px; }
.hd .settle .chipnote { color: #f2b21b; font-size: 11px; }
.hd .chip.lvl { border-color: rgba(255,150,80,.5); color: #ffd9b3; }
.hd .lv-row { display: flex; align-items: center; gap: 6px; margin: 8px 0; }
.hd .lv-row .dim { font-size: 12px; }
.hd .lv-row .btn.tiny { padding: 3px 10px; font-size: 12px; }
.hd .lv-row .btn.on { background: #f2b21b; color: #3a2c00; }

.hd-menu { text-align: left; padding: 14px; background: rgba(9,38,29,.55); border-radius: 14px; }
.hd-menu h3 { margin: 0 0 4px; font-size: 18px; }
.hd-menu .slogan { font-size: 12px; color: #c3dccd; margin-bottom: 8px; }
.hd-menu ul { margin: 8px 0 12px; padding-left: 18px; font-size: 12.5px; color: #c3dccd; line-height: 1.6; }

/* 牌桌方位：对家上、左右两侧、自家下 */
.hd .hd-table { flex: 1; display: flex; flex-direction: column; gap: 5px; }
.hd .hd-seat { background: rgba(9,38,29,.55); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 5px 8px; min-width: 120px; }
.hd .hd-seat.act { border-color: #f2b21b; box-shadow: 0 0 0 2px rgba(242,178,27,.3); }
.hd .hd-top { display: flex; align-items: center; gap: 8px; justify-content: center; align-self: center; flex-wrap: wrap; }
.hd .hd-mid { display: grid; grid-template-columns: 130px 1fr 130px; gap: 8px; align-items: center; }
.hd .hd-side { display: flex; flex-direction: column; gap: 4px; }
.hd .hd-name { font-size: 12px; font-weight: 700; color: #c3dccd; }
.hd .hd-name em { font-style: normal; color: #f2b21b; margin-left: 4px; font-size: 11px; }
.hd .hd-name em.blind { color: #8ff0a4; }
.hd .btn.allin { background: #b5485d; }
.hd .hd-name.you { color: #f2b21b; }
.hd .hd-chips { font-size: 12px; color: #f2b21b; font-weight: 800; }
.hd .hd-tag { font-size: 11px; color: #c3dccd; }
.hd .hd-hole { display: flex; gap: 4px; }
/* 公共牌 & 手牌 */
.hd .hcard { position: relative; width: 48px; height: 67px; background: #fdfdfb; border: 1.5px solid #d9d9cf; border-radius: 6px; color: #22303a; flex: 0 0 auto; }
.hd .hcard.sm { width: 34px; height: 48px; }
.hd .hcard .back { position: absolute; inset: 0; background: linear-gradient(145deg, #3a6ea5, #1d3557); border-radius: 4px; }
.hd .hcard b { position: absolute; top: 3px; left: 4px; font-size: 13px; font-weight: 800; }
.hd .hcard.sm b { font-size: 11px; top: 2px; left: 3px; }
.hd .hcard.red { color: #d64550; }
.hd .hcard .empty { position: absolute; inset: 0; border: 1.5px dashed rgba(255,255,255,.15); border-radius: 6px; background: rgba(255,255,255,.04); }
/* v1.15 即时反馈：公共牌翻入 / AI 底牌亮牌翻转 / 自家发牌飞入（纯 CSS，不阻塞 AI 时序） */
.hd .hd-board .hcard.dealt { animation: cardInK .18s steps(2) both; }
.hd .hcard.open { animation: cardFlipK .24s steps(3) both; }
.hd .hd-hole.me .hcard { animation: cardInK .18s steps(2) backwards; }
.hd .hd-board { display: flex; gap: 5px; justify-content: center; }
.hd .hd-center { display: flex; flex-direction: column; gap: 5px; align-items: center; }
.hd .hd-pot { font-size: 13px; color: #c3dccd; }
.hd .hd-pot b { color: #f2b21b; font-size: 15px; }
.hd .hd-pot i { color: #8fb8a8; font-size: 10px; font-style: normal; margin-right: 6px; }
.hd .hd-turnhint { font-size: 12px; font-weight: 700; color: #f2b21b; }
.hd .hd-hint { font-size: 12px; color: #7ee787; font-weight: 700; max-width: 260px; }
.hd .hd-ladder { display: flex; gap: 4px; flex-wrap: wrap; }
.hd .hd-ladder .btn.tiny { padding: 2px 8px; font-size: 11px; }
.hd .hd-ladder .btn.on { background: #f2b21b; color: #3a2c00; }
.hd .hd-str { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 8px; }
.hd .hd-str.nuts, .hd .hd-str.strong2 { color: #3a2c00; background: #f2b21b; }
.hd .hd-str.strong, .hd .hd-str.mid { color: #7ee787; }
.hd .hd-str.weak, .hd .hd-str.veryweak { color: #8899a8; }
.hd .hd-turnhint.you { color: #7ee787; }
.hd .hd-turnhint.done { color: #c3dccd; }
/* 下注日志 */
.hd .hd-log { display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; max-width: 420px; }
.hd .hd-log-chip { font-size: 10.5px; color: #c3dccd; background: rgba(9,38,29,.5); border-radius: 999px; padding: 1px 8px; }
.hd .hd-log-chip.last { color: #f2b21b; border: 1px solid rgba(242,178,27,.4); }
/* 自家 */
.hd .hd-me { display: flex; align-items: center; gap: 10px; justify-content: center; background: rgba(9,38,29,.55); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 6px 10px; }
.hd .hd-me.act { border-color: #f2b21b; box-shadow: 0 0 0 2px rgba(242,178,27,.3); }

/* 结算/排名 */
.hd .controls { display: flex; gap: 8px; justify-content: center; align-items: center; flex-wrap: wrap; padding: 4px 0; }
.hd .settle { text-align: center; }
.hd .settle .line { font-size: 12px; color: #c3dccd; margin-top: 2px; }
.hd .raise-slider { width: 140px; accent-color: #f2b21b; }
.hd .hd-final { text-align: center; background: rgba(9,38,29,.6); border: 1px solid rgba(242,178,27,.4); border-radius: 14px; padding: 12px; }
.hd .hd-final .big { font-size: 16px; font-weight: 800; color: #f2b21b; }
.hd .hd-final .line { font-size: 13px; color: #c3dccd; margin-top: 3px; }

/* ── 手机竖屏（≤560px 宽）：中列置顶，两侧并排，公共牌缩小 ── */
@media (max-width: 560px) {
  .hd .hd-mid { grid-template-columns: 1fr 1fr; }
  .hd .hd-center { grid-column: 1 / -1; order: -1; }
  .hd .hcard { width: 36px; height: 51px; }
  .hd .hcard.sm { width: 30px; height: 42px; }
  .hd .hd-seat { min-width: 0; }
  .hd .hd-board { gap: 3px; }
}

/* ── 手机横屏（≤480px 高）：一屏放下 ── */
@media (orientation: landscape) and (max-height: 480px) {
  .hd .table-wrap { min-height: 0; height: var(--vh, 100vh); overflow-y: auto; gap: 4px; padding: 6px 8px calc(4px + env(safe-area-inset-bottom)); }
  .hd .topbar { gap: 6px; }
  .hd .topbar .chip { font-size: 11px; padding: 2px 8px; }
  .hd .topbar .title { font-size: 14px; }
  .hd .hd-mid { grid-template-columns: 118px 1fr 118px; gap: 6px; }
  .hd .hcard { width: 38px; height: 54px; }
  .hd .hcard.sm { width: 28px; height: 40px; }
  .hd .hd-seat { min-width: 0; padding: 4px 6px; }
  .hd .hd-log { max-width: 340px; }
  .hd .hd-log-chip { font-size: 10px; }
  .hd .btn { padding: 5px 12px; font-size: 12px; }
  .hd .raise-slider { width: 110px; }
}
</style>

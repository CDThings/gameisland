/**
 * 掼蛋五级 AI（v1.49）：普通/进阶/高阶/地域/绝望。
 * 验收面：
 *  - 默认档=2（高阶）＝ v1.49 前行为零回归（choose(m,seat) ≡ choose(m,seat,2)）；
 *  - 全档确定性（同 seed 同档整场 log 逐条一致）+ 整场跑完 + 108 张守恒；
 *  - 各档行为钉：普通绝不用炸 / 进阶不抢炸 / 高阶与地域抢 4 炸 / 绝望不攥大牌、喂对烧牌；
 *  - LEVELS 元数据（5 档命名 + 默认档 + levelCn 兜底）。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { createMatch, startHand, play, pass } from '../src/cards/guandan/engine.js';
import { choose, hint, LEVELS, levelCn } from '../src/cards/guandan/ai.js';
import { recognize, TYPE } from '../src/cards/guandan/combos.js';

const c = (s, v, id) => ({ s, v, id });
/** 10 张互不相同点值的单张手（无对子无连张），用于构造"对手远收尾"。 */
function singles(ids, base) {
  const vs = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const ss = ['S', 'H', 'D', 'C', 'S', 'H', 'D', 'C', 'S', 'H'];
  return vs.map((v, i) => c(ss[i], v, base + i + ids));
}

/** AI 整场模拟（humanSeat=-1：进贡/还贡全自动，只走出牌/过牌循环）。 */
function simMatch(seed, level) {
  const m = createMatch(seed, -1);
  let steps = 0;
  while (m.phase !== 'matchOver') {
    if (++steps > 200000) throw new Error(`level=${level} 未跑完（steps=${steps}）`);
    if (m.phase === 'handEnd') { startHand(m); continue; }
    assert.equal(m.phase, 'play', `level=${level} 意外 phase=${m.phase}`);
    const d = choose(m, m.turnSeat, level);
    const r = d.pass ? pass(m, m.turnSeat) : play(m, m.turnSeat, d.cards);
    assert.ok(r.ok, `level=${level} step=${steps} 非法动作 reason=${r.reason}`);
  }
  return m;
}

test('LEVELS 元数据：5 档命名 + 默认高阶 + levelCn 兜底', () => {
  assert.deepEqual(LEVELS.map(x => x.id), [0, 1, 2, 3, 4]);
  assert.deepEqual(LEVELS.map(x => x.cn), ['普通', '进阶', '高阶', '地域', '绝望']);
  assert.equal(levelCn(4), '绝望');
  assert.equal(levelCn(99), '高阶'); // 未知档兜底默认档
  assert.equal(levelCn(), '高阶');
});

test('默认档=2：choose(m,seat) ≡ choose(m,seat,2)（整场每步零回归）+ hint 同口径', () => {
  const m = createMatch(31, -1);
  let checked = 0;
  while (m.phase !== 'matchOver') {
    if (m.phase === 'handEnd') { startHand(m); continue; }
    assert.equal(m.phase, 'play');
    assert.deepEqual(choose(m, m.turnSeat), choose(m, m.turnSeat, 2), '默认≡档2');
    assert.deepEqual(hint(m, m.turnSeat), hint(m, m.turnSeat, 2), 'hint 默认≡档2');
    const d = choose(m, m.turnSeat, 2);
    const r = d.pass ? pass(m, m.turnSeat) : play(m, m.turnSeat, d.cards);
    assert.ok(r.ok, `非法动作 reason=${r.reason}`);
    checked++;
  }
  assert.equal(m.matchOver, true);
  assert.ok(checked > 100, `整场步数=${checked}（应 >100）`);
});

test('全档（0..4）整场跑完 + 108 张守恒（终局手 3 家出完、余牌仅可能集中在末游一家）', () => {
  for (const lvl of [0, 1, 2, 3, 4]) {
    const m = simMatch(2026, lvl);
    assert.equal(m.matchOver, true, `level=${lvl} 整场跑完`);
    const holders = m.hands.map((h, i) => (h.length ? i : null)).filter(x => x !== null);
    assert.ok(holders.length <= 1, `level=${lvl} 余牌最多集中在末游一家（实际 seats=${JSON.stringify(holders)}）`);
    if (holders.length) assert.equal(holders[0], m.lastFinish[3], `level=${lvl} 余牌在末游座`);
    assert.ok(m.totalHands >= 1, `level=${lvl} 至少 1 副`);
  }
});

test('全档确定性：同 seed 同档 → 整场 log 逐条一致（抽 2/4 档）', () => {
  for (const lvl of [2, 4]) {
    const a = simMatch(4242, lvl);
    const b = simMatch(4242, lvl);
    assert.deepEqual(a.log, b.log, `level=${lvl} 重放 log 逐条一致`);
    assert.equal(a.winnerTeam, b.winnerTeam, `level=${lvl} 重放胜方一致`);
    assert.equal(a.totalHands, b.totalHands, `level=${lvl} 重放副数一致`);
  }
});

test('普通档（0）绝不用炸：整场 log 无任何 power≥2 的出牌', () => {
  const m = simMatch(555, 0);
  const bombPlays = m.log.filter(e => e.type === 'play' && e.combo.power >= 2);
  assert.equal(bombPlays.length, 0, `普通档全场用了 ${bombPlays.length} 次炸`);
});

// ── 行为钉：构造对局状态，验证各档在关键局面的取舍 ──

function fresh(handLevel = 2) {
  const m = createMatch(11, -1);
  m.leaderCombo = null; m.trickOwner = 0; m.turnSeat = 0;
  m.passed = []; m.finishedOrder = [];
  if (handLevel !== m.handLevel) m.handLevel = handLevel;
  return m;
}

test('地域/绝望喂牌：搭档只剩 K 单张 → 领出喂单（3 域）；绝望领出本圈烧牌最大（对子）', () => {
  const m = fresh();
  m.hands[0] = [c('S', 5, 900), c('H', 5, 901), c('H', 3, 902), c('C', 4, 903)];
  m.hands[2] = [c('S', 13, 910)]; // 搭档只剩一张 K
  m.hands[1] = singles(0, 911);
  m.hands[3] = singles(20, 941);

  // 档 3（地域）：喂搭档——领出比 K 小的最小单张（3♥）
  const l3 = choose(m, 0, 3);
  assert.equal(l3.pass, undefined, '地域档领出不 pass');
  assert.deepEqual(l3.cards.map(x => [x.s, x.v]), [['H', 3]], `地域档喂单 3♥，实际=${JSON.stringify(l3.cards)}`);

  // 档 4（绝望）：领出本圈烧牌最大化——对子 5（2 张 + 两家压不动各 +1）优于喂单 3（3 分）
  const l4 = choose(m, 0, 4);
  const rc = recognize(l4.cards, m.handLevel);
  assert.equal(rc.type, TYPE.PAIR, `绝望档领对子烧牌，实际=${JSON.stringify(l4.cards)}`);
  assert.equal(rc.main, 3, '对 5');
});

test('4 炸抢权分歧：只有 4 炸可压 K 单张、对手 10 张远收尾 → 普通/进阶/绝望 不抢，高阶/地域 抢 4 炸', () => {
  const m = fresh();
  m.hands[0] = [c('S', 5, 950), c('H', 5, 951), c('D', 5, 952), c('C', 5, 953), c('S', 6, 954), c('H', 6, 955)];
  m.hands[2] = singles(0, 956);
  m.hands[1] = singles(20, 986);
  m.hands[3] = singles(40, 1016);
  m.leaderCombo = recognize([c('C', 13, 960)], m.handLevel); // 对手 K 单张在压
  m.trickOwner = 1; m.turnSeat = 0;

  const b4 = (lvl) => { const d = choose(m, 0, lvl); return d.pass ? 'pass' : (recognize(d.cards, m.handLevel).power >= 2 ? 'bomb' : 'other'); };
  assert.equal(b4(0), 'pass', '普通不抢炸');
  assert.equal(b4(1), 'pass', '进阶不抢炸');
  assert.equal(b4(2), 'bomb', '高阶抢 4 炸（无廉价同型可压）');
  assert.equal(b4(3), 'bomb', '地域抢 4 炸');
  assert.equal(b4(4), 'pass', '绝望：远收尾时不浪费 4 炸（等近收尾再上）');
});

test('绝望不攥大牌：无 4 炸可抢时，对手压 9 单张 → 高阶保留 A 过牌，绝望直接打 A', () => {
  const m = fresh();
  m.hands[0] = [c('S', 14, 970), c('S', 6, 971), c('H', 7, 972), c('D', 8, 973), c('C', 9, 974)];
  m.hands[2] = singles(0, 975);
  m.hands[1] = singles(20, 1005);
  m.hands[3] = singles(40, 1035);
  m.leaderCombo = recognize([c('C', 9, 961)], m.handLevel); // 9 单张在压
  m.trickOwner = 3; m.turnSeat = 0;

  const d2 = choose(m, 0, 2);
  assert.equal(d2.pass, true, '高阶保留 A（main≥12 且对手>5 张）→ 过');
  const d4 = choose(m, 0, 4);
  assert.equal(d4.pass, undefined, '绝望不攥 A');
  const rc = recognize(d4.cards, m.handLevel);
  assert.equal(rc.type, TYPE.SINGLE);
  assert.equal(rc.main, 12, '绝望直接打 A（main=12）');
});

test('绝望提前上最强炸：对手≤3 张收尾 → 档 4 上最强炸（比高阶的 ≤2 提前一档）', () => {
  const m = fresh();
  m.hands[0] = [c('S', 5, 980), c('H', 5, 981), c('D', 5, 982), c('C', 5, 983), c('S', 6, 984), c('H', 6, 985)];
  m.hands[2] = singles(0, 986).slice(0, 10);
  m.hands[1] = singles(20, 1016).slice(0, 3); // 对手只剩 3 张
  m.hands[3] = singles(40, 1046).slice(0, 10);
  m.leaderCombo = recognize([c('C', 13, 960)], m.handLevel);
  m.trickOwner = 1; m.turnSeat = 0;
  const d4 = choose(m, 0, 4);
  const rc = recognize(d4.cards, m.handLevel);
  assert.ok(rc.power >= 2, '绝望档对手 3 张时上炸（4 炸）');
});

test('性能预算：绝望档（前瞻最重）整场 < 3s（宽松阈值防未来拖垮）', () => {
  const t0 = Date.now();
  const m = simMatch(2026, 4);
  const ms = Date.now() - t0;
  assert.equal(m.matchOver, true);
  assert.ok(ms < 3000, `绝望档整场 ${ms}ms 超预算`);
  const t2 = Date.now();
  simMatch(2026, 2);
  assert.ok(Date.now() - t2 < 1500, '高阶档整场预算');
});

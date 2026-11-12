import { test } from 'node:test';
import assert from 'node:assert';
import {
  createSession, startNextHand, raiseOptions, legalActions
} from '../src/cards/holdem.js';

// v1.32 德州 加注档位建议（掼蛋信息密度参照）：raiseOptions 的 ladder 金额必在合法区间、非递减、去重

test('raiseOptions：可加注时 ladder 金额∈[min,max] + 非递减 + 去重；toCall 与 legalActions 一致', () => {
  for (const seed of [1, 5, 42, 99]) {
    const se = createSession(seed, { totalHands: 3, rebuyLimit: 3 });
    startNextHand(se);
    const t = se.table;
    const s = t.hand.toAct;
    const ro = raiseOptions(t, s);
    const la = legalActions(t, s);
    assert.ok(ro, `seed=${seed} 当前行动座有返回`);
    assert.equal(ro.toCall, la.toCall, 'toCall 一致');
    if (ro.canRaise) {
      assert.equal(ro.minRaise, la.minRaiseTo);
      assert.equal(ro.maxRaise, la.raiseMax);
      for (const o of ro.ladder) {
        assert.ok(o.amount >= ro.minRaise && o.amount <= ro.maxRaise, `seed=${seed} 档位「${o.label}=${o.amount}」在合法区间`);
      }
      for (let i = 1; i < ro.ladder.length; i++) {
        assert.ok(ro.ladder[i].amount >= ro.ladder[i - 1].amount, '档位金额非递减');
      }
      const amts = ro.ladder.map((o) => o.amount);
      assert.equal(new Set(amts).size, amts.length, '档位去重');
    } else {
      assert.deepEqual(ro.ladder, [], '不可加注 → 空档位');
    }
  }
});

test('raiseOptions：非当前行动座 → null（legalActions 门控）', () => {
  const se = createSession(7, { totalHands: 3, rebuyLimit: 3 });
  startNextHand(se);
  const t = se.table;
  const other = (t.hand.toAct + 1) % 4;
  if (other !== t.hand.toAct) assert.equal(raiseOptions(t, other), null, '非 toAct 座无档位');
});

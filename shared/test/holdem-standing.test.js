import { test } from 'node:test';
import assert from 'node:assert';
import {
  createSession, startNextHand, autoPlayMatch, matchStanding
} from '../src/cards/holdem.js';

// v1.36 德州 整场态势（掼蛋"级牌进度/打级方"等价）：matchStanding 的关系不变量

test('matchStanding：无 table=null', () => {
  assert.equal(matchStanding(null), null);
});

test('matchStanding：进行中 leader=argmax(stacks)、progress=手数/总手、leaderGap=领跑-次高', () => {
  const se = createSession(5, { totalHands: 10, rebuyLimit: 3 });
  startNextHand(se);
  const s = matchStanding(se);
  const st = se.table.stacks;
  let mx = 0; for (let i = 1; i < st.length; i++) if (st[i] > st[mx]) mx = i;
  assert.equal(s.leader, mx, 'leader=argmax(stacks)');
  assert.equal(s.progress, se.handNo / se.totalHands, 'progress=手数/总手');
  const gap = st[s.leader] - Math.max(...st.filter((_, i) => i !== s.leader));
  assert.equal(s.leaderGap, gap, 'leaderGap=领跑-次高');
  assert.equal(s.over, false, '进行中 over=false');
});

test('matchStanding：整场打完 → over + progress=1 + champ 合法（或全灭）', () => {
  const se = createSession(3, { totalHands: 4, rebuyLimit: 3 });
  autoPlayMatch(se, 1);
  const s = matchStanding(se);
  assert.equal(s.over, true);
  assert.equal(s.progress, 1, '打满后 progress=1');
  assert.ok(s.champ >= 0 && s.champ <= 3, 'champ 合法座');
  assert.equal(typeof s.allOut, 'boolean', 'allOut 为布尔');
});

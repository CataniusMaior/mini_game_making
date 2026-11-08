'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/game.js');
const Bot = require('../tools/bot.js');
const D = G.D;

const at = (s, r, c) => s.cells[G.idx(s, r, c)];
const find = (s, id) => {
  for (let i = 0; i < s.cells.length; i++) if (s.cells[i] && s.cells[i].id === id) return G.rc(s, i);
  return null;
};

test('初期状態：電力・酸素・収容力・作業回数が整っている', () => {
  const s = G.newGame(1);
  const F = G.computeFlows(s);
  assert.equal(s.status, 'playing');
  assert.ok(F.powerGen >= F.powerDemand, '初期配置で電力が足りている');
  assert.equal(F.cap, 150, '居住区5つ×30人');
  for (const m of F.mods) {
    assert.equal(m.status, 'active', m.def.name + ' が稼働している');
    if (m.def.kind === 'hab') assert.ok(F.o2[m.i] > 0, '居住区に酸素が届いている');
  }
  assert.equal(s.ap, D.RULES.baseAp);
  assert.ok(F.speed > 0);
  assert.ok(F.foodProd > F.foodCons, '初期は食料が黒字');
  assert.equal(s.route[s.route.length - 1].type, 'goal');
  const total = s.route.reduce((a, r) => a + r.len, 0);
  assert.equal(total, D.RULES.totalDistance, '航路の合計距離が目的地までの距離と一致');
});

test('配置ルール：推進器は船尾、集光パネルは外縁にしか置けない', () => {
  const s = G.newGame(2);
  s.mat = 999;
  // (2,4) は内部マス
  assert.equal(at(s, 2, 4), null);
  assert.equal(G.canBuild(s, 2, 4, 'engine').ok, false);
  assert.equal(G.canBuild(s, 2, 4, 'solar').ok, false);
  assert.equal(G.canBuild(s, 2, 4, 'hab').ok, true);
  // (5,1) は船尾かつ外縁
  assert.equal(G.canBuild(s, 5, 1, 'engine').ok, true);
  assert.equal(G.canBuild(s, 5, 1, 'solar').ok, true);
  // 研究前のモジュールは建造できない
  assert.match(G.canBuild(s, 2, 4, 'medbay').reason, /研究/);
  // 船外には建造できない
  assert.equal(G.canBuild(s, 0, 0, 'hab').ok, false);
});

test('建造は作業回数と資材を消費し、指定ターン後に完成する', () => {
  const s = G.newGame(3);
  const mat0 = s.mat;
  assert.ok(G.build(s, 2, 4, 'hab').ok);
  assert.equal(s.mat, mat0 - D.MODULES.hab.cost);
  assert.equal(s.ap, D.RULES.baseAp - 1);
  assert.equal(at(s, 2, 4).build, D.MODULES.hab.build);
  assert.equal(G.computeFlows(s).info[G.idx(s, 2, 4)].status, 'building');
  for (let k = 0; k < D.MODULES.hab.build; k++) { if (s.pendingEvent) G.resolveEvent(s, 2 % s.pendingEvent.choices.length); G.endTurn(s); }
  assert.equal(at(s, 2, 4).build, 0);
  // 作業回数が尽きると建造できない
  s.ap = 0;
  assert.match(G.canBuild(s, 4, 4, 'hab').reason, /作業回数/);
});

test('外殻拡張：推進器の噴射口を塞ぐ拡張はできない', () => {
  const s = G.newGame(4);
  s.mat = 999;
  // (2,1) に推進器があるので (2,0) は拡張不可
  assert.equal(at(s, 2, 1).id, 'engine');
  assert.match(G.canExpand(s, 2, 0).reason, /噴射口/);
  // (5,0) は拡張できる
  assert.equal(G.canExpand(s, 5, 0).ok, true);
  assert.ok(G.expand(s, 5, 0).ok);
  assert.equal(s.hull[G.idx(s, 5, 0)], true);
  // 船体に隣接していないマスは拡張不可
  assert.match(G.canExpand(s, 0, 6).reason, /隣接/);
  // 船体工学でコスト半減
  assert.equal(G.expandCost(s), D.RULES.expandCost);
  s.researched.hulltech = true;
  assert.equal(G.expandCost(s), D.RULES.expandCost / 2);
});

test('電力不足では優先度の低い区画から止まり、生命維持装置は動き続ける', () => {
  const s = G.newGame(5);
  const [rr, rc] = find(s, 'reactor');
  s.cells[G.idx(s, rr, rc)] = null; // 炉を失う
  let F = G.computeFlows(s);
  assert.ok(F.powerDemand > F.powerGen);
  assert.ok(F.mods.some(m => m.id === 'engine' && !m.powered), '推進器の一部が止まる');
  // さらに集光パネルも1つ失うと研究ラボまで止まる
  const [sr, sc] = find(s, 'solar');
  s.cells[G.idx(s, sr, sc)] = null;
  F = G.computeFlows(s);
  const lab = F.mods.find(m => m.id === 'lab');
  assert.equal(lab.powered, false, '研究ラボは止まる');
  for (const m of F.mods.filter(m => m.id === 'life')) assert.equal(m.powered, true, '生命維持は最優先');
  for (const m of F.mods.filter(m => m.id === 'farm')) assert.equal(m.powered, true, '農場は研究より優先');
});

test('人手は優先度順に割り当てられ、農場が研究ラボより先に埋まる', () => {
  const s = G.newGame(6);
  // 必要人手 81 に対して人口を 60 に減らす
  s.pop = 60;
  const F = G.computeFlows(s);
  const farm = F.mods.find(m => m.id === 'farm');
  const lab = F.mods.find(m => m.id === 'lab');
  const life = F.mods.find(m => m.id === 'life');
  assert.equal(life.staff, 1);
  assert.equal(farm.staff, 1);
  assert.ok(lab.staff < 1, '研究ラボは人手不足');
});

test('燃料は炉に優先して回る', () => {
  const s = G.newGame(7);
  s.fuel = 0.5; // 炉の必要量（0.5）ちょうど
  const F = G.computeFlows(s);
  assert.equal(F.reactorFuelRatio, 1);
  assert.equal(F.engineFuelRatio, 0);
  assert.equal(F.thrust, 0);
  assert.ok(F.speed > 0, '推力がなくても慣性で少し進む');
});

test('停泊モードでは進まず、ドローンの採取が2倍になる', () => {
  const s = G.newGame(8);
  assert.ok(G.build(s, 1, 3, 'drone').ok);
  s.cells[G.idx(s, 1, 3)].build = 0;
  const cruise = G.computeFlows(s);
  G.setMode(s, 'hold');
  const hold = G.computeFlows(s);
  assert.equal(hold.speed, 0);
  assert.ok(Math.abs(hold.matProd - cruise.matProd * 2) < 1e-9);
});

test('隣接ボーナス：農場は生命維持装置の隣で増産、推進器は炉の隣で推力増', () => {
  const s = G.newGame(9);
  const F = G.computeFlows(s);
  const farm = F.mods.find(m => m.id === 'farm');
  assert.equal(farm.out, D.MODULES.farm.food + 2);
  const eng = F.mods.find(m => m.id === 'engine');
  assert.ok(Math.abs(eng.out - D.MODULES.engine.thrust * 1.2) < 1e-9);
});

test('同じシードと操作なら結果が一致する（決定的）', () => {
  const run = () => {
    const s = G.newGame(1234);
    for (let t = 0; t < 30; t++) {
      if (s.pendingEvent) G.resolveEvent(s, 0);
      Bot.smartTurn(s);
      G.endTurn(s);
    }
    return G.serialize(s);
  };
  assert.equal(run(), run());
});

test('セーブとロード：途中から再開しても同じ結果になる', () => {
  const a = G.newGame(99);
  for (let t = 0; t < 10; t++) { if (a.pendingEvent) G.resolveEvent(a, 0); Bot.smartTurn(a); G.endTurn(a); }
  const b = G.deserialize(G.serialize(a));
  for (let t = 0; t < 15; t++) {
    for (const s of [a, b]) { if (s.pendingEvent) G.resolveEvent(s, 0); Bot.smartTurn(s); G.endTurn(s); }
  }
  assert.equal(G.serialize(a), G.serialize(b));
  assert.throws(() => G.deserialize('{"version":999}'));
});

test('選択イベント中はターンを進められず、選ぶと解除される', () => {
  let s = null;
  for (let seed = 1; seed < 400 && !s; seed++) {
    const t = G.newGame(seed);
    for (let k = 0; k < 40; k++) { Bot.smartTurn(t); G.endTurn(t); if (t.pendingEvent) { s = t; break; } }
  }
  assert.ok(s, '選択イベントが発生するシードがある');
  const turn = s.turn;
  assert.equal(G.endTurn(s).ok, false);
  assert.equal(G.canBuild(s, 2, 4, 'hab').ok, false);
  assert.ok(G.resolveEvent(s, 0).ok);
  assert.equal(s.pendingEvent, null);
  assert.equal(G.endTurn(s).ok, true);
  assert.equal(s.turn, turn + 1);
});

test('バランス：簡易ボットは大半の航海で到着し、何もしなければ到着できない', () => {
  let won = 0;
  const N = 20;
  for (let k = 0; k < N; k++) if (Bot.play(500 + k * 101, 'smart').status === 'won') won++;
  assert.ok(won >= N * 0.7, '簡易ボットの到着率 ' + won + '/' + N);
  for (let k = 0; k < 5; k++) assert.notEqual(Bot.play(900 + k, 'idle').status, 'won');
});

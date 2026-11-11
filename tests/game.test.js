'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/game.js');
const Bot = require('../tools/bot.js');
const D = G.D;
const R = D.RULES;

const at = (s, r, c) => s.cells[G.idx(s, r, c)];
const done = id => ({ id, age: 0, broken: false, build: 0, overhaul: 0, enabled: true });
const put = (s, r, c, id) => { s.cells[G.idx(s, r, c)] = done(id); };
const blockAt = (F, s, r, c) => F.blocks.find(b => b.i === G.idx(s, r, c));
// 範囲供給の計算だけを見たいテスト用に、艦橋も含めて何もない船を作る
function emptyShip(seed) {
  const s = G.newGame(seed || 1);
  s.cells = s.cells.map(() => null);
  s.researched = {};
  return s;
}

test('初期状態：施設はすべて稼働し、人口は住める人数に収まっている', () => {
  for (const diff of ['easy', 'normal', 'hard']) {
    const s = G.newGame(1, diff);
    const F = G.computeFlows(s);
    assert.equal(s.status, 'playing');
    for (const m of F.mods) assert.equal(m.eff, 1, diff + ': ' + m.def.name + ' が100%で稼働');
    assert.ok(s.pop > 0 && s.pop <= F.support, diff + ': 人口 ' + s.pop + ' ≦ 住める人数 ' + F.support);
    assert.equal(F.overflow, 0);
    assert.equal(s.ap, R.baseAp);
    assert.ok(F.speed > F.waveSpeed, '初期は衝撃波より速い');
    assert.ok(s.wave < 0, '衝撃波は後方から始まる');
    assert.equal(Object.keys(s.researched).length, 1, '技術が1つ受け継がれている');
  }
});

test('航路：区間が目的地までをすき間なく覆い、寄港地は区間の境目にある', () => {
  const s = G.newGame(7);
  const { legs, ports } = s.route;
  assert.equal(legs[0].start, 0);
  for (let k = 1; k < legs.length; k++) assert.equal(legs[k].start, legs[k - 1].start + legs[k - 1].len);
  const last = legs[legs.length - 1];
  assert.equal(last.start + last.len, R.totalDistance);
  assert.equal(ports.length, legs.length - 1);
  ports.forEach((p, k) => assert.equal(p.pos, legs[k + 1].start));
  assert.ok(ports.length >= 6);
});

test('範囲供給：隣は100%、2マス先は50%、範囲外は0', () => {
  const s = emptyShip();
  put(s, 1, 1, 'life');    // 空気10・範囲2
  put(s, 2, 1, 'reactor'); // 生命維持装置に電力を届ける
  const F = G.computeFlows(s);
  const air = (r, c) => F.fields.air[G.idx(s, r, c)];
  assert.equal(air(1, 2), 10);
  assert.equal(air(2, 2), 10);
  assert.equal(air(1, 3), 5);
  assert.equal(air(3, 3), 5);
  assert.equal(air(1, 4), 0);
  // 電力がなければ止まり、空気も届かない
  s.cells[G.idx(s, 2, 1)] = null;
  assert.equal(G.computeFlows(s).fields.air[G.idx(s, 1, 2)], 0);
});

test('居住ブロックの住める人数は、空気と食料の少ないほうで決まる', () => {
  const s = emptyShip();
  put(s, 1, 1, 'life');
  put(s, 1, 3, 'farm');
  put(s, 2, 2, 'reactor');
  s.pop = 0;
  const F = G.computeFlows(s);
  const b = blockAt(F, s, 1, 2); // 空気10（25人分）・食料8（16人分）
  assert.equal(b.air, 10);
  assert.equal(b.food, 8);
  assert.equal(b.support, 16);
  const far = blockAt(F, s, 1, 5); // 食料4（8人分）・空気0
  assert.equal(far.support, 0);
});

test('電力：必要量以上で100%、半分以上で50%、それ未満は停止', () => {
  const s = emptyShip();
  put(s, 1, 1, 'solar'); // 電力10・範囲1
  put(s, 1, 2, 'lab');   // 必要15 → 10は半分以上
  put(s, 2, 1, 'shop');  // 必要8 → 10で100%
  put(s, 1, 4, 'lounge'); // 電力が届かない
  const F = G.computeFlows(s);
  assert.equal(F.info[G.idx(s, 1, 2)].eff, 0.5);
  assert.equal(F.info[G.idx(s, 2, 1)].eff, 1);
  assert.equal(F.info[G.idx(s, 1, 4)].eff, 0);
});

test('配電ノード：範囲内では電力が弱まらず、1マス遠くまで届く', () => {
  const s = emptyShip();
  put(s, 1, 1, 'reactor'); // 電力30・範囲2
  const p0 = G.computeFlows(s).fields.power;
  assert.equal(p0[G.idx(s, 1, 3)], 15);
  assert.equal(p0[G.idx(s, 1, 4)], 0);
  put(s, 2, 4, 'relay');
  const p1 = G.computeFlows(s).fields.power;
  assert.equal(p1[G.idx(s, 1, 3)], 30, '2マス先でも100%');
  assert.equal(p1[G.idx(s, 1, 4)], 30 * D.RELAY_FALLOFF[3], '3マス先にも届く');
});

test('建造：居住ブロックがなくなり、プレビューと実際の変化が一致する', () => {
  const s = G.newGame(3);
  const F0 = G.computeFlows(s);
  const target = F0.blocks.find(b => b.support > 0 && G.canBuild(s, b.r, b.c, 'lounge').ok);
  const p = G.previewBuild(s, target.r, target.c, 'lounge');
  assert.ok(p.ok);
  assert.ok(p.support <= -target.support + 1e-9 || p.support < 0, '住める人数が減る');
  assert.ok(G.build(s, target.r, target.c, 'lounge').ok);
  assert.equal(at(s, target.r, target.c).build, D.MODULES.lounge.build);
  assert.equal(s.ap, R.baseAp - 1);
  // 建造中のマスは居住ブロックではない
  assert.equal(blockAt(G.computeFlows(s), s, target.r, target.c), undefined);
});

test('配置ルール：推進器は船尾、集光パネルは外縁。噴射口を塞ぐ拡張はできない', () => {
  const s = G.newGame(4);
  s.mat = 999;
  assert.equal(G.canBuild(s, 2, 4, 'engine').ok, false);
  assert.equal(G.canBuild(s, 2, 4, 'solar').ok, false);
  assert.equal(G.canBuild(s, 3, 1, 'engine').ok, true);  // 船尾の空きブロック
  assert.equal(at(s, 2, 1).id, 'engine');
  assert.match(G.canExpand(s, 2, 0).reason, /噴射口/);
  assert.equal(G.canExpand(s, 3, 0).ok, true);
  assert.match(G.canBuild(s, 2, 4, 'fusion').reason, /研究/);
  assert.equal(G.canDemolish(s, 3, 3).ok, false, '艦橋は撤去できない');
});

test('推力増幅器：隣の推進器の推力+50%、燃料も増える', () => {
  const s = G.newGame(5);
  const F0 = G.computeFlows(s);
  put(s, 3, 1, 'booster'); // 推進器(2,1)と(4,1)の間
  const F1 = G.computeFlows(s);
  assert.ok(Math.abs(F1.thrust - F0.thrust * 1.5) < 1e-9, '推力1.5倍');
  assert.ok(Math.abs(F1.fuelUse - (F0.fuelUse + 2 * 1.5)) < 1e-9, '増幅する推進器2基ぶんの燃料');
});

test('老朽化：寿命の6割を過ぎると壊れやすくなり、修理では戻らず、改修で新品に戻る', () => {
  const s = G.newGame(6);
  s.mat = 999;
  const cell = at(s, 2, 3); // 生命維持装置
  const L = G.lifespan(s, 'life');
  cell.age = L * 0.3;
  const young = G.breakChance(s, cell);
  cell.age = L * 0.9;
  const old = G.breakChance(s, cell);
  assert.ok(young < 0.01 && old > 0.15, '若いと壊れにくく、古いと壊れやすい');
  cell.broken = true;
  assert.ok(G.repair(s, 2, 3).ok);
  assert.equal(cell.broken, false);
  assert.equal(cell.age, L * 0.9, '修理しても老朽化はそのまま');
  assert.ok(G.overhaul(s, 2, 3).ok);
  assert.equal(G.computeFlows(s).info[G.idx(s, 2, 3)].status, 'overhaul', '改修中は止まる');
  for (let k = 0; k < G.overhaulTurns(s); k++) { if (s.pendingEvent) G.resolveEvent(s, s.pendingEvent.choices.length - 1); G.endTurn(s); }
  assert.equal(cell.overhaul, 0);
  assert.ok(cell.age <= 1, '改修後は新品同様');
});

test('寄港：寄港地で止まり、降下艇が資源を採り、出発すると訪問済みになる', () => {
  const s = G.newGame(8);
  const port = s.route.ports[0];
  s.dist = port.pos - 1;
  G.endTurn(s);
  if (s.pendingEvent) G.resolveEvent(s, s.pendingEvent.choices.length - 1);
  assert.equal(s.portIndex, 0);
  assert.equal(s.mode, 'orbit');
  assert.equal(s.dist, port.pos, '寄港地で止まる');
  const F = G.computeFlows(s);
  assert.equal(F.speed, 0);
  assert.ok(F.harvest.mat > 0 || F.harvest.fuel > 0, '降下艇が採取する');
  const before = port.mat + port.fuel;
  G.endTurn(s);
  if (s.pendingEvent) G.resolveEvent(s, s.pendingEvent.choices.length - 1);
  assert.ok(port.mat + port.fuel < before, '埋蔵量が減る');
  if (s.portIndex === 0) assert.ok(G.setMode(s, 'cruise').ok);
  assert.equal(port.visited, true);
  assert.equal(s.portIndex, -1);
  assert.equal(G.setMode(s, 'orbit').ok, false, '寄港地以外では停泊できない');
});

test('寄港地に寄らない設定にすると通過する', () => {
  const s = G.newGame(9);
  const port = s.route.ports[0];
  assert.ok(G.setSkipNext(s, true).ok);
  s.dist = port.pos - 1;
  G.endTurn(s);
  assert.equal(s.portIndex, -1);
  assert.ok(s.dist > port.pos);
  assert.equal(port.visited, true);
});

test('衝撃波：追いつかれると施設が壊れ、人が失われる', () => {
  const s = G.newGame(10);
  s.wave = s.dist - 1;
  const pop0 = s.pop;
  G.setMode(s, 'cruise');
  // 動けないようにする
  for (const c of s.cells) if (c && D.MODULES[c.id].kind === 'engine') c.enabled = false;
  G.endTurn(s);
  assert.ok(s.wave >= s.dist);
  assert.ok(s.pop < pop0, '人が失われる');
  assert.ok(s.log.some(l => /衝撃波に呑まれた/.test(l.text)));
});

test('同じシード・同じ操作なら結果が一致する（決定的）', () => {
  const run = () => {
    const s = G.newGame(1234, 'normal');
    for (let t = 0; t < 40; t++) {
      if (s.pendingEvent) G.resolveEvent(s, 0);
      Bot.smartTurn(s);
      G.endTurn(s);
    }
    return G.serialize(s);
  };
  assert.equal(run(), run());
});

test('セーブとロード：途中から再開しても同じ結果になる', () => {
  const a = G.newGame(99, 'hard');
  for (let t = 0; t < 10; t++) { if (a.pendingEvent) G.resolveEvent(a, 0); Bot.smartTurn(a); G.endTurn(a); }
  const b = G.deserialize(G.serialize(a));
  for (let t = 0; t < 20; t++) {
    for (const s of [a, b]) { if (s.pendingEvent) G.resolveEvent(s, 0); Bot.smartTurn(s); G.endTurn(s); }
  }
  assert.equal(G.serialize(a), G.serialize(b));
  assert.throws(() => G.deserialize('{"version":1}'));
});

test('選択イベント中はターンを進められず、選ぶと解除される', () => {
  let s = null;
  for (let seed = 1; seed < 400 && !s; seed++) {
    const t = G.newGame(seed);
    for (let k = 0; k < 40; k++) { Bot.smartTurn(t); G.endTurn(t); if (t.pendingEvent) { s = t; break; } if (t.status !== 'playing') break; }
  }
  assert.ok(s, '選択イベントが発生するシードがある');
  const turn = s.turn;
  assert.equal(G.endTurn(s).ok, false);
  assert.equal(G.canResearch(s, 'scanner').ok, false);
  assert.ok(G.resolveEvent(s, s.pendingEvent.choices.length - 1).ok);
  assert.equal(s.pendingEvent, null);
  if (s.status === 'playing') {
    assert.equal(G.endTurn(s).ok, true);
    assert.equal(s.turn, turn + 1);
  }
});

test('バランス：難易度が上がるほど到着しにくく、何もしなければ到着できない', () => {
  const rate = diff => {
    let won = 0;
    for (let k = 0; k < 16; k++) if (Bot.play(500 + k * 101, 'smart', diff).status === 'won') won++;
    return won;
  };
  const easy = rate('easy'), normal = rate('normal'), hard = rate('hard');
  assert.ok(easy >= 9, 'やさしい：簡易ボットの到着 ' + easy + '/16');
  assert.ok(normal >= 3 && normal <= easy, 'ふつう：簡易ボットの到着 ' + normal + '/16');
  assert.ok(hard <= normal, 'むずかしい：簡易ボットの到着 ' + hard + '/16');
  for (let k = 0; k < 4; k++) assert.notEqual(Bot.play(900 + k, 'idle', 'easy').status, 'won');
});

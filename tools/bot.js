/*
 * バランス確認用の簡易ボット。
 *   node tools/bot.js [試行回数] [strategy]
 * strategy: smart（既定）| idle（何もしない）
 */
'use strict';
const G = require('../js/game.js');
const D = G.D;

function cellsWhere(s, pred) {
  const out = [];
  for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) if (pred(r, c)) out.push([r, c]);
  return out;
}

function tryBuild(s, id, scoreFn) {
  if (!G.isUnlocked(s, id)) return false;
  const def = D.MODULES[id];
  // 船尾マスは推進器専用として確保する
  const cands = cellsWhere(s, (r, c) => G.canBuild(s, r, c, id).ok && (def.place === 'rear' || !G.isRear(s, s.hull, r, c)));
  if (!cands.length) return false;
  // 船尾マスは推進器用、外縁マスは外縁専用モジュール用に空けておく
  const reserve = (r, c) => {
    let v = 0;
    if (def.place !== 'rear' && G.isRear(s, s.hull, r, c)) v -= 6;
    if (def.place === 'any' && G.isEdge(s, s.hull, r, c)) v -= 1;
    return v;
  };
  let best = cands[0], bs = -Infinity;
  for (const p of cands) { const v = (scoreFn ? scoreFn(p[0], p[1]) : 0) + reserve(p[0], p[1]); if (v > bs) { bs = v; best = p; } }
  return G.build(s, best[0], best[1], id).ok;
}

function count(s, id, includeBuilding = true) {
  return s.cells.filter(c => c && c.id === id && (includeBuilding || c.build === 0)).length;
}

function smartTurn(s) {
  // 研究
  const order = ['scanner', 'medicine', 'hulltech', 'genecrops', 'shielding', 'nanobots', 'iondrive', 'automation', 'biodome', 'arcology', 'fusion'];
  for (const id of order) if (G.canResearch(s, id).ok) G.research(s, id);

  let F = G.computeFlows(s);
  // 修理（壊れたもの・耐久の低いもの）
  const prio = { life: 5, bio: 5, reactor: 4, fusion: 4, hab: 3, farm: 3, engine: 3, ion: 3 };
  const broken = [];
  s.cells.forEach((c, i) => { if (c && c.build === 0 && (c.broken || c.cond < 50)) broken.push(i); });
  const urgency = i => (s.cells[i].broken ? 100 : 0) + (50 - s.cells[i].cond) + (prio[s.cells[i].id] || 1) * 5;
  broken.sort((a, b) => urgency(b) - urgency(a));
  for (const i of broken) {
    if (s.ap < 1) break;
    const [r, c] = G.rc(s, i);
    if (G.canRepair(s, r, c).ok) G.repair(s, r, c);
  }
  if (s.ap < 1) return;
  F = G.computeFlows(s);

  const nb = (r, c, pred) => [[-1, 0], [1, 0], [0, -1], [0, 1]].reduce((a, [dr, dc]) => {
    const rr = r + dr, cc = c + dc;
    if (!G.inGrid(s, rr, cc)) return a;
    const x = s.cells[G.idx(s, rr, cc)];
    return a + (x && pred(x) ? 1 : 0);
  }, 0);
  const isHab = x => D.MODULES[x.id].kind === 'hab';
  const isHot = x => D.MODULES[x.id].heat;
  const habScore = (r, c) => F.o2[G.idx(s, r, c)] * 2 - nb(r, c, isHot) * 10;
  const nearLife = (r, c) => nb(r, c, x => x.id === 'life' || x.id === 'bio') - nb(r, c, isHab) * 0;
  const reactorScore = (r, c) => nb(r, c, x => D.MODULES[x.id].kind === 'engine') * 3 - nb(r, c, isHab) * 10;
  const engineScore = (r, c) => nb(r, c, x => D.MODULES[x.id].kind === 'reactor') * 3;

  const fuelNet = F.refOut + F.scoopOut - F.fuelUse;
  const nEng = count(s, 'engine') + count(s, 'ion');
  const wants = [];
  // 生存優先：電力・食料・燃料
  if (F.powerGen < F.powerDemand + 2) wants.push(['solar', null], ['reactor', reactorScore]);
  if (F.foodProd - F.foodCons < 3) wants.push(['farm', nearLife]);
  if (count(s, 'drone') < 2 || (count(s, 'drone') <= count(s, 'refinery') && s.mat < 150)) wants.push(['drone', null]);
  if ((fuelNet < 1 || s.fuel < 120) && count(s, 'refinery') < 4) wants.push(['refinery', null]);
  if (F.cap - s.pop < 15 && F.foodProd - F.foodCons > 2) wants.push(['hab', habScore]);
  if (F.workersReq > s.pop * 0.9) wants.push(['hab', habScore]);
  if (count(s, 'shop') < 1) wants.push(['shop', null]);
  // 推進
  if (s.mat > 110 && nEng < 6 && (fuelNet - 1.5 >= -0.5 || s.fuel > 260)) wants.push([G.isUnlocked(s, 'ion') ? 'ion' : 'engine', engineScore]);
  if (s.morale < 55 && count(s, 'lounge') < 2) wants.push(['lounge', null]);
  if (G.isUnlocked(s, 'medbay') && count(s, 'medbay') < 1) wants.push(['medbay', null]);
  if (count(s, 'lab') < 2) wants.push(['lab', null]);
  if (count(s, 'storage') < 2 && s.mat > 250) wants.push(['storage', null]);
  if (G.isUnlocked(s, 'shield') && count(s, 'shield') < 1 && s.mat > 120) wants.push(['shield', null]);

  for (const [id, fn] of wants) {
    if (s.ap < 1) break;
    tryBuild(s, id, fn);
  }
  // 拡張（船尾を増やして推進器の場所を作る）
  if (s.ap >= 1 && s.mat > 140) {
    const cands = cellsWhere(s, (r, c) => G.canExpand(s, r, c).ok);
    cands.sort((a, b) => a[1] - b[1]);
    if (cands.length) G.expand(s, cands[0][0], cands[0][1]);
  }

  // モード
  F = G.computeFlows(s);
  const sec = G.currentSector(s).type;
  if (sec === 'asteroid' && s.mat < 120 && count(s, 'drone', false) >= 2) G.setMode(s, 'hold');
  else if (s.fuel > 200 && F.refOut + F.scoopOut > 0) G.setMode(s, 'full');
  else G.setMode(s, 'cruise');
}

function play(seed, strategy) {
  const s = G.newGame(seed);
  let guard = 0;
  while (s.status === 'playing' && guard++ < 1000) {
    if (s.pendingEvent) { G.resolveEvent(s, 0); continue; }
    if (strategy === 'smart') smartTurn(s);
    G.endTurn(s);
  }
  return s;
}

function main() {
  const n = parseInt(process.argv[2] || '40', 10);
  const strategy = process.argv[3] || 'smart';
  const res = [];
  for (let k = 0; k < n; k++) {
    const s = play(1000 + k * 7919, strategy);
    res.push({ status: s.status, turn: s.turn, pop: s.pop, morale: Math.round(s.morale), dist: Math.round(s.dist), score: s.score });
  }
  const won = res.filter(r => r.status === 'won');
  const avg = (a, f) => a.length ? (a.reduce((x, y) => x + f(y), 0) / a.length).toFixed(1) : '-';
  console.log('strategy=' + strategy + ' runs=' + n + ' won=' + won.length);
  console.log('勝利時 平均ターン=' + avg(won, r => r.turn) + ' 平均人口=' + avg(won, r => r.pop) + ' 平均スコア=' + avg(won, r => r.score.score));
  const ranks = {}; for (const r of won) ranks[r.score.rank] = (ranks[r.score.rank] || 0) + 1;
  console.log('ランク分布', ranks);
  const lost = res.filter(r => r.status !== 'won');
  if (lost.length) console.log('敗北例', lost.slice(0, 5));
  if (process.env.VERBOSE) console.log(res);
}

if (require.main === module) main();
module.exports = { play, smartTurn };

/*
 * バランス確認用の簡易ボット。
 *   node tools/bot.js [試行回数] [strategy] [difficulty]
 * strategy: smart（既定）| idle（何もしない）
 * difficulty: easy | normal（既定）| hard
 */
'use strict';
const G = require('../js/game.js');
const D = G.D;

const RESEARCH_PLAN = ['scanner', 'genecrops', 'medicine', 'maintenance', 'grid', 'repairdrones', 'iondrive',
  'arcology', 'fusion', 'shielding', 'biodome', 'hulltech', 'jumpdrive'];
const REPAIR_PRIO = { life: 6, bio: 6, farm: 5, reactor: 5, fusion: 5, engine: 4, booster: 3, lander: 3, refinery: 3, lab: 2, lounge: 2, shop: 2 };

function count(s, id) { return s.cells.filter(c => c && c.id === id).length; }
function kindCount(s, kind) { return s.cells.filter(c => c && D.MODULES[c.id].kind === kind).length; }

// 建てた場合の価値（大きいほど良い）
function utility(s, F0, F1, i, id, ctx) {
  const m = F1.info[i];
  if (!m || m.eff < 1) return -Infinity;
  const popPressure = s.pop >= F0.support - 4 ? 1 : 0.4;
  let u = 0;
  u += (F1.support - F0.support) * 3 * popPressure;
  u += (F1.rpProd - F0.rpProd) * 6;
  u += (F1.speed - F0.speed) * (ctx.waveUrgent ? 9 : 4);
  u += (F1.moraleTarget - F0.moraleTarget) * (s.morale < 50 ? 4 : 1.5);
  // ほかの施設の稼働を落とす配置は避ける
  for (const o of F0.mods) {
    const o1 = F1.info[o.i];
    if (o1 && o.eff > o1.eff) u -= 30;
  }
  return u - D.MODULES[id].cost * 0.05;
}

function bestPlacement(s, id, ctx, F0) {
  if (!G.isUnlocked(s, id)) return null;
  let best = null;
  for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
    if (!G.canBuild(s, r, c, id).ok) continue;
    const def = D.MODULES[id];
    // 船尾は推進器のために空けておく
    if (def.place !== 'rear' && G.isRear(s, s.hull, r, c) && kindCount(s, 'engine') < 6) continue;
    const i = G.idx(s, r, c);
    const t = G.clone(s);
    t.cells[i] = { id, age: 0, broken: false, build: 0, overhaul: 0, enabled: true };
    const F1 = G.computeFlows(t);
    const u = utility(s, F0, F1, i, id, ctx);
    if (!best || u > best.u) best = { r, c, u };
  }
  return best;
}

function smartTurn(s) {
  for (const id of RESEARCH_PLAN) if (G.canResearch(s, id).ok) G.research(s, id);
  let F = G.computeFlows(s);
  const ctx = { waveUrgent: F.waveEta !== null && F.waveEta < 12 };

  // 修理（故障）→ 改修（寿命の6割を過ぎたもの。寄港中を優先）
  const RESERVE = 60;
  const mods = F.mods.filter(m => !m.def.fixed && m.status !== 'building' && m.status !== 'overhaul');
  const prio = m => (REPAIR_PRIO[m.id] || 1);
  const broken = mods.filter(m => m.cell.broken).sort((a, b) => prio(b) - prio(a));
  for (const m of broken) {
    if (s.ap < 1) break;
    if (G.wearLevel(s, m.cell) > 0.7 && s.mat > G.overhaulCost(s, m.id) + 20 && G.canOverhaul(s, m.r, m.c).ok) G.overhaul(s, m.r, m.c);
    else if (G.canRepair(s, m.r, m.c).ok) G.repair(s, m.r, m.c);
  }
  const wornLimit = s.portIndex >= 0 ? 0.55 : 0.65;
  const worn = mods.filter(m => !m.cell.broken && G.wearLevel(s, m.cell) > wornLimit)
    .sort((a, b) => (G.wearLevel(s, b.cell) * prio(b)) - (G.wearLevel(s, a.cell) * prio(a)));
  let oh = 0;
  for (const m of worn) {
    if (s.ap < 1 || oh >= 2) break;
    if (s.mat > G.overhaulCost(s, m.id) + 20 && G.canOverhaul(s, m.r, m.c).ok) { G.overhaul(s, m.r, m.c); oh++; }
  }
  const canSpend = cost => s.mat - cost >= RESERVE;

  // 必需品
  F = G.computeFlows(s);
  const fuelNet = F.refOut + F.scoopOut - F.fuelUse;
  const needs = [];
  if (kindCount(s, 'lander') < 2) needs.push('lander');
  if (fuelNet < -3 && count(s, 'refinery') < 2 && s.turn > 6) needs.push('refinery');
  if (count(s, 'shop') < 1 && s.turn > 4) needs.push('shop');
  if (s.mat > F.capMat.mat * 0.85 && count(s, 'storage') < 3) needs.push('storage');
  for (const id of needs) {
    if (s.ap < 1 || !canSpend(D.MODULES[id].cost)) break;
    const F0 = G.computeFlows(s);
    const b = bestPlacement(s, id, ctx, F0);
    // 住む場所を奪いすぎる場所には建てない
    if (b && b.u > -40) G.build(s, b.r, b.c, id);
  }

  // 効果の大きいものを建てる
  const pool = ['farm', 'life', 'lounge', 'lab', 'solar', 'reactor', 'booster', 'medbay', 'bio', 'relay', 'fusion'];
  pool.push(G.isUnlocked(s, 'jump') ? 'jump' : G.isUnlocked(s, 'ion') ? 'ion' : 'engine');
  let guard = 0;
  while (s.ap >= 1 && guard++ < 4) {
    const F0 = G.computeFlows(s);
    let best = null;
    for (const id of pool) {
      if (!canSpend(D.MODULES[id].cost)) continue;
      if (D.MODULES[id].kind === 'engine' && fuelNet < -4 && id !== 'jump') continue;
      const b = bestPlacement(s, id, ctx, F0);
      if (b && b.u > 4 && (!best || b.u > best.u)) best = Object.assign(b, { id });
    }
    if (!best) break;
    G.build(s, best.r, best.c, best.id);
  }

  // 拡張（資材に余裕があれば居住ブロックや船尾を増やす）
  if (s.ap >= 1 && canSpend(G.expandCost(s) + 60)) {
    const F0 = G.computeFlows(s);
    let best = null;
    for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
      if (!G.canExpand(s, r, c).ok) continue;
      const t = G.clone(s);
      t.hull[G.idx(s, r, c)] = true;
      const F1 = G.computeFlows(t);
      const u = (F1.support - F0.support) + (c === 0 ? 2 : 0);
      if (!best || u > best.u) best = { r, c, u };
    }
    if (best && best.u > 0) G.expand(s, best.r, best.c);
  }

  // 航行
  F = G.computeFlows(s);
  const safe = F.gap > F.waveSpeed * 8;
  if (s.portIndex >= 0) {
    const p = G.currentPort(s);
    const yield_ = F.harvest.mat + F.harvest.fuel;
    s.botStay = (s.botStay || 0) + 1;
    if (!safe || yield_ < 10 || s.botStay > 5 || (s.mat > F.capMat.mat * 0.9 && s.fuel > F.capMat.fuel * 0.9)) {
      s.botStay = 0;
      G.setMode(s, s.fuel > 120 && !safe ? 'full' : 'cruise');
    } else if (p) {
      G.setMode(s, 'orbit');
    }
  } else {
    G.setMode(s, (!safe && s.fuel > 80) ? 'full' : 'cruise');
    const k = G.nextPortIndex(s);
    if (k >= 0) G.setSkipNext(s, F.gap < F.waveSpeed * 5);
  }
}

function play(seed, strategy, difficulty) {
  const s = G.newGame(seed, difficulty);
  let guard = 0;
  while (s.status === 'playing' && guard++ < 1000) {
    if (s.pendingEvent) { G.resolveEvent(s, s.pendingEvent.choices.length > 2 ? 1 : 0); continue; }
    if (strategy === 'smart') smartTurn(s);
    else if (s.portIndex >= 0) G.setMode(s, 'cruise'); // 何もしない場合も寄港地では出発だけはする
    G.endTurn(s);
  }
  return s;
}

function main() {
  const n = parseInt(process.argv[2] || '30', 10);
  const strategy = process.argv[3] || 'smart';
  const difficulty = process.argv[4] || 'normal';
  const res = [];
  for (let k = 0; k < n; k++) {
    const s = play(1000 + k * 7919, strategy, difficulty);
    res.push({ status: s.status, turn: s.turn, pop: s.pop, morale: Math.round(s.morale), dist: Math.round(s.dist), score: s.score, reason: s.endReason, ports: s.stats.ports });
  }
  const won = res.filter(r => r.status === 'won');
  const avg = (a, f) => a.length ? (a.reduce((x, y) => x + f(y), 0) / a.length).toFixed(1) : '-';
  console.log('strategy=' + strategy + ' difficulty=' + difficulty + ' runs=' + n + ' won=' + won.length);
  console.log('勝利時 平均ターン=' + avg(won, r => r.turn) + ' 平均人口=' + avg(won, r => r.pop) + ' 平均スコア=' + avg(won, r => r.score.score) + ' 平均寄港=' + avg(won, r => r.ports));
  const ranks = {}; for (const r of won) ranks[r.score.rank] = (ranks[r.score.rank] || 0) + 1;
  console.log('ランク分布', ranks);
  const lost = res.filter(r => r.status !== 'won');
  const reasons = {}; for (const r of lost) reasons[r.reason.slice(0, 14)] = (reasons[r.reason.slice(0, 14)] || 0) + 1;
  if (lost.length) console.log('敗因', reasons, '平均到達距離', avg(lost, r => r.dist), '平均ターン', avg(lost, r => r.turn));
  if (process.env.VERBOSE) console.log(res);
}

if (require.main === module) main();
module.exports = { play, smartTurn };

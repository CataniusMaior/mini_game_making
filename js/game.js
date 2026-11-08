/*
 * DRIFT ARK — ゲームロジック
 * DOM に依存しない純粋なロジック。ブラウザでは window.ArkGame、Node では require で使う。
 * 状態（state）はすべて JSON にできるプレーンなオブジェクトで、乱数の内部状態も含む。
 */
(function (root, factory) {
  const D = (typeof module === 'object' && module.exports) ? require('./data.js') : root.ArkData;
  const api = factory(D);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ArkGame = api;
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';

  const SAVE_VERSION = 1;

  /* ---------- 乱数（mulberry32） ---------- */
  function rand(s) {
    let t = (s.rng = (s.rng + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function randInt(s, lo, hi) { return lo + Math.floor(rand(s) * (hi - lo + 1)); }
  function pick(s, arr) { return arr[Math.floor(rand(s) * arr.length)]; }

  /* ---------- 座標ヘルパー ---------- */
  const idx = (s, r, c) => r * s.cols + c;
  const rc = (s, i) => [Math.floor(i / s.cols), i % s.cols];
  const inGrid = (s, r, c) => r >= 0 && r < s.rows && c >= 0 && c < s.cols;
  const hullAt = (s, hull, r, c) => inGrid(s, r, c) && hull[idx(s, r, c)];
  const DIRS4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  function isEdge(s, hull, r, c) {
    return DIRS4.some(([dr, dc]) => !hullAt(s, hull, r + dr, c + dc));
  }
  function isRear(s, hull, r, c) {
    return !hullAt(s, hull, r, c - 1);
  }
  function placementOk(s, hull, r, c, place) {
    if (place === 'edge') return isEdge(s, hull, r, c);
    if (place === 'rear') return isRear(s, hull, r, c);
    return true;
  }
  function placementLabel(place) {
    if (place === 'edge') return '外縁のみ';
    if (place === 'rear') return '船尾のみ';
    return '';
  }

  /* ---------- 新規ゲーム ---------- */
  function generateRoute(s) {
    const total = D.RULES.totalDistance;
    const route = [];
    // 最初は通常宙域、最後は目的星系。間はランダムだが同じ種類は連続しない。
    const pool = ['normal', 'normal', 'asteroid', 'asteroid', 'nebula', 'star', 'star', 'derelict', 'void'];
    let pos = 0;
    route.push({ type: 'normal', start: 0, len: 140 });
    pos = 140;
    const goalLen = 120;
    let prev = 'normal';
    while (pos < total - goalLen) {
      let type;
      do { type = pick(s, pool); } while (type === prev);
      let len = randInt(s, 120, 230);
      if (pos + len > total - goalLen - 60) len = total - goalLen - pos;
      route.push({ type, start: pos, len });
      pos += len;
      prev = type;
    }
    route.push({ type: 'goal', start: pos, len: total - pos });
    return route;
  }

  function newGame(seed) {
    if (seed === undefined || seed === null) seed = Math.floor(Math.random() * 2147483647);
    const rows = D.ROWS, cols = D.COLS;
    const s = {
      version: SAVE_VERSION,
      seed: seed | 0,
      rng: seed | 0,
      rows, cols,
      turn: 1,
      status: 'playing',
      endReason: '',
      hull: new Array(rows * cols).fill(false),
      cells: new Array(rows * cols).fill(null),
      pop: D.START.pop,
      morale: D.START.morale,
      food: D.START.food,
      fuel: D.START.fuel,
      mat: D.START.mat,
      rp: D.START.rp,
      ap: 0,
      apPenalty: 0,
      mode: 'cruise',
      dist: 0,
      sectorIndex: 0,
      route: [],
      researched: {},
      pendingEvent: null,
      log: [],
      stats: { built: 0, repaired: 0, lost: 0, born: 0, maxPop: D.START.pop },
      warned: {},
      score: null
    };
    const h = D.START.hull;
    for (let r = h.r0; r <= h.r1; r++) for (let c = h.c0; c <= h.c1; c++) s.hull[idx(s, r, c)] = true;
    for (const [r, c, id] of D.START_LAYOUT) s.cells[idx(s, r, c)] = makeCell(id, true);
    s.route = generateRoute(s);
    s.ap = computeFlows(s).apMax;
    addLog(s, '母星の恒星が膨張を始めた。最後の世代船は' + D.RULES.totalDistance.toLocaleString('ja-JP') + '光年先の惑星ヴェルダへ旅立つ。', 'story');
    addLog(s, '船内の区画を整え、乗員を生かしたまま目的地へ導こう。', 'story');
    return s;
  }

  function makeCell(id, done) {
    const def = D.MODULES[id];
    return { id, cond: 100, broken: false, build: done ? 0 : def.build, enabled: true };
  }

  function addLog(s, text, kind) {
    s.log.push({ turn: s.turn, text, kind: kind || 'info' });
    if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
  }

  /* ---------- 参照系 ---------- */
  function currentSector(s) { return s.route[s.sectorIndex]; }
  function sectorDef(s) { return D.SECTORS[currentSector(s).type]; }
  function isUnlocked(s, id) {
    const def = D.MODULES[id];
    return !def.research || !!s.researched[def.research];
  }
  function hullCount(s) { return s.hull.reduce((a, b) => a + (b ? 1 : 0), 0); }
  function expandCost(s) { return s.researched.hulltech ? Math.round(D.RULES.expandCost / 2) : D.RULES.expandCost; }
  function scanRange(s) { return s.researched.scanner ? 4 : 1; }

  /*
   * computeFlows: 現在の状態から、このターンの生産・消費・電力・酸素などを計算する。
   * 乱数を使わないので、UI の予測表示とターン処理の両方で使える。
   */
  function computeFlows(s) {
    const sec = sectorDef(s);
    const mode = D.MODES[s.mode];
    const R = s.researched;
    const n = s.rows * s.cols;
    const info = new Array(n).fill(null);
    const mods = [];

    for (let i = 0; i < n; i++) {
      const cell = s.cells[i];
      if (!cell) continue;
      const def = D.MODULES[cell.id];
      const [r, c] = rc(s, i);
      let status;
      if (cell.build > 0) status = 'building';
      else if (cell.broken) status = 'broken';
      else if (!cell.enabled) status = 'off';
      else if (!placementOk(s, s.hull, r, c, def.place)) status = 'blocked';
      else status = 'active';
      const m = { i, r, c, id: cell.id, def, cell, status, powered: false, eff: 0, gen: 0, out: 0, notes: [] };
      mods.push(m);
      info[i] = m;
    }
    const active = mods.filter(m => m.status === 'active');
    const condEff = m => (m.cell.cond >= 25 ? 1 : 0.6);

    // 人手：優先度の高い区画から順に割り当てる（発電施設は生命維持の次に優先）
    const wMult = R.automation ? 0.6 : 1;
    const crewPrio = m => (m.def.powerGen ? 97 : m.def.priority);
    const crewOrder = active.filter(m => m.def.workers > 0)
      .sort((a, b) => (crewPrio(b) - crewPrio(a)) || (a.i - b.i));
    let workersReq = 0, crewLeft = s.pop;
    for (const m of crewOrder) {
      const need = m.def.workers * wMult;
      workersReq += need;
      const got = Math.max(0, Math.min(need, crewLeft));
      crewLeft -= got;
      m.staff = need > 0 ? got / need : 1;
      if (m.staff < 1) m.notes.push('人手不足');
    }
    for (const m of active) if (m.staff === undefined) m.staff = 1;
    workersReq = Math.round(workersReq);
    const staffing = workersReq > 0 ? Math.min(1, s.pop / workersReq) : 1;
    const moraleEff = s.morale < 30 ? 0.8 : (s.morale >= 75 ? 1.1 : 1);

    // 燃料の必要量。炉に優先して回し、残りを推進器へ（足りなければ比例して弱まる）
    const moving = mode.thrust > 0;
    let reactorFuelNeed = 0, engineFuelNeed = 0;
    for (const m of active) {
      if (!m.def.fuel) continue;
      if (m.def.kind === 'engine') { if (moving) engineFuelNeed += m.def.fuel * mode.fuel; }
      else reactorFuelNeed += m.def.fuel;
    }
    const reactorFuelRatio = reactorFuelNeed > 0 ? Math.min(1, s.fuel / reactorFuelNeed) : 1;
    const fuelLeft = Math.max(0, s.fuel - reactorFuelNeed * reactorFuelRatio);
    const engineFuelRatio = engineFuelNeed > 0 ? Math.min(1, fuelLeft / engineFuelNeed) : 1;
    const fuelNeed = reactorFuelNeed + engineFuelNeed;
    const fuelRatio = fuelNeed > 0 ? Math.min(1, s.fuel / fuelNeed) : 1;

    // 発電（艦橋の補助電源は常に働く）
    let powerGen = D.RULES.basePower;
    for (const m of active) {
      if (!m.def.powerGen) continue;
      let g;
      if (m.def.kind === 'solar') g = m.def.powerGen * sec.light * condEff(m);
      else g = m.def.powerGen * condEff(m) * m.staff * reactorFuelRatio;
      m.gen = g;
      m.powered = true;
      m.eff = g / m.def.powerGen;
      powerGen += g;
    }

    // 給電（優先度の高い順。足りない分はスキップして次へ）
    const consumers = active.filter(m => m.def.powerUse > 0)
      .sort((a, b) => (b.def.priority - a.def.priority) || (a.i - b.i));
    let avail = powerGen, powerUse = 0, powerDemand = 0;
    for (const m of consumers) {
      const idleEngine = m.def.kind === 'engine' && (!moving || engineFuelRatio <= 0);
      const use = idleEngine ? 0 : m.def.powerUse;
      powerDemand += use;
      if (avail + 1e-9 >= use) { m.powered = true; avail -= use; powerUse += use; m.powerDraw = use; }
      else { m.powered = false; m.notes.push('電力不足'); m.powerDraw = 0; }
    }
    for (const m of active) if (!m.def.powerUse && !m.def.powerGen) m.powered = true;

    // 稼働効率
    for (const m of active) {
      if (m.def.powerGen) continue;
      if (!m.powered) { m.eff = 0; continue; }
      m.eff = condEff(m) * (m.def.workers ? m.staff * moraleEff : 1);
    }
    const running = m => m.status === 'active' && m.powered && m.eff > 0;

    // 酸素・シールドの範囲
    const o2 = new Array(n).fill(0);
    const shield = new Array(n).fill(0);
    const spread = (arr, m, rad) => {
      for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
        const r = m.r + dr, c = m.c + dc;
        if (inGrid(s, r, c)) arr[idx(s, r, c)] += 1;
      }
    };
    for (const m of active) {
      if (!running(m)) continue;
      if (m.def.o2) spread(o2, m, m.def.o2);
      if (m.def.shieldR) spread(shield, m, m.def.shieldR);
    }

    const adjCount = (m, pred) => {
      let k = 0;
      for (const [dr, dc] of DIRS4) {
        const r = m.r + dr, c = m.c + dc;
        if (!inGrid(s, r, c)) continue;
        const o = info[idx(s, r, c)];
        if (o && pred(o)) k++;
      }
      return k;
    };

    // 収容力
    let cap = 0;
    for (const m of mods) {
      if (m.def.kind !== 'hab') continue;
      if (m.status !== 'active') { m.capEff = 0; continue; }
      const covered = o2[m.i] > 0;
      const c = m.def.cap * (m.powered ? 1 : 0.5) * (covered ? 1 : 0);
      if (!covered) m.notes.push('酸素なし');
      m.capEff = c;
      m.out = c;
      cap += c;
    }
    cap = Math.round(cap);

    // 食料・研究・資材・燃料
    let foodProd = 0, rpProd = 0, matProd = 0, refIn = 0, refOut = 0, scoopOut = 0;
    let lounges = 0, medbays = 0, shopsRunning = 0;
    for (const m of active) {
      if (!running(m)) continue;
      const k = m.def.kind;
      if (k === 'farm') {
        const adj = adjCount(m, o => running(o) && (o.def.kind === 'life' || o.def.kind === 'bio'));
        m.out = (m.def.food + (R.genecrops ? 3 : 0) + 2 * adj) * m.eff;
        foodProd += m.out;
      } else if (k === 'bio') {
        m.out = m.def.food * m.eff;
        foodProd += m.out;
      } else if (k === 'lab') {
        const adj = adjCount(m, o => running(o) && o.def.kind === 'lab');
        m.out = (m.def.rp + adj) * m.eff;
        rpProd += m.out;
      } else if (k === 'drone') {
        m.out = m.def.mine * sec.mine * mode.drone * m.eff;
        matProd += m.out;
      } else if (k === 'refinery') {
        refIn += m.def.refine.in * m.eff;
        refOut += m.def.refine.out * m.eff;
        if (sec.scoop) scoopOut += m.def.scoop * m.eff;
        m.out = m.def.refine.out * m.eff + (sec.scoop ? m.def.scoop * m.eff : 0);
      } else if (k === 'lounge') {
        lounges += m.eff;
      } else if (k === 'medbay') {
        medbays += m.eff;
      } else if (k === 'shop') {
        if (m.eff >= 0.5) shopsRunning++;
      }
    }
    const foodCons = s.pop * D.RULES.foodPerPerson;

    // 燃料消費
    const fuelUse = reactorFuelNeed * reactorFuelRatio + engineFuelNeed * engineFuelRatio;

    // 推力・質量・速度
    let thrust = 0;
    for (const m of active) {
      if (m.def.kind !== 'engine' || !running(m)) continue;
      const adj = adjCount(m, o => o.status === 'active' && o.def.kind === 'reactor' && o.gen > 0);
      m.out = m.def.thrust * (1 + D.RULES.reactorAdjBonus * adj) * m.eff * engineFuelRatio * mode.thrust;
      thrust += m.out;
    }
    let mass = hullCount(s) * D.RULES.hullMassPerCell;
    for (const m of mods) mass += m.def.mass;
    const speed = moving ? D.RULES.drift + D.RULES.speedK * thrust / mass : 0;

    // 貯蔵上限
    const capMat = { mat: D.RULES.baseCap.mat, fuel: D.RULES.baseCap.fuel, food: D.RULES.baseCap.food };
    for (const m of mods) {
      if (m.def.store && m.status !== 'building') {
        capMat.mat += m.def.store.mat; capMat.fuel += m.def.store.fuel; capMat.food += m.def.store.food;
      }
    }

    // 作業回数
    const apMax = Math.min(D.RULES.maxAp, D.RULES.baseAp + shopsRunning);

    // 士気：条件から「目標値」を求め、毎ターン少しずつ近づく
    const MR = D.RULES.morale;
    const moraleParts = [];
    moraleParts.push(['基本', MR.base]);
    moraleParts.push(['長旅の疲れ', -Math.min(MR.fatigueMax, s.turn * MR.fatiguePerTurn)]);
    const crowd = cap > 0 ? s.pop / cap : 9;
    if (crowd > 1) moraleParts.push(['過密（収容超過）', -25]);
    else if (crowd > 0.92) moraleParts.push(['手狭な居住区', -8]);
    else if (crowd < 0.75) moraleParts.push(['ゆとりある居住区', 6]);
    if (lounges > 0) moraleParts.push(['ラウンジ', Math.min(21, 7 * lounges)]);
    if (medbays > 0) moraleParts.push(['医務室', Math.min(6, 3 * medbays)]);
    let heat = 0;
    for (const m of active) {
      if (!m.def.heat || m.gen <= 0) continue;
      heat += adjCount(m, o => o.def.kind === 'hab' && o.status === 'active');
    }
    if (heat > 0) moraleParts.push(['炉の排熱', -5 * heat]);
    const unpoweredHabs = mods.filter(m => m.def.kind === 'hab' && m.status === 'active' && !m.powered).length;
    if (unpoweredHabs > 0) moraleParts.push(['停電した居住区', -5 * unpoweredHabs]);
    if (sec.morale) moraleParts.push([sec.name, sec.morale]);
    if (s.food + foodProd - foodCons < 0) moraleParts.push(['食料不足', -25]);
    const moraleTarget = Math.max(0, Math.min(100, moraleParts.reduce((a, p) => a + p[1], 0)));
    const moraleDelta = (moraleTarget - s.morale) * MR.rate;

    return {
      info, mods, staffing, workersReq, moraleEff, fuelRatio, reactorFuelRatio, engineFuelRatio,
      powerGen, powerUse, powerDemand, o2, shield, cap,
      foodProd, foodCons, rpProd, matProd, refIn, refOut, scoopOut,
      fuelUse, thrust, mass, speed, capMat, apMax, moraleParts, moraleTarget, moraleDelta,
      lounges, medbays
    };
  }

  /* ---------- プレイヤー操作 ---------- */
  function canAct(s) {
    if (s.status !== 'playing') return { ok: false, reason: '航海は終了しています' };
    if (s.pendingEvent) return { ok: false, reason: 'イベントへの対応が必要です' };
    return { ok: true };
  }

  function canBuild(s, r, c, id) {
    const a = canAct(s); if (!a.ok) return a;
    const def = D.MODULES[id];
    if (!def) return { ok: false, reason: '不明なモジュール' };
    if (!isUnlocked(s, id)) return { ok: false, reason: '研究が必要: ' + D.RESEARCH[def.research].name };
    if (!inGrid(s, r, c) || !s.hull[idx(s, r, c)]) return { ok: false, reason: '船体の外です' };
    if (s.cells[idx(s, r, c)]) return { ok: false, reason: '既にモジュールがあります' };
    if (!placementOk(s, s.hull, r, c, def.place)) {
      return { ok: false, reason: def.place === 'rear' ? '船尾（左隣が船外）にしか置けません' : '外縁にしか置けません' };
    }
    if (s.ap < 1) return { ok: false, reason: '作業回数が残っていません' };
    if (s.mat < def.cost) return { ok: false, reason: '資材が足りません（' + def.cost + '必要）' };
    return { ok: true };
  }

  function build(s, r, c, id) {
    const chk = canBuild(s, r, c, id); if (!chk.ok) return chk;
    const def = D.MODULES[id];
    s.mat -= def.cost;
    s.ap -= 1;
    s.cells[idx(s, r, c)] = makeCell(id, false);
    s.stats.built++;
    addLog(s, def.name + 'の建造を開始（完成まで' + def.build + 'ターン）', 'build');
    return { ok: true };
  }

  function demolishRefund(s, r, c) {
    const cell = s.cells[idx(s, r, c)];
    if (!cell) return 0;
    const def = D.MODULES[cell.id];
    return Math.floor(def.cost * (cell.build > 0 ? 0.8 : 0.4));
  }

  function canDemolish(s, r, c) {
    const a = canAct(s); if (!a.ok) return a;
    if (!inGrid(s, r, c) || !s.cells[idx(s, r, c)]) return { ok: false, reason: 'モジュールがありません' };
    if (s.ap < 1) return { ok: false, reason: '作業回数が残っていません' };
    return { ok: true };
  }

  function demolish(s, r, c) {
    const chk = canDemolish(s, r, c); if (!chk.ok) return chk;
    const i = idx(s, r, c);
    const def = D.MODULES[s.cells[i].id];
    const refund = demolishRefund(s, r, c);
    s.mat = Math.min(computeFlows(s).capMat.mat, s.mat + refund);
    s.cells[i] = null;
    s.ap -= 1;
    addLog(s, def.name + 'を撤去（資材+' + refund + '）', 'build');
    return { ok: true };
  }

  function canRepair(s, r, c) {
    const a = canAct(s); if (!a.ok) return a;
    const cell = inGrid(s, r, c) ? s.cells[idx(s, r, c)] : null;
    if (!cell) return { ok: false, reason: 'モジュールがありません' };
    if (cell.build > 0) return { ok: false, reason: '建造中です' };
    if (!cell.broken && cell.cond >= 100) return { ok: false, reason: '修理の必要はありません' };
    if (s.ap < 1) return { ok: false, reason: '作業回数が残っていません' };
    if (s.mat < D.RULES.repairCost) return { ok: false, reason: '資材が足りません（' + D.RULES.repairCost + '必要）' };
    return { ok: true };
  }

  function repair(s, r, c) {
    const chk = canRepair(s, r, c); if (!chk.ok) return chk;
    const cell = s.cells[idx(s, r, c)];
    const wasBroken = cell.broken;
    s.mat -= D.RULES.repairCost;
    s.ap -= 1;
    cell.cond = Math.min(100, cell.cond + D.RULES.repairAmount);
    cell.broken = false;
    s.stats.repaired++;
    addLog(s, D.MODULES[cell.id].name + (wasBroken ? 'を修復し、再稼働させた' : 'を整備した（耐久' + Math.round(cell.cond) + '%）'), 'build');
    return { ok: true };
  }

  function toggle(s, r, c) {
    const a = canAct(s); if (!a.ok) return a;
    const cell = inGrid(s, r, c) ? s.cells[idx(s, r, c)] : null;
    if (!cell) return { ok: false, reason: 'モジュールがありません' };
    cell.enabled = !cell.enabled;
    return { ok: true };
  }

  function canExpand(s, r, c) {
    const a = canAct(s); if (!a.ok) return a;
    if (!inGrid(s, r, c)) return { ok: false, reason: '範囲外です' };
    const i = idx(s, r, c);
    if (s.hull[i]) return { ok: false, reason: '既に船体です' };
    if (!DIRS4.some(([dr, dc]) => hullAt(s, s.hull, r + dr, c + dc))) return { ok: false, reason: '船体に隣接していません' };
    const hull2 = s.hull.slice();
    hull2[i] = true;
    for (let j = 0; j < s.cells.length; j++) {
      const cell = s.cells[j];
      if (!cell) continue;
      const def = D.MODULES[cell.id];
      const [rr, cc] = rc(s, j);
      if (placementOk(s, s.hull, rr, cc, def.place) && !placementOk(s, hull2, rr, cc, def.place)) {
        return { ok: false, reason: def.name + 'の' + (def.place === 'rear' ? '噴射口' : '外縁') + 'を塞いでしまいます' };
      }
    }
    if (s.ap < 1) return { ok: false, reason: '作業回数が残っていません' };
    const cost = expandCost(s);
    if (s.mat < cost) return { ok: false, reason: '資材が足りません（' + cost + '必要）' };
    return { ok: true };
  }

  function expand(s, r, c) {
    const chk = canExpand(s, r, c); if (!chk.ok) return chk;
    const cost = expandCost(s);
    s.mat -= cost;
    s.ap -= 1;
    s.hull[idx(s, r, c)] = true;
    addLog(s, '外殻を拡張した（資材-' + cost + '）', 'build');
    return { ok: true };
  }

  function canResearch(s, id) {
    const a = canAct(s); if (!a.ok) return a;
    const def = D.RESEARCH[id];
    if (!def) return { ok: false, reason: '不明な研究' };
    if (s.researched[id]) return { ok: false, reason: '研究済み' };
    if (s.rp < def.cost) return { ok: false, reason: '研究ポイントが足りません' };
    return { ok: true };
  }

  function research(s, id) {
    const chk = canResearch(s, id); if (!chk.ok) return chk;
    const def = D.RESEARCH[id];
    s.rp -= def.cost;
    s.researched[id] = true;
    addLog(s, '研究完了：' + def.name + ' — ' + def.desc, 'research');
    return { ok: true };
  }

  function setMode(s, mode) {
    if (!D.MODES[mode]) return { ok: false, reason: '不明なモード' };
    const a = canAct(s); if (!a.ok) return a;
    s.mode = mode;
    return { ok: true };
  }

  /* ---------- 被害 ---------- */
  function damageCell(s, i, amount, F, log) {
    const cell = s.cells[i];
    const shielded = F.shield[i] > 0;
    let dmg = amount * (shielded ? 0.25 : 1) * (s.researched.scanner ? 0.7 : 1);
    dmg = Math.round(dmg);
    if (!cell) return { hit: false, dmg: 0 };
    const def = D.MODULES[cell.id];
    if (cell.build > 0) {
      cell.build += 1;
      log.push(def.name + '（建造中）が被弾し、工期が延びた');
      return { hit: true, dmg };
    }
    cell.cond = Math.max(0, cell.cond - dmg);
    let text = def.name + 'が被弾（耐久-' + dmg + (shielded ? '・シールドで軽減' : '') + '）';
    if (cell.cond <= 0 && !cell.broken) { cell.broken = true; text += '、機能停止！'; }
    if (def.kind === 'hab' && !shielded && cell.cond < 60) {
      const loss = Math.min(s.pop, randInt(s, 2, 5));
      s.pop -= loss; s.stats.lost += loss;
      text += '　乗員' + loss + '人が犠牲に';
    }
    log.push(text);
    return { hit: true, dmg };
  }

  function hullCells(s) {
    const a = [];
    for (let i = 0; i < s.hull.length; i++) if (s.hull[i]) a.push(i);
    return a;
  }
  function moduleCells(s, pred) {
    const a = [];
    for (let i = 0; i < s.cells.length; i++) {
      const c = s.cells[i];
      if (c && (!pred || pred(c, D.MODULES[c.id], i))) a.push(i);
    }
    return a;
  }

  /* ---------- イベント ---------- */
  const has = (s, kind) => moduleCells(s, (c, d) => d.kind === kind && c.build === 0 && !c.broken && c.enabled).length;

  const EVENTS = [
    {
      id: 'meteor', weight: (s, t) => ({ asteroid: 6, derelict: 2, normal: 1, nebula: 0.6, star: 0.8 })[t] || 0,
      run(s, F, log) {
        const hits = randInt(s, 1, 3);
        log.push('☄ 微小隕石群が船体を直撃した！');
        const cells = hullCells(s);
        for (let k = 0; k < hits; k++) {
          const i = pick(s, cells);
          if (s.cells[i]) damageCell(s, i, randInt(s, 30, 50), F, log);
          else log.push('空き区画に命中。被害なし');
        }
        return 'danger';
      }
    },
    {
      id: 'flare', weight: (s, t) => ({ star: 5, normal: 0.4, goal: 0.5 })[t] || 0,
      run(s, F, log) {
        log.push('☀ 恒星フレアが襲来！ 外縁の区画が高エネルギー粒子に晒された');
        let n = 0;
        for (let i = 0; i < s.cells.length; i++) {
          if (!s.cells[i]) continue;
          const [r, c] = rc(s, i);
          if (isEdge(s, s.hull, r, c) && rand(s) < 0.6) { damageCell(s, i, randInt(s, 15, 30), F, log); n++; }
        }
        if (!n) log.push('幸い、被害は軽微だった');
        return 'danger';
      }
    },
    {
      id: 'malfunction', weight: () => 1.4,
      run(s, F, log) {
        const list = moduleCells(s, c => c.build === 0 && !c.broken);
        if (!list.length) return null;
        const i = pick(s, list);
        const cell = s.cells[i];
        const def = D.MODULES[cell.id];
        const dmg = randInt(s, 30, 55);
        cell.cond = Math.max(0, cell.cond - dmg);
        let t = '⚙ ' + def.name + 'で部品の故障が発生（耐久-' + dmg + '）';
        if (cell.cond <= 0) { cell.broken = true; t += '、機能停止！'; }
        log.push(t);
        return 'warn';
      }
    },
    {
      id: 'plague', weight: (s) => {
        const F = computeFlows(s);
        return (F.cap > 0 && s.pop / F.cap > 0.95) ? 1.6 : 0.4;
      },
      run(s, F, log) {
        const rate = F.medbays > 0 ? 0.03 : 0.09;
        const loss = Math.max(1, Math.round(s.pop * rate));
        s.pop = Math.max(0, s.pop - loss); s.stats.lost += loss;
        s.morale = Math.max(0, s.morale - 5);
        log.push('☣ 船内で疫病が流行。' + loss + '人が亡くなった' + (F.medbays > 0 ? '（医務室が被害を抑えた）' : '') + '　士気-5');
        return 'danger';
      }
    },
    {
      id: 'babyboom', weight: (s) => (s.morale >= 60 ? 0.7 : 0),
      run(s, F, log) {
        const room = Math.max(0, F.cap - s.pop);
        const born = Math.min(room, randInt(s, 4, 9));
        if (born <= 0) { log.push('出産を望む声が多いが、居住区に空きがない'); s.morale = Math.max(0, s.morale - 2); return 'warn'; }
        s.pop += born; s.stats.born += born;
        s.morale = Math.min(100, s.morale + 3);
        log.push('👶 ベビーラッシュ！ ' + born + '人の新しい命が生まれた　士気+3');
        return 'good';
      }
    },
    {
      id: 'festival', weight: (s) => (s.morale >= 75 ? 0.7 : 0),
      run(s, F, log) {
        s.morale = Math.min(100, s.morale + 5);
        s.rp += 8;
        log.push('🎉 出航記念祭が開かれた。士気+5、交流から生まれたアイデアで研究+8');
        return 'good';
      }
    },
    {
      id: 'unrest', weight: (s) => (s.morale < 35 ? 3 : 0),
      run(s, F, log) {
        const list = moduleCells(s, c => c.build === 0 && !c.broken);
        log.push('✊ 不満を募らせた乗員が暴動を起こした！ 次ターンの作業回数-1');
        s.apPenalty = 1;
        if (list.length) {
          const i = pick(s, list);
          const cell = s.cells[i];
          cell.cond = Math.max(0, cell.cond - 45);
          if (cell.cond <= 0) cell.broken = true;
          log.push(D.MODULES[cell.id].name + 'が破壊工作を受けた（耐久-45）');
        }
        s.morale = Math.max(0, s.morale - 2);
        return 'danger';
      }
    },
    {
      id: 'gas', weight: (s, t) => (t === 'nebula' ? 4 : 0),
      run(s, F, log) {
        const refs = has(s, 'refinery');
        const gain = 15 + refs * 25;
        s.fuel = Math.min(F.capMat.fuel, s.fuel + gain);
        log.push('🌫 濃密なガス雲を通過。燃料+' + gain + (refs ? '（精製所が効率よく回収）' : ''));
        return 'good';
      }
    },
    {
      id: 'ore', weight: (s, t) => ({ asteroid: 3, star: 1, derelict: 1 })[t] || 0,
      run(s, F, log) {
        const drones = has(s, 'drone');
        const gain = drones ? randInt(s, 40, 80) : randInt(s, 10, 20);
        s.mat = Math.min(F.capMat.mat, s.mat + gain);
        log.push('⛏ 金属に富んだ岩塊を捕捉。資材+' + gain + (drones ? '' : '（ドローンがあればもっと回収できた）'));
        return 'good';
      }
    },
    {
      id: 'calm', weight: (s, t) => ({ normal: 2, goal: 2, star: 0.6 })[t] || 0,
      run(s, F, log) {
        s.morale = Math.min(100, s.morale + 1);
        log.push(pick(s, [
          '穏やかな航行が続く。展望窓から見る星々に乗員が安らいだ　士気+1',
          '子どもたちが船内で星座づくりのコンテストを開いた　士気+1',
          '古い記録映像の上映会が開かれた。母星を懐かしむ声も　士気+1'
        ]));
        return 'good';
      }
    },
    {
      id: 'silence', weight: (s, t) => (t === 'void' ? 3 : 0),
      run(s, F, log) {
        const d = F.lounges > 0 ? 2 : 5;
        s.morale = Math.max(0, s.morale - d);
        log.push('🌑 何も見えない闇が続き、乗員の間に閉塞感が広がる　士気-' + d + (F.lounges > 0 ? '（ラウンジが和らげた）' : ''));
        return 'warn';
      }
    },
    /* --- 選択イベント --- */
    {
      id: 'derelict', choice: true, weight: (s, t) => ({ derelict: 5, normal: 0.6, void: 0.8, asteroid: 0.5 })[t] || 0,
      make(s) {
        return {
          title: '漂流船の発見',
          text: '識別信号の途絶えた古い輸送船が漂っている。中に何が残っているかは分からない。',
          choices: [
            { label: '調査隊を送り込む', hint: '高確率で資材と研究データ。失敗すると犠牲者が出る' },
            { label: '牽引して解体する', hint: '燃料20を使い、資材40を確実に回収' },
            { label: '関わらずに進む', hint: '何も起きない' }
          ]
        };
      },
      resolve(s, k, F, log) {
        if (k === 0) {
          if (rand(s) < 0.7) {
            const m = randInt(s, 60, 120), r = randInt(s, 10, 25);
            s.mat = Math.min(F.capMat.mat, s.mat + m); s.rp += r;
            log.push('調査隊は貴重な物資を持ち帰った。資材+' + m + '、研究+' + r);
            return 'good';
          }
          const loss = Math.min(s.pop, randInt(s, 4, 10));
          s.pop -= loss; s.stats.lost += loss; s.morale = Math.max(0, s.morale - 4);
          log.push('漂流船の動力炉が暴走し、調査隊' + loss + '人が帰らなかった　士気-4');
          return 'danger';
        }
        if (k === 1) {
          if (s.fuel < 20) { log.push('燃料が足りず牽引を断念した'); return 'warn'; }
          s.fuel -= 20; s.mat = Math.min(F.capMat.mat, s.mat + 40);
          log.push('漂流船を解体し、資材+40を回収（燃料-20）');
          return 'good';
        }
        log.push('漂流船は静かに後方へ遠ざかっていった');
        return 'info';
      }
    },
    {
      id: 'refugees', choice: true, weight: (s, t) => ({ normal: 0.5, derelict: 0.8, star: 0.5, asteroid: 0.3 })[t] || 0,
      make(s) {
        const n = randInt(s, 12, 22);
        return {
          title: '救難信号',
          text: '損傷した移民船から救難信号。生存者' + n + '人が受け入れを求めている。',
          data: { n },
          choices: [
            { label: '全員を受け入れる', hint: '人口+' + n + '・士気+4。居住区に空きがないと過密になる' },
            { label: '物資だけ送る', hint: '食料-30・士気+1' },
            { label: '見捨てる', hint: '士気-6' }
          ]
        };
      },
      resolve(s, k, F, log, data) {
        if (k === 0) {
          s.pop += data.n; s.morale = Math.min(100, s.morale + 4);
          log.push(data.n + '人の生存者を迎え入れた。新しい仲間に船内が沸いた　士気+4');
          return 'good';
        }
        if (k === 1) {
          s.food = Math.max(0, s.food - 30); s.morale = Math.min(100, s.morale + 1);
          log.push('食料を送り届けた。彼らの無事を祈る　士気+1');
          return 'info';
        }
        s.morale = Math.max(0, s.morale - 6);
        log.push('救難信号は次第に弱まり、やがて途絶えた　士気-6');
        return 'warn';
      }
    },
    {
      id: 'signal', choice: true, weight: (s, t) => ({ void: 3, nebula: 1, normal: 0.4 })[t] || 0,
      make(s) {
        return {
          title: '未知の信号',
          text: '規則的なパルス信号を受信した。自然現象とは思えないパターンだ。',
          choices: [
            { label: '研究班に解析させる', hint: '研究ポイント+35〜60。内容次第で士気が下がることも' },
            { label: '記録だけ残して無視する', hint: '研究+5' }
          ]
        };
      },
      resolve(s, k, F, log) {
        if (k === 0) {
          const r = randInt(s, 35, 60);
          s.rp += r;
          if (rand(s) < 0.25) {
            s.morale = Math.max(0, s.morale - 8);
            log.push('解析の結果、信号は滅んだ文明の最後の警告だった…　研究+' + r + '、士気-8');
            return 'warn';
          }
          log.push('信号から未知の航法理論の断片を得た。研究+' + r);
          return 'good';
        }
        s.rp += 5;
        log.push('信号を記録して航行を続けた。研究+5');
        return 'info';
      }
    },
    {
      id: 'slingshot', choice: true, weight: (s, t) => (t === 'star' ? 2.5 : 0),
      make(s) {
        return {
          title: 'スイングバイの好機',
          text: '巨大ガス惑星の重力を利用すれば大きく加速できる。ただし軌道計算を誤れば船体に負荷がかかる。',
          choices: [
            { label: 'スイングバイを実行', hint: '+60〜110光年前進。30%で推進器が損傷' },
            { label: '安全な航路を取る', hint: '何も起きない' }
          ]
        };
      },
      resolve(s, k, F, log) {
        if (k === 0) {
          const d = randInt(s, 60, 110);
          s.dist += d;
          log.push('重力の腕に乗って加速！ ' + d + '光年前進した');
          if (rand(s) < 0.3) {
            const engines = moduleCells(s, (c, def) => def.kind === 'engine' && c.build === 0);
            for (const i of engines) {
              const cell = s.cells[i];
              cell.cond = Math.max(0, cell.cond - 25);
              if (cell.cond <= 0) cell.broken = true;
            }
            log.push('急激な重力変化で推進器に負荷がかかった（推進器の耐久-25）');
            return 'warn';
          }
          return 'good';
        }
        log.push('慎重に惑星を迂回した');
        return 'info';
      }
    }
  ];
  const EVENT_BY_ID = Object.fromEntries(EVENTS.map(e => [e.id, e]));

  function rollEvent(s, log) {
    const type = currentSector(s).type;
    const chance = D.SECTORS[type].event * D.RULES.eventChanceScale;
    if (rand(s) >= chance) return;
    const ws = EVENTS.map(e => Math.max(0, e.weight(s, type) || 0));
    const total = ws.reduce((a, b) => a + b, 0);
    if (total <= 0) return;
    let x = rand(s) * total;
    let ev = EVENTS[EVENTS.length - 1];
    for (let k = 0; k < EVENTS.length; k++) { x -= ws[k]; if (x <= 0) { ev = EVENTS[k]; break; } }
    const F = computeFlows(s);
    if (ev.choice) {
      const p = ev.make(s);
      s.pendingEvent = { id: ev.id, title: p.title, text: p.text, choices: p.choices, data: p.data || null };
      log.push({ text: '❗ ' + p.title + '：' + p.text, kind: 'event' });
      return;
    }
    const lines = [];
    const kind = ev.run(s, F, lines);
    for (const t of lines) log.push({ text: t, kind: kind || 'info' });
  }

  function resolveEvent(s, k) {
    const pe = s.pendingEvent;
    if (!pe) return { ok: false, reason: 'イベントはありません' };
    const ev = EVENT_BY_ID[pe.id];
    if (!ev || !pe.choices[k]) return { ok: false, reason: '不正な選択' };
    const lines = [];
    const F = computeFlows(s);
    const kind = ev.resolve(s, k, F, lines, pe.data);
    s.pendingEvent = null;
    for (const t of lines) addLog(s, t, kind || 'info');
    checkEnd(s);
    return { ok: true, lines, kind };
  }

  /* ---------- ターン進行 ---------- */
  function endTurn(s) {
    const a = canAct(s); if (!a.ok) return a;
    const F = computeFlows(s);
    const R = s.researched;
    const mode = D.MODES[s.mode];
    const out = [];
    const push = (text, kind) => out.push({ text, kind: kind || 'info' });

    // 資源の増減
    let food = s.food + F.foodProd - F.foodCons;
    const matAvail = s.mat + F.matProd;
    const refScale = F.refIn > 0 ? Math.min(1, matAvail / F.refIn) : 1;
    let mat = matAvail - F.refIn * refScale;
    let fuel = s.fuel - F.fuelUse + F.refOut * refScale + F.scoopOut;
    s.rp += F.rpProd;
    s.mat = Math.min(F.capMat.mat, Math.max(0, mat));
    s.fuel = Math.min(F.capMat.fuel, Math.max(0, fuel));

    // 食料と人口
    let starved = false;
    if (food < 0) {
      starved = true;
      const loss = Math.max(1, Math.ceil(s.pop * 0.06));
      s.pop = Math.max(0, s.pop - loss); s.stats.lost += loss;
      push('🍽 食料が尽きた！ 飢えで' + loss + '人が亡くなった', 'danger');
      food = 0;
    }
    s.food = Math.min(F.capMat.food, food);

    if (s.pop > F.cap) {
      const over = s.pop - F.cap;
      const loss = Math.min(s.pop, Math.max(1, Math.ceil(over * 0.3)));
      s.pop -= loss; s.stats.lost += loss;
      s.morale -= 3;
      push('🫁 居住可能な区画が足りない。酸素・居住環境の不足で' + loss + '人が亡くなった', 'danger');
    } else if (!starved && s.morale >= 30 && F.foodProd >= F.foodCons && s.pop < F.cap && s.food > 0) {
      const rate = 0.02 * (s.morale >= 70 ? 1.3 : 1) * (1 + 0.5 * Math.min(2, F.medbays));
      let g = Math.min(F.cap - s.pop, s.pop * rate);
      let born = Math.floor(g);
      if (rand(s) < g - born) born++;
      if (born > 0) { s.pop += born; s.stats.born += born; }
    }
    s.stats.maxPop = Math.max(s.stats.maxPop, s.pop);

    // 士気
    s.morale = Math.max(0, Math.min(100, s.morale + F.moraleDelta));

    // 航行
    const prevDist = s.dist;
    s.dist += F.speed;

    // 建造の進行と劣化
    for (let i = 0; i < s.cells.length; i++) {
      const cell = s.cells[i];
      if (!cell) continue;
      const def = D.MODULES[cell.id];
      if (cell.build > 0) {
        cell.build--;
        if (cell.build === 0) push('🔧 ' + def.name + 'が完成した', 'build');
        continue;
      }
      const m = F.info[i];
      if (!m || m.status !== 'active') continue;
      let wear = def.wear * D.RULES.wearScale * (0.6 + 0.8 * rand(s));
      if (def.kind === 'engine') wear *= mode.wear;
      if (!m.powered) wear *= 0.3;
      cell.cond -= wear;
      if (R.nanobots) cell.cond += 2;
      cell.cond = Math.min(100, cell.cond);
      if (cell.cond <= 0) {
        cell.cond = 0; cell.broken = true;
        push('⚠ ' + def.name + 'が老朽化で故障した。修理が必要', 'danger');
      } else if (cell.cond < 30 && rand(s) < D.RULES.breakChance) {
        cell.broken = true;
        push('⚠ 劣化していた' + def.name + 'が故障した。修理が必要', 'danger');
      }
    }

    // 宙域の移動
    while (s.sectorIndex < s.route.length - 1) {
      const sec = currentSector(s);
      if (s.dist < sec.start + sec.len) break;
      s.sectorIndex++;
      const nd = sectorDef(s);
      push('🛰 ' + nd.name + 'に突入。' + nd.desc, 'sector');
    }
    if (prevDist < D.RULES.totalDistance / 2 && s.dist >= D.RULES.totalDistance / 2) {
      push('航程の半分を越えた。船内に小さな歓声が上がった', 'story');
    }

    // イベント
    if (s.dist < D.RULES.totalDistance && s.pop > 0) rollEvent(s, out);

    for (const o of out) {
      if (typeof o === 'string') addLog(s, o, 'info'); else addLog(s, o.text, o.kind);
    }

    // 次のターンへ
    s.turn++;
    checkEnd(s);
    if (s.status === 'playing') {
      const F2 = computeFlows(s);
      s.ap = Math.max(0, F2.apMax - s.apPenalty);
      s.apPenalty = 0;
      // 予兆の警告（同じ警告は5ターンに1回まで）
      s.warned = s.warned || {};
      const warn = (key, cond, text) => {
        if (!cond) return;
        if (s.warned[key] && s.turn - s.warned[key] < 5) return;
        s.warned[key] = s.turn;
        addLog(s, text, 'warn');
      };
      warn('food', F2.foodProd < F2.foodCons && s.food < (F2.foodCons - F2.foodProd) * 4, '食料の備蓄が残りわずかです');
      warn('fuel', F2.fuelUse > F2.refOut + F2.scoopOut && s.fuel < F2.fuelUse * 6, '燃料の残量が少なくなっています');
      warn('power', F2.powerDemand > F2.powerGen + 1e-9, '電力が足りず、一部の区画が停止しています');
      warn('crowd', s.pop > F2.cap, '居住できる区画が足りません。居住区か生命維持装置が必要です');
    }
    return { ok: true };
  }

  function computeScore(s) {
    const pop = s.pop;
    const score = Math.round(pop * 10 + s.morale * 4 + Math.max(0, 220 - s.turn) * 15);
    let rank = 'C';
    if (score >= 4600) rank = 'S';
    else if (score >= 3600) rank = 'A';
    else if (score >= 2600) rank = 'B';
    return { score, rank, pop, morale: Math.round(s.morale), turn: s.turn };
  }

  function checkEnd(s) {
    if (s.status !== 'playing') return;
    if (s.pop <= 0) {
      s.pop = 0;
      s.status = 'lost';
      s.endReason = '最後の乗員が息を引き取り、方舟は沈黙した。';
      addLog(s, s.endReason, 'danger');
      return;
    }
    if (s.dist >= D.RULES.totalDistance) {
      s.dist = D.RULES.totalDistance;
      s.status = 'won';
      s.pendingEvent = null;
      s.score = computeScore(s);
      s.endReason = s.turn + 'ターン目、方舟は惑星ヴェルダの軌道に到達した。' + s.pop + '人の入植者が新天地に降り立つ。';
      addLog(s, s.endReason, 'story');
      return;
    }
    if (s.turn > D.RULES.maxTurns) {
      s.status = 'lost';
      s.endReason = '航海は' + D.RULES.maxTurns + 'ターンを越えた。世代を重ねるうちに航行の目的は忘れ去られた…';
      addLog(s, s.endReason, 'danger');
    }
  }

  /* ---------- セーブ ---------- */
  function serialize(s) { return JSON.stringify(s); }
  function deserialize(str) {
    const s = JSON.parse(str);
    if (!s || s.version !== SAVE_VERSION || !Array.isArray(s.cells) || !Array.isArray(s.route)) {
      throw new Error('セーブデータの形式が違います');
    }
    return s;
  }

  return {
    D, newGame, computeFlows, endTurn, resolveEvent,
    canBuild, build, canDemolish, demolish, demolishRefund, canRepair, repair, toggle,
    canExpand, expand, expandCost, canResearch, research, setMode,
    currentSector, sectorDef, isUnlocked, isEdge, isRear, placementOk, placementLabel,
    scanRange, hullCount, serialize, deserialize, computeScore,
    idx, rc, inGrid, EVENTS, rand
  };
});

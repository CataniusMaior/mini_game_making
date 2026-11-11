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

  const SAVE_VERSION = 2;
  const R = D.RULES;

  /* ---------- 乱数（mulberry32） ---------- */
  function rand(s) {
    let t = (s.rng = (s.rng + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function randInt(s, lo, hi) { return lo + Math.floor(rand(s) * (hi - lo + 1)); }
  function pick(s, arr) { return arr[Math.floor(rand(s) * arr.length)]; }
  function roundRandom(s, x) { const f = Math.floor(x); return f + (rand(s) < x - f ? 1 : 0); }

  /* ---------- 座標 ---------- */
  const idx = (s, r, c) => r * s.cols + c;
  const rc = (s, i) => [Math.floor(i / s.cols), i % s.cols];
  const inGrid = (s, r, c) => r >= 0 && r < s.rows && c >= 0 && c < s.cols;
  const hullAt = (s, hull, r, c) => inGrid(s, r, c) && hull[idx(s, r, c)];
  const DIRS4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const cheb = (r1, c1, r2, c2) => Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));

  function isEdge(s, hull, r, c) { return DIRS4.some(([dr, dc]) => !hullAt(s, hull, r + dr, c + dc)); }
  function isRear(s, hull, r, c) { return !hullAt(s, hull, r, c - 1); }
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

  /* ---------- 難易度・寿命 ---------- */
  const diffOf = s => D.DIFFICULTY[s.difficulty] || D.DIFFICULTY.normal;
  function lifespan(s, id) {
    const def = D.MODULES[id];
    if (!def.life) return Infinity;
    return def.life * diffOf(s).lifeMult * (s.researched.maintenance ? 1.5 : 1);
  }
  function breakChance(s, cell) {
    const L = lifespan(s, cell.id);
    if (!isFinite(L)) return 0;
    const x = cell.age / L;
    if (x < R.wearStart) return 0.003;
    const k = (x - R.wearStart) / (1 - R.wearStart);
    return Math.min(0.6, 0.04 + 0.32 * k * k);
  }
  function wearLevel(s, cell) {
    const L = lifespan(s, cell.id);
    return isFinite(L) ? cell.age / L : 0;
  }

  /* ---------- 航路 ---------- */
  const NAME_A = ['アル', 'ベガ', 'セリ', 'ドラ', 'エオ', 'フィ', 'ガル', 'ヘス', 'イオ', 'カル', 'ルミ', 'ミラ', 'ノヴァ', 'オル', 'ペル', 'リゲ', 'シル', 'タウ', 'ウル', 'ヴェ', 'ゼタ', 'キリ'];
  const NAME_B = ['ン', 'ス', 'ラ', 'ナ', 'ト', 'ル', 'ア', 'ク', 'ム', 'ド', 'ノ', 'ア'];

  function portName(s, type) {
    const base = pick(s, NAME_A) + pick(s, NAME_B);
    if (type === 'station') return base + '中継基地';
    if (type === 'star') return base + '星系';
    return base + '-' + randInt(s, 2, 99) + pick(s, ['b', 'c', 'd', 'e']);
  }

  function generateRoute(s) {
    const total = R.totalDistance;
    const ports = [];
    let pos = 0;
    let prev = null;
    const types = ['rock', 'ice', 'gas', 'station', 'star'];
    for (;;) {
      const gap = randInt(s, R.portSpacing[0], R.portSpacing[1]);
      if (pos + gap > total - 150) break;
      pos += gap;
      let type;
      if (!ports.length) type = pick(s, ['rock', 'ice']);
      else do { type = pick(s, types); } while (type === prev);
      prev = type;
      const pd = D.PORTS[type];
      const range = v => (Array.isArray(v) ? randInt(s, v[0], v[1]) : v);
      ports.push({ type, name: portName(s, type), pos, mat: range(pd.mat), fuel: range(pd.fuel), rp: range(pd.rp), visited: false, skip: false });
    }
    const points = [0, ...ports.map(p => p.pos), total];
    const legs = [];
    const legTypes = ['normal', 'normal', 'asteroid', 'asteroid', 'nebula', 'derelict', 'void'];
    let prevLeg = 'normal';
    for (let k = 0; k < points.length - 1; k++) {
      let type = 'normal';
      if (k > 0) do { type = pick(s, legTypes); } while (type === prevLeg && type !== 'normal');
      prevLeg = type;
      legs.push({ type, start: points[k], len: points[k + 1] - points[k] });
    }
    return { ports, legs };
  }

  function legIndexAt(s, dist) {
    const legs = s.route.legs;
    for (let k = 0; k < legs.length; k++) if (dist < legs[k].start + legs[k].len) return k;
    return legs.length - 1;
  }
  function currentLeg(s) { return s.route.legs[legIndexAt(s, s.dist)]; }
  function currentPort(s) { return s.portIndex >= 0 ? s.route.ports[s.portIndex] : null; }
  function nextPortIndex(s) {
    // 寄港中の港を除き、まだ訪れていない最初の寄港地（現在地より先）
    const ps = s.route.ports;
    for (let k = 0; k < ps.length; k++) {
      if (k !== s.portIndex && !ps[k].visited && ps[k].pos >= s.dist - 1e-9) return k;
    }
    return -1;
  }
  function scanRange(s) { return s.researched.scanner ? 4 : 1; }

  /* ---------- 新規ゲーム ---------- */
  function makeCell(id, done) {
    const def = D.MODULES[id];
    return { id, age: 0, broken: false, build: done ? 0 : def.build, overhaul: 0, enabled: true };
  }

  function newGame(seed, difficulty) {
    if (seed === undefined || seed === null) seed = Math.floor(Math.random() * 2147483647);
    if (!D.DIFFICULTY[difficulty]) difficulty = 'normal';
    const diff = D.DIFFICULTY[difficulty];
    const rows = D.ROWS, cols = D.COLS;
    const s = {
      version: SAVE_VERSION,
      seed: seed | 0,
      rng: seed | 0,
      difficulty,
      rows, cols,
      turn: 1,
      status: 'playing',
      endReason: '',
      hull: new Array(rows * cols).fill(false),
      cells: new Array(rows * cols).fill(null),
      pop: diff.pop,
      morale: 60,
      mat: diff.mat,
      fuel: diff.fuel,
      rp: 0,
      ap: 0,
      apPenalty: 0,
      mode: 'cruise',
      dist: 0,
      wave: diff.wave.start,
      portIndex: -1,
      route: null,
      researched: {},
      pendingEvent: null,
      log: [],
      stats: { built: 0, repaired: 0, overhauled: 0, lost: 0, born: 0, maxPop: diff.pop, ports: 0, harvested: 0 },
      warned: {},
      summary: null,
      score: null
    };
    const h = D.START_HULL;
    for (let r = h.r0; r <= h.r1; r++) for (let c = h.c0; c <= h.c1; c++) s.hull[idx(s, r, c)] = true;
    for (const [r, c, id] of D.START_LAYOUT) {
      const cell = makeCell(id, true);
      const L = lifespan(s, id);
      if (isFinite(L)) cell.age = Math.round(L * (R.startAge[0] + (R.startAge[1] - R.startAge[0]) * rand(s)));
      s.cells[idx(s, r, c)] = cell;
    }
    s.route = generateRoute(s);
    const legacy = pick(s, D.LEGACY_TECH);
    s.researched[legacy] = true;
    // 初期人口が住めるように、収容力の範囲に収める
    s.pop = Math.min(s.pop, Math.floor(computeFlows(s).support * R.startPopRatio));
    const F = computeFlows(s);
    s.morale = Math.round(F.moraleTarget);
    s.ap = F.apMax;
    addLog(s, '母星の恒星が崩壊を始めた。背後から恒星の衝撃波が迫る。最後の世代船は' + R.totalDistance.toLocaleString('ja-JP') + '光年先の惑星ヴェルダへ旅立つ。', 'story');
    addLog(s, 'この船には「' + D.RESEARCH[legacy].name + '」の技術が受け継がれている（' + D.RESEARCH[legacy].desc + '）', 'research');
    addLog(s, '何も置いていないマスは居住ブロック。空気と食料が届くほど多くの人が住める。', 'hint');
    return s;
  }

  function addLog(s, text, kind) {
    s.log.push({ turn: s.turn, text, kind: kind || 'info' });
    if (s.log.length > 500) s.log.splice(0, s.log.length - 500);
  }

  function clone(s) { return JSON.parse(JSON.stringify(s)); }

  /* ---------- 参照系 ---------- */
  function isUnlocked(s, id) {
    const def = D.MODULES[id];
    return !def.fixed && (!def.research || !!s.researched[def.research]);
  }
  function hullCount(s) { return s.hull.reduce((a, b) => a + (b ? 1 : 0), 0); }
  function expandCost(s) { return s.researched.hulltech ? Math.round(R.expandCost / 2) : R.expandCost; }
  function overhaulCost(s, id) {
    return Math.round(D.MODULES[id].cost * R.overhaulRate * (s.researched.repairdrones ? 0.5 : 1));
  }
  function overhaulTurns(s) { return s.researched.repairdrones ? 1 : R.overhaulTurns; }
  function blockCap(s) { return s.researched.arcology ? R.blockCapArcology : R.blockCap; }
  function lightNow(s) {
    const p = currentPort(s);
    if (p) return D.PORTS[p.type].light;
    return D.LEGS[currentLeg(s).type].light;
  }
  function waveSpeed(s, turn) {
    const w = diffOf(s).wave;
    return w.speed + w.accel * (turn === undefined ? s.turn : turn);
  }

  /*
   * computeFlows: 現在の状態から、範囲供給・稼働状態・人口配置・生産・推力などを計算する。
   * 乱数を使わないので、UI の予測表示とターン処理の両方で使える。
   */
  function computeFlows(s) {
    const n = s.rows * s.cols;
    const res = s.researched;
    const mode = D.MODES[s.mode];
    const moving = mode.thrust > 0;
    const port = currentPort(s);
    const leg = currentLeg(s);
    const legDef = D.LEGS[leg.type];
    const light = lightNow(s);
    const info = new Array(n).fill(null);
    const mods = [];

    for (let i = 0; i < n; i++) {
      const cell = s.cells[i];
      if (!cell) continue;
      const def = D.MODULES[cell.id];
      const [r, c] = rc(s, i);
      let status;
      if (cell.build > 0) status = 'building';
      else if (cell.overhaul > 0) status = 'overhaul';
      else if (cell.broken) status = 'broken';
      else if (!cell.enabled) status = 'off';
      else if (!placementOk(s, s.hull, r, c, def.place)) status = 'blocked';
      else status = 'active';
      const m = { i, r, c, id: cell.id, def, cell, status, eff: 0, out: 0, notes: [], power: 0 };
      mods.push(m);
      info[i] = m;
    }
    const active = mods.filter(m => m.status === 'active');

    // 燃料：炉に優先して回し、残りを推進系へ
    let reactorFuelNeed = 0;
    for (const m of active) if (m.def.kind === 'reactor') reactorFuelNeed += m.def.fuel;
    const reactorFuelRatio = reactorFuelNeed > 0 ? Math.min(1, s.fuel / reactorFuelNeed) : 1;

    // 配電ノードの範囲
    const relay = new Array(n).fill(false);
    for (const m of active) {
      if (m.def.kind !== 'relay') continue;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (inGrid(s, m.r + dr, m.c + dc)) relay[idx(s, m.r + dr, m.c + dc)] = true;
      }
      m.eff = 1;
    }

    const fields = {};
    for (const f of D.FIELD_ORDER) fields[f] = new Array(n).fill(0);
    const emitters = [];
    function emit(m, field, strength, radius) {
      if (!strength) return;
      emitters.push({ i: m.i, r: m.r, c: m.c, id: m.id, field, strength, radius });
      const reach = field === 'power' ? radius + 1 : radius;
      for (let dr = -reach; dr <= reach; dr++) for (let dc = -reach; dc <= reach; dc++) {
        const r = m.r + dr, c = m.c + dc;
        if (!inGrid(s, r, c)) continue;
        const j = idx(s, r, c);
        const d = Math.max(Math.abs(dr), Math.abs(dc));
        let f;
        if (field === 'power' && relay[j]) f = d <= radius + 1 ? (D.RELAY_FALLOFF[d] || 0) : 0;
        else f = d <= radius ? (D.FALLOFF[d] || 0) : 0;
        if (f) fields[field][j] += strength * f;
      }
    }

    // 1. 発電（発電施設は電力を必要としない）
    for (const m of active) {
      const em = m.def.emit;
      if (!em || !em.power) continue;
      let k = 1;
      if (m.def.kind === 'reactor') k = reactorFuelRatio;
      else if (m.def.solar) k = light;
      m.eff = m.def.kind === 'reactor' ? reactorFuelRatio : 1;
      m.gen = em.power[0] * k;
      m.out = m.gen;
      emit(m, 'power', em.power[0] * k, em.power[1]);
    }

    // 2. 消費側の稼働率（このマスに届く電力で決まる）
    for (const m of active) {
      m.power = fields.power[m.i];
      if (m.def.emit && m.def.emit.power) continue;
      if (m.def.kind === 'relay') continue;
      const need = m.def.need || 0;
      if (need <= 0) m.eff = 1;
      else if (m.power >= need - 1e-9) m.eff = 1;
      else if (m.power >= need / 2 - 1e-9) { m.eff = 0.5; m.notes.push('電力不足（出力50%）'); }
      else { m.eff = 0; m.notes.push('電力不足で停止'); }
    }
    for (const m of mods) if (m.status !== 'active') m.power = fields.power[m.i];

    // 3. 電力以外の範囲供給
    for (const m of active) {
      const em = m.def.emit;
      if (!em || m.eff <= 0) continue;
      for (const f of D.FIELD_ORDER) {
        if (f === 'power' || !em[f]) continue;
        let k = m.eff;
        if (f === 'food' && res.genecrops) k *= 1.5;
        // 騒音・排熱は止まっていなければ出る
        if (f === 'comfort' && em[f][0] < 0) k = 1;
        emit(m, f, em[f][0] * k, em[f][1]);
      }
    }

    // シールドの範囲
    const shield = new Array(n).fill(false);
    for (const m of active) {
      if (!m.def.shieldR || m.eff <= 0) continue;
      for (let dr = -m.def.shieldR; dr <= m.def.shieldR; dr++) for (let dc = -m.def.shieldR; dc <= m.def.shieldR; dc++) {
        if (inGrid(s, m.r + dr, m.c + dc)) shield[idx(s, m.r + dr, m.c + dc)] = true;
      }
    }

    // 4. 居住ブロック
    const cap = blockCap(s);
    const envComfort = (port ? 4 : legDef.comfort);
    const blocks = [];
    for (let i = 0; i < n; i++) {
      if (!s.hull[i] || s.cells[i]) continue;
      const [r, c] = rc(s, i);
      const air = fields.air[i], food = fields.food[i], power = fields.power[i];
      const support = Math.max(0, Math.min(cap, Math.floor(air / R.airPerPerson + 1e-9), Math.floor(food / R.foodPerPerson + 1e-9)));
      let base = R.baseComfort + fields.comfort[i] + envComfort;
      const dark = power < 3;
      if (dark) base -= 8;
      blocks.push({ i, r, c, cap, air, food, power, lab: fields.lab[i], med: fields.med[i], support, baseComfort: base, dark, occ: 0, comfort: base, shielded: shield[i] });
    }
    // 快適なブロックから順に住む
    const order = blocks.slice().sort((a, b) => (b.baseComfort - a.baseComfort) || (a.i - b.i));
    let left = s.pop;
    for (const b of order) { b.occ = Math.min(b.support, left); left -= b.occ; }
    const overflow = Math.max(0, left);
    const support = blocks.reduce((a, b) => a + b.support, 0);
    let rpProd = 0, comfortSum = 0, growthCap = 0, births = 0;
    for (const b of blocks) {
      let cmf = b.baseComfort;
      if (b.occ > 0 && b.occ >= b.cap * 0.95) cmf -= 6;
      b.crowded = b.occ > 0 && b.occ >= b.cap * 0.95;
      b.comfort = Math.max(0, Math.min(100, cmf));
      const cf = b.comfort < 30 ? 0.5 : (b.comfort >= 70 ? 1.2 : 1);
      b.rp = b.occ * R.rpPerPerson * (1 + b.lab / 100) * cf;
      rpProd += b.rp;
      comfortSum += b.occ * b.comfort;
      if (b.occ > 0 && b.occ < b.support && b.comfort >= 30) {
        b.growth = b.occ * R.growth * (b.comfort >= 70 ? 1.5 : 1) * (1 + b.med / 100);
        births += b.growth;
        growthCap += b.support - b.occ;
      } else b.growth = 0;
    }
    births = Math.min(births, growthCap);

    // 士気の目標値＝住人の快適さの平均（あふれた人がいると下がる）
    const moraleParts = [];
    let moraleTarget = s.pop > 0 ? comfortSum / Math.max(1, s.pop - overflow) : R.baseComfort;
    if (s.pop - overflow <= 0) moraleTarget = 20;
    moraleParts.push(['居住ブロックの快適さ（平均）', moraleTarget]);
    if (overflow > 0) { moraleParts.push(['住む場所のない人', -10]); moraleTarget -= 10; }
    moraleTarget = Math.max(0, Math.min(100, moraleTarget));
    const moraleDelta = (moraleTarget - s.morale) * R.morale.rate;

    // 5. 推進
    const modeFuel = moving ? mode.fuel : 0;
    let engineFuelNeed = 0;
    const engines = active.filter(m => m.def.kind === 'engine' && m.eff > 0);
    for (const m of engines) {
      m.boosters = 0;
      for (const [dr, dc] of DIRS4) {
        const r = m.r + dr, c = m.c + dc;
        if (!inGrid(s, r, c)) continue;
        const o = info[idx(s, r, c)];
        if (o && o.status === 'active' && o.def.kind === 'booster' && o.eff > 0) { m.boosters += o.eff; o.boosting = (o.boosting || 0) + 1; }
      }
      m.fuelNeed = (m.def.fuel + 1.5 * m.boosters) * modeFuel;
      engineFuelNeed += m.fuelNeed;
    }
    const fuelLeft = Math.max(0, s.fuel - reactorFuelNeed * reactorFuelRatio);
    const engineFuelRatio = engineFuelNeed > 0 ? Math.min(1, fuelLeft / engineFuelNeed) : 1;
    let thrust = 0;
    for (const m of engines) {
      const fk = m.fuelNeed > 0 ? engineFuelRatio : 1;
      m.out = m.def.thrust * m.eff * (1 + 0.5 * m.boosters) * fk * mode.thrust;
      if (!moving) m.out = 0;
      thrust += m.out;
    }
    const fuelUse = reactorFuelNeed * reactorFuelRatio + engineFuelNeed * engineFuelRatio;
    const speed = moving ? R.drift + thrust : 0;

    // 6. 生産
    const harvestCap = { mat: 0, fuel: 0, rp: 0 };
    let matProd = 0, refIn = 0, refOut = 0, scoopOut = 0, shops = 0;
    for (const m of active) {
      if (m.eff <= 0) continue;
      const k = m.def.kind;
      if (k === 'lander') {
        if (port) {
          for (const k2 of ['mat', 'fuel', 'rp']) harvestCap[k2] += m.def.harvest[k2] * m.eff;
          m.out = m.def.harvest.mat * m.eff;
        }
        else { const v = legDef.mine * m.eff; matProd += v; m.out = v; }
      } else if (k === 'refinery') {
        refIn += m.def.refine.in * m.eff;
        refOut += m.def.refine.out * m.eff;
        if (!port && legDef.scoop) scoopOut += m.def.scoop * m.eff;
        m.out = m.def.refine.out * m.eff;
      } else if (k === 'shop') {
        if (m.eff >= 0.5) shops++;
      }
    }
    // 寄港中の採取量（埋蔵量で頭打ち）
    let harvest = { mat: 0, fuel: 0, rp: 0 };
    if (port) {
      harvest = {
        mat: Math.min(harvestCap.mat, port.mat),
        fuel: Math.min(harvestCap.fuel, port.fuel),
        rp: Math.min(harvestCap.rp, port.rp || 0)
      };
    }

    const capMat = { mat: R.baseCap.mat, fuel: R.baseCap.fuel };
    for (const m of mods) {
      if (m.def.store && m.status !== 'building') { capMat.mat += m.def.store.mat; capMat.fuel += m.def.store.fuel; }
    }
    const apMax = Math.min(R.maxAp, R.baseAp + shops);

    // 衝撃波
    const gap = s.dist - s.wave;
    const nextWave = waveSpeed(s);
    const closing = nextWave - speed;
    const waveEta = closing > 0 ? Math.max(0, Math.floor(gap / closing)) : null;

    return {
      info, mods, blocks, fields, emitters, relay, shield,
      reactorFuelRatio, engineFuelRatio, fuelUse, thrust, speed,
      support, overflow, births, rpProd, moraleParts, moraleTarget, moraleDelta,
      harvestCap, harvest, matProd, refIn, refOut, scoopOut, capMat, apMax,
      light, gap, waveSpeed: nextWave, waveEta
    };
  }

  /* 指定マス・フィールドの内訳（どの施設からどれだけ届いているか） */
  function fieldBreakdown(s, F, i, field) {
    const [r, c] = rc(s, i);
    const out = [];
    for (const e of F.emitters) {
      if (e.field !== field) continue;
      const d = cheb(e.r, e.c, r, c);
      let f;
      if (field === 'power' && F.relay[i]) f = d <= e.radius + 1 ? (D.RELAY_FALLOFF[d] || 0) : 0;
      else f = d <= e.radius ? (D.FALLOFF[d] || 0) : 0;
      if (f && e.i !== i) out.push({ i: e.i, id: e.id, amount: e.strength * f, d });
    }
    return out.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
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
    if (!def || def.fixed) return { ok: false, reason: '建造できないモジュールです' };
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

  /* 建てたら何が変わるか（完成後の状態で比べる） */
  function previewBuild(s, r, c, id) {
    const chk = canBuild(s, r, c, id);
    if (!chk.ok && !/作業回数|資材/.test(chk.reason)) return chk;
    const i = idx(s, r, c);
    const t = clone(s);
    t.pendingEvent = null;
    t.cells[i] = makeCell(id, true);
    const F0 = computeFlows(s), F1 = computeFlows(t);
    const m = F1.info[i];
    return {
      ok: chk.ok, reason: chk.reason,
      powerAt: m.power, need: m.def.need || 0, eff: m.eff,
      support: F1.support - F0.support,
      rp: F1.rpProd - F0.rpProd,
      speed: F1.speed - F0.speed,
      morale: F1.moraleTarget - F0.moraleTarget,
      overflow: F1.overflow,
      footprint: footprint(s, id, r, c)
    };
  }

  function footprint(s, id, r, c) {
    const def = D.MODULES[id];
    let rad = 0;
    if (def.emit) for (const f in def.emit) rad = Math.max(rad, def.emit[f][1]);
    if (def.shieldR) rad = Math.max(rad, def.shieldR);
    if (def.kind === 'relay') rad = 1;
    const out = [];
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      if ((dr || dc) && inGrid(s, r + dr, c + dc)) out.push(idx(s, r + dr, c + dc));
    }
    if (def.kind === 'booster') {
      out.length = 0;
      for (const [dr, dc] of DIRS4) if (inGrid(s, r + dr, c + dc)) out.push(idx(s, r + dr, c + dc));
    }
    return out;
  }

  function demolishRefund(s, r, c) {
    const cell = s.cells[idx(s, r, c)];
    if (!cell) return 0;
    const def = D.MODULES[cell.id];
    return Math.floor(def.cost * (cell.build > 0 ? 0.8 : 0.4));
  }
  function canDemolish(s, r, c) {
    const a = canAct(s); if (!a.ok) return a;
    const cell = inGrid(s, r, c) ? s.cells[idx(s, r, c)] : null;
    if (!cell) return { ok: false, reason: 'モジュールがありません' };
    if (D.MODULES[cell.id].fixed) return { ok: false, reason: '艦橋は撤去できません' };
    if (s.ap < 1) return { ok: false, reason: '作業回数が残っていません' };
    return { ok: true };
  }
  function demolish(s, r, c) {
    const chk = canDemolish(s, r, c); if (!chk.ok) return chk;
    const i = idx(s, r, c);
    const def = D.MODULES[s.cells[i].id];
    const refund = demolishRefund(s, r, c);
    const capM = computeFlows(s).capMat.mat;
    s.mat = Math.min(capM, s.mat + refund);
    s.cells[i] = null;
    s.ap -= 1;
    addLog(s, def.name + 'を撤去（資材+' + refund + '）。区画は居住ブロックに戻った', 'build');
    return { ok: true };
  }

  function canRepair(s, r, c) {
    const a = canAct(s); if (!a.ok) return a;
    const cell = inGrid(s, r, c) ? s.cells[idx(s, r, c)] : null;
    if (!cell) return { ok: false, reason: 'モジュールがありません' };
    if (!cell.broken) return { ok: false, reason: '故障していません（寿命を戻すには改修）' };
    if (s.ap < 1) return { ok: false, reason: '作業回数が残っていません' };
    if (s.mat < R.repairCost) return { ok: false, reason: '資材が足りません（' + R.repairCost + '必要）' };
    return { ok: true };
  }
  function repair(s, r, c) {
    const chk = canRepair(s, r, c); if (!chk.ok) return chk;
    const cell = s.cells[idx(s, r, c)];
    s.mat -= R.repairCost;
    s.ap -= 1;
    cell.broken = false;
    s.stats.repaired++;
    addLog(s, D.MODULES[cell.id].name + 'を応急修理して再稼働させた（老朽化はそのまま）', 'build');
    return { ok: true };
  }

  function canOverhaul(s, r, c) {
    const a = canAct(s); if (!a.ok) return a;
    const cell = inGrid(s, r, c) ? s.cells[idx(s, r, c)] : null;
    if (!cell) return { ok: false, reason: 'モジュールがありません' };
    const def = D.MODULES[cell.id];
    if (def.fixed) return { ok: false, reason: '艦橋は改修の必要がありません' };
    if (cell.build > 0) return { ok: false, reason: '建造中です' };
    if (cell.overhaul > 0) return { ok: false, reason: '改修中です' };
    if (cell.age < 1 && !cell.broken) return { ok: false, reason: '新品同様です' };
    if (s.ap < 1) return { ok: false, reason: '作業回数が残っていません' };
    const cost = overhaulCost(s, cell.id);
    if (s.mat < cost) return { ok: false, reason: '資材が足りません（' + cost + '必要）' };
    return { ok: true };
  }
  function overhaul(s, r, c) {
    const chk = canOverhaul(s, r, c); if (!chk.ok) return chk;
    const cell = s.cells[idx(s, r, c)];
    const cost = overhaulCost(s, cell.id);
    s.mat -= cost;
    s.ap -= 1;
    cell.overhaul = overhaulTurns(s);
    cell.broken = false;
    s.stats.overhauled++;
    addLog(s, D.MODULES[cell.id].name + 'の改修を開始（' + cell.overhaul + 'ターン停止・資材-' + cost + '）', 'build');
    return { ok: true };
  }

  function toggle(s, r, c) {
    const a = canAct(s); if (!a.ok) return a;
    const cell = inGrid(s, r, c) ? s.cells[idx(s, r, c)] : null;
    if (!cell) return { ok: false, reason: 'モジュールがありません' };
    if (D.MODULES[cell.id].fixed) return { ok: false, reason: '艦橋は止められません' };
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
    addLog(s, '外殻を拡張した（資材-' + cost + '）。新しい居住ブロックができた', 'build');
    return { ok: true };
  }

  function canResearch(s, id) {
    const a = canAct(s); if (!a.ok) return a;
    const def = D.RESEARCH[id];
    if (!def) return { ok: false, reason: '不明な研究' };
    if (s.researched[id]) return { ok: false, reason: '研究済み' };
    if (def.requires && !s.researched[def.requires]) return { ok: false, reason: '先に「' + D.RESEARCH[def.requires].name + '」が必要' };
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

  /* 航行モード。寄港中に巡航・全速を選ぶと出発する */
  function setMode(s, mode) {
    if (!D.MODES[mode]) return { ok: false, reason: '不明なモード' };
    const a = canAct(s); if (!a.ok) return a;
    if (mode === 'orbit') {
      if (s.portIndex < 0) return { ok: false, reason: '停泊できるのは寄港地だけです' };
      s.mode = 'orbit';
      return { ok: true };
    }
    if (s.portIndex >= 0) {
      const p = currentPort(s);
      p.visited = true;
      addLog(s, p.name + 'を出発した', 'sector');
      s.portIndex = -1;
    }
    s.mode = mode;
    return { ok: true };
  }

  /* 次の寄港地に寄るかどうか */
  function setSkipNext(s, skip) {
    const k = nextPortIndex(s);
    if (k < 0) return { ok: false, reason: 'この先に寄港地はありません' };
    s.route.ports[k].skip = !!skip;
    return { ok: true };
  }

  /* ---------- 被害 ---------- */
  function breakModule(s, i, F, log, label) {
    const cell = s.cells[i];
    if (!cell) return false;
    const def = D.MODULES[cell.id];
    if (def.fixed) return false;
    if (cell.build > 0) { cell.build += 1; log.push(def.name + '（建造中）が' + label + 'を受け、工期が1ターン延びた'); return true; }
    if (F.shield[i]) { cell.age += 6; log.push(def.name + 'に' + label + '。シールドが防いだ（老朽化がわずかに進行）'); return true; }
    if (!cell.broken) { cell.broken = true; log.push(def.name + 'が' + label + 'で故障した！'); }
    cell.age += 8;
    return true;
  }
  function hurtBlock(s, F, i, lo, hi, log, label) {
    const b = F.blocks.find(x => x.i === i);
    if (!b || b.occ <= 0) return 0;
    let loss = Math.round(randInt(s, lo, hi) * diffOf(s).eventDamage * (s.researched.scanner ? 0.7 : 1));
    if (b.shielded) loss = Math.floor(loss / 4);
    loss = Math.min(b.occ, s.pop, loss);
    if (loss > 0) { s.pop -= loss; s.stats.lost += loss; log.push('居住ブロックに' + label + '。住人' + loss + '人が犠牲に' + (b.shielded ? '（シールドで軽減）' : '')); }
    return loss;
  }

  function hullCells(s) { const a = []; for (let i = 0; i < s.hull.length; i++) if (s.hull[i]) a.push(i); return a; }
  function moduleCells(s, pred) {
    const a = [];
    for (let i = 0; i < s.cells.length; i++) {
      const c = s.cells[i];
      if (c && !D.MODULES[c.id].fixed && (!pred || pred(c, D.MODULES[c.id], i))) a.push(i);
    }
    return a;
  }
  const working = (s, kind) => moduleCells(s, (c, d) => d.kind === kind && c.build === 0 && !c.broken && c.overhaul === 0 && c.enabled).length;

  /* ---------- イベント ---------- */
  function placeType(s) {
    const p = currentPort(s);
    return p ? 'port:' + p.type : currentLeg(s).type;
  }

  const EVENTS = [
    {
      id: 'meteor', weight: (s, t) => ({ asteroid: 6, derelict: 2, normal: 0.8, nebula: 0.5 })[t] || 0,
      run(s, F, log) {
        const hits = randInt(s, 1, 3);
        log.push('☄ 微小隕石群が船体を直撃した！');
        const cells = hullCells(s);
        for (let k = 0; k < hits; k++) {
          const i = pick(s, cells);
          if (s.cells[i]) {
            if (rand(s) < (s.researched.scanner ? 0.3 : 0)) { log.push('スキャナが軌道を予測し、回避した'); continue; }
            breakModule(s, i, F, log, '隕石の直撃');
          } else if (!hurtBlock(s, F, i, 2, 6, log, '隕石が直撃')) log.push('無人の区画に命中。被害なし');
        }
        return 'danger';
      }
    },
    {
      id: 'flare', weight: (s, t) => ({ 'port:star': 5, normal: 0.3 })[t] || 0,
      run(s, F, log) {
        log.push('☀ 恒星フレアが襲来！ 外縁の区画が高エネルギー粒子に晒された');
        let n = 0;
        for (let i = 0; i < s.hull.length; i++) {
          if (!s.hull[i]) continue;
          const [r, c] = rc(s, i);
          if (!isEdge(s, s.hull, r, c) || rand(s) > 0.45 * diffOf(s).eventDamage) continue;
          n++;
          if (s.cells[i]) breakModule(s, i, F, log, 'フレア');
          else hurtBlock(s, F, i, 1, 4, log, 'フレアが到達');
        }
        if (!n) log.push('幸い、被害は軽微だった');
        return 'danger';
      }
    },
    {
      id: 'malfunction', weight: () => 1.1,
      run(s, F, log) {
        const list = moduleCells(s, c => c.build === 0 && !c.broken && c.overhaul === 0);
        if (!list.length) return null;
        const i = pick(s, list);
        const cell = s.cells[i];
        cell.broken = true;
        log.push('⚙ ' + D.MODULES[cell.id].name + 'で部品が破損し、停止した');
        return 'warn';
      }
    },
    {
      id: 'plague', weight: (s) => (computeFlows(s).overflow > 0 ? 1.6 : 0.4),
      run(s, F, log) {
        const covered = F.blocks.filter(b => b.med > 0).reduce((a, b) => a + b.occ, 0);
        const frac = s.pop > 0 ? covered / s.pop : 0;
        const rate = 0.08 * (1 - 0.65 * frac) * diffOf(s).eventDamage;
        const loss = Math.max(1, Math.round(s.pop * rate));
        s.pop = Math.max(0, s.pop - loss); s.stats.lost += loss;
        s.morale = Math.max(0, s.morale - 5);
        log.push('☣ 船内で疫病が流行。' + loss + '人が亡くなった' + (frac > 0 ? '（医務室が被害を抑えた）' : '') + '　士気-5');
        return 'danger';
      }
    },
    {
      id: 'babyboom', weight: (s) => (s.morale >= 60 ? 0.6 : 0),
      run(s, F, log) {
        const room = Math.max(0, F.support - s.pop);
        const born = Math.min(room, randInt(s, 4, 9));
        if (born <= 0) { log.push('出産を望む声が多いが、住める場所に空きがない'); s.morale = Math.max(0, s.morale - 2); return 'warn'; }
        s.pop += born; s.stats.born += born;
        s.morale = Math.min(100, s.morale + 3);
        log.push('👶 ベビーラッシュ！ ' + born + '人の新しい命が生まれた　士気+3');
        return 'good';
      }
    },
    {
      id: 'festival', weight: (s) => (s.morale >= 72 ? 0.6 : 0),
      run(s, F, log) {
        s.morale = Math.min(100, s.morale + 6);
        s.rp += 10;
        log.push('🎉 出航記念祭が開かれた。士気+6、交流から生まれたアイデアで研究+10');
        return 'good';
      }
    },
    {
      id: 'unrest', weight: (s) => (s.morale < 35 ? 3 : 0),
      run(s, F, log) {
        log.push('✊ 不満を募らせた乗員が暴動を起こした！ 次ターンの作業回数-1');
        s.apPenalty = 1;
        const list = moduleCells(s, c => c.build === 0 && !c.broken && c.overhaul === 0);
        if (list.length) {
          const i = pick(s, list);
          s.cells[i].broken = true;
          log.push(D.MODULES[s.cells[i].id].name + 'が破壊工作を受けて停止した');
        }
        return 'danger';
      }
    },
    {
      id: 'gas', weight: (s, t) => (t === 'nebula' ? 4 : 0),
      run(s, F, log) {
        const refs = working(s, 'refinery');
        const gain = 12 + refs * 20;
        s.fuel = Math.min(F.capMat.fuel, s.fuel + gain);
        log.push('🌫 濃密なガス雲を通過。燃料+' + gain + (refs ? '（精製所が効率よく回収）' : ''));
        return 'good';
      }
    },
    {
      id: 'ore', weight: (s, t) => ({ asteroid: 3, derelict: 1 })[t] || 0,
      run(s, F, log) {
        const ld = working(s, 'lander');
        const gain = ld ? randInt(s, 30, 60) : randInt(s, 6, 12);
        s.mat = Math.min(F.capMat.mat, s.mat + gain);
        log.push('⛏ 金属に富んだ岩塊を捕捉。資材+' + gain + (ld ? '' : '（降下艇があればもっと回収できた）'));
        return 'good';
      }
    },
    {
      id: 'calm', weight: (s, t) => ({ normal: 1.6, 'port:rock': 1, 'port:ice': 1, 'port:station': 0.6 })[t] || 0,
      run(s, F, log) {
        s.morale = Math.min(100, s.morale + 2);
        log.push(pick(s, [
          '穏やかな時間が流れる。展望窓の星々に乗員が安らいだ　士気+2',
          '子どもたちが船内で星座づくりのコンテストを開いた　士気+2',
          '古い記録映像の上映会が開かれた。母星を懐かしむ声も　士気+2'
        ]));
        return 'good';
      }
    },
    {
      id: 'silence', weight: (s, t) => (t === 'void' ? 3 : 0),
      run(s, F, log) {
        const soothed = working(s, 'lounge') > 0;
        const d = soothed ? 2 : 6;
        s.morale = Math.max(0, s.morale - d);
        log.push('🌑 何も見えない闇が続き、乗員の間に閉塞感が広がる　士気-' + d + (soothed ? '（ラウンジが和らげた）' : ''));
        return 'warn';
      }
    },
    /* --- 選択イベント --- */
    {
      id: 'derelict', choice: true, weight: (s, t) => ({ derelict: 5, void: 0.8, normal: 0.5, 'port:station': 2 })[t] || 0,
      make() {
        return {
          title: '漂流船の発見',
          text: '識別信号の途絶えた古い輸送船が漂っている。中に何が残っているかは分からない。',
          choices: [
            { label: '調査隊を送り込む', hint: '7割で資材と研究データ。失敗すると犠牲者が出る' },
            { label: '牽引して解体する', hint: '燃料20を使い、資材40を確実に回収' },
            { label: '関わらずに進む', hint: '何も起きない' }
          ]
        };
      },
      resolve(s, k, F, log) {
        if (k === 0) {
          if (rand(s) < 0.7) {
            const m = randInt(s, 60, 120), r = randInt(s, 15, 30);
            s.mat = Math.min(F.capMat.mat, s.mat + m); s.rp += r;
            log.push('調査隊は貴重な物資を持ち帰った。資材+' + m + '、研究+' + r);
            return 'good';
          }
          const loss = Math.min(s.pop, Math.round(randInt(s, 4, 10) * diffOf(s).eventDamage));
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
      id: 'refugees', choice: true, weight: (s, t) => ({ normal: 0.5, derelict: 0.8, asteroid: 0.3, 'port:rock': 0.5, 'port:ice': 0.5 })[t] || 0,
      make(s) {
        const n = randInt(s, 12, 22);
        const room = Math.max(0, computeFlows(s).support - s.pop);
        return {
          title: '救難信号',
          text: '損傷した移民船から救難信号。生存者' + n + '人が受け入れを求めている。（いま住める空き：' + room + '人）',
          data: { n },
          choices: [
            { label: '全員を受け入れる', hint: '人口+' + n + '・士気+4。空きが足りないと、あふれた人は失われていく' },
            { label: '物資だけ送る', hint: '資材-30・燃料-20・士気+1' },
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
          s.mat = Math.max(0, s.mat - 30); s.fuel = Math.max(0, s.fuel - 20); s.morale = Math.min(100, s.morale + 1);
          log.push('物資を送り届けた。彼らの無事を祈る　士気+1');
          return 'info';
        }
        s.morale = Math.max(0, s.morale - 6);
        log.push('救難信号は次第に弱まり、やがて途絶えた　士気-6');
        return 'warn';
      }
    },
    {
      id: 'signal', choice: true, weight: (s, t) => ({ void: 3, nebula: 1, normal: 0.4 })[t] || 0,
      make() {
        return {
          title: '未知の信号',
          text: '規則的なパルス信号を受信した。自然現象とは思えないパターンだ。',
          choices: [
            { label: '研究班に解析させる', hint: '研究+30〜60。内容次第で士気が下がることも' },
            { label: '記録だけ残して無視する', hint: '研究+5' }
          ]
        };
      },
      resolve(s, k, F, log) {
        if (k === 0) {
          const r = randInt(s, 30, 60);
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
      id: 'slingshot', choice: true, weight: (s, t) => (t === 'port:gas' ? 2.5 : 0),
      make() {
        return {
          title: 'スイングバイの好機',
          text: 'ガス巨星の重力を利用すれば、大きく加速して出発できる。ただし軌道計算を誤れば推進器に負荷がかかる。',
          choices: [
            { label: 'スイングバイで出発する', hint: '今すぐ出発し、+80〜140光年。3割で推進器が故障' },
            { label: 'まだとどまる', hint: '何も起きない' }
          ]
        };
      },
      resolve(s, k, F, log) {
        if (k === 0) {
          const d = randInt(s, 80, 140);
          const p = currentPort(s);
          if (p) { p.visited = true; s.portIndex = -1; }
          s.mode = 'cruise';
          s.dist = Math.min(R.totalDistance, s.dist + d);
          log.push('重力の腕に乗って加速！ ' + d + '光年前進して出発した');
          if (rand(s) < 0.3) {
            for (const i of moduleCells(s, (c, def) => def.kind === 'engine' && c.build === 0)) { s.cells[i].broken = true; s.cells[i].age += 6; }
            log.push('急激な重力変化で推進器が故障した。修理が必要');
            return 'warn';
          }
          return 'good';
        }
        log.push('軌道にとどまった');
        return 'info';
      }
    }
  ];
  const EVENT_BY_ID = Object.fromEntries(EVENTS.map(e => [e.id, e]));

  function rollEvent(s, out) {
    const t = placeType(s);
    const chance = currentPort(s) ? 0.22 : D.LEGS[currentLeg(s).type].event;
    if (rand(s) >= chance) return;
    const ws = EVENTS.map(e => Math.max(0, e.weight(s, t) || 0));
    const total = ws.reduce((a, b) => a + b, 0);
    if (total <= 0) return;
    let x = rand(s) * total;
    let ev = EVENTS[EVENTS.length - 1];
    for (let k = 0; k < EVENTS.length; k++) { x -= ws[k]; if (x <= 0) { ev = EVENTS[k]; break; } }
    const F = computeFlows(s);
    if (ev.choice) {
      const p = ev.make(s);
      s.pendingEvent = { id: ev.id, title: p.title, text: p.text, choices: p.choices, data: p.data || null };
      out.push({ text: '❗ ' + p.title + '：' + p.text, kind: 'event' });
      return;
    }
    const lines = [];
    const kind = ev.run(s, F, lines);
    for (const text of lines) out.push({ text, kind: kind || 'info' });
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
    if (s.status === 'playing' && s.portIndex < 0 && s.mode === 'orbit') s.mode = 'cruise';
    return { ok: true, lines, kind };
  }

  /* ---------- ターン進行 ---------- */
  function endTurn(s) {
    const a = canAct(s); if (!a.ok) return a;
    const F = computeFlows(s);
    const mode = D.MODES[s.mode];
    const out = [];
    const push = (text, kind) => out.push({ text, kind: kind || 'info' });
    const before = { pop: s.pop, mat: s.mat, fuel: s.fuel, rp: s.rp, dist: s.dist };

    // 資源
    const port = currentPort(s);
    let matGain = F.matProd + F.harvest.mat;
    let fuelGain = F.harvest.fuel;
    if (port) {
      port.mat -= F.harvest.mat; port.fuel -= F.harvest.fuel; port.rp = (port.rp || 0) - F.harvest.rp;
      s.stats.harvested += F.harvest.mat + F.harvest.fuel;
      if (F.harvestCap.mat > 0 && port.mat <= 0 && port.fuel <= 0 && !port.drained) {
        port.drained = true;
        push(port.name + 'の資源を採り尽くした。出発しよう', 'warn');
      }
    }
    const matAvail = s.mat + matGain;
    const refScale = F.refIn > 0 ? Math.min(1, matAvail / F.refIn) : 1;
    s.mat = Math.min(F.capMat.mat, Math.max(0, matAvail - F.refIn * refScale));
    s.fuel = Math.min(F.capMat.fuel, Math.max(0, s.fuel - F.fuelUse + F.refOut * refScale + F.scoopOut + fuelGain));
    s.rp += F.rpProd + F.harvest.rp;

    // 人口：住む場所のない人は失われ、空きのある快適なブロックでは増える
    let deaths = 0, born = 0;
    if (F.overflow > 0) {
      deaths = Math.min(s.pop, Math.max(1, Math.ceil(F.overflow * R.overflowLoss)));
      push('🫁 空気や食料が届かず、住む場所のない人が' + F.overflow + '人いる。' + deaths + '人が亡くなった', 'danger');
    } else {
      born = roundRandom(s, F.births);
    }
    s.pop = Math.max(0, s.pop - deaths + born);
    s.stats.lost += deaths; s.stats.born += born;
    s.stats.maxPop = Math.max(s.stats.maxPop, s.pop);

    // 士気
    s.morale = Math.max(0, Math.min(100, s.morale + F.moraleDelta));

    // 航行
    const legBefore = legIndexAt(s, s.dist);
    if (s.mode !== 'orbit') {
      let nd = s.dist + F.speed;
      const k = nextPortIndex(s);
      const p = k >= 0 ? s.route.ports[k] : null;
      if (p && !p.skip && !p.visited && nd >= p.pos) {
        nd = p.pos;
        s.portIndex = k;
        s.mode = 'orbit';
        s.stats.ports++;
        const pd = D.PORTS[p.type];
        push('🪐 ' + p.name + '（' + pd.name + '）の軌道に入った。' + pd.desc + ' 降下艇で資源を採れる。出発するときは「巡航で出発」か「全速で出発」', 'sector');
      } else if (p && p.skip && nd >= p.pos) {
        p.visited = true;
        push(p.name + 'には寄らずに通過した', 'sector');
      }
      s.dist = Math.min(R.totalDistance, nd);
    }
    const legAfter = legIndexAt(s, s.dist);
    if (legAfter !== legBefore && s.portIndex < 0) {
      const ld = D.LEGS[s.route.legs[legAfter].type];
      push('🛰 ' + ld.name + 'に入った。' + ld.desc, 'sector');
    }
    if (before.dist < R.totalDistance / 2 && s.dist >= R.totalDistance / 2) push('航程の半分を越えた。船内に小さな歓声が上がった', 'story');

    // 建造・改修の進行と老朽化
    for (let i = 0; i < s.cells.length; i++) {
      const cell = s.cells[i];
      if (!cell) continue;
      const def = D.MODULES[cell.id];
      if (def.fixed) continue;
      if (cell.build > 0) {
        cell.build--;
        if (cell.build === 0) push('🔧 ' + def.name + 'が完成した', 'build');
        continue;
      }
      if (cell.overhaul > 0) {
        cell.overhaul--;
        if (cell.overhaul === 0) { cell.age = 0; cell.broken = false; push('🔧 ' + def.name + 'の改修が終わり、新品同様になった', 'build'); }
        continue;
      }
      const m = F.info[i];
      if (!m || m.status !== 'active' || cell.broken) continue;
      let ageRate = m.eff > 0 ? 1 : 0.3;
      if (def.kind === 'engine' || def.kind === 'booster') ageRate *= mode.age;
      cell.age += ageRate;
      if (rand(s) < breakChance(s, cell)) {
        cell.broken = true;
        const worn = wearLevel(s, cell) >= R.wearStart;
        push('⚠ ' + def.name + 'が' + (worn ? '老朽化で' : '') + '故障した。修理か改修が必要', 'danger');
      }
    }

    // 衝撃波
    s.wave += waveSpeed(s);
    if (s.wave >= s.dist && s.dist < R.totalDistance) {
      const F2 = computeFlows(s);
      const lines = [];
      lines.push('💥 恒星の衝撃波に呑まれた！ 船体が激しく揺さぶられている');
      for (const i of moduleCells(s, c => c.build === 0)) {
        if (rand(s) < (F2.shield[i] ? 0.06 : 0.35)) breakModule(s, i, F2, lines, '衝撃波');
      }
      const shieldedOcc = F2.blocks.filter(b => b.shielded).reduce((a, b) => a + b.occ, 0);
      const frac = s.pop > 0 ? shieldedOcc / s.pop : 0;
      const loss = Math.min(s.pop, Math.ceil(s.pop * 0.1 * (1 - 0.7 * frac) * diffOf(s).eventDamage));
      s.pop -= loss; s.stats.lost += loss;
      s.morale = Math.max(0, s.morale - 10);
      lines.push('乗員' + loss + '人が犠牲になった。速度を上げて振り切らなければならない　士気-10');
      for (const t of lines) push(t, 'danger');
    }

    // イベント
    if (s.dist < R.totalDistance && s.pop > 0) rollEvent(s, out);

    for (const o of out) addLog(s, o.text, o.kind);

    // 次のターンへ
    s.turn++;
    s.summary = {
      turn: s.turn - 1, births: born, deaths, popDelta: s.pop - before.pop,
      dist: s.dist - before.dist, mat: s.mat - before.mat, fuel: s.fuel - before.fuel, rp: s.rp - before.rp,
      gap: s.dist - s.wave
    };
    checkEnd(s);
    if (s.status === 'playing') {
      const F2 = computeFlows(s);
      s.ap = Math.max(0, F2.apMax - s.apPenalty);
      s.apPenalty = 0;
      warnings(s, F2);
    }
    return { ok: true };
  }

  function warnings(s, F) {
    s.warned = s.warned || {};
    const warn = (key, cond, text) => {
      if (!cond) return;
      if (s.warned[key] && s.turn - s.warned[key] < 5) return;
      s.warned[key] = s.turn;
      addLog(s, text, 'warn');
    };
    const net = F.refOut + F.scoopOut + F.harvest.fuel - F.fuelUse;
    warn('fuel', net < 0 && s.fuel < -net * 6, '燃料の残りが少なくなっています。寄港地で補給するか、精製所を');
    warn('wave', F.waveEta !== null && F.waveEta <= 4 && F.gap > 0, '衝撃波がすぐ後ろに迫っています（約' + F.waveEta + 'ターン）。出発するか、速度を上げて');
    warn('power', F.mods.some(m => m.status === 'active' && m.eff < 1 && (m.def.need || 0) > 0), '電力が届かず、出力の落ちている施設があります');
    warn('room', F.support - s.pop <= 0 && F.overflow === 0, '居住ブロックが満員です。空気と食料の届く空きマスを増やすと人口が増えます');
    const worn = F.mods.filter(m => m.status === 'active' && wearLevel(s, m.cell) >= 0.85).length;
    warn('worn', worn >= 2, '寿命の近い施設が' + worn + 'つあります。改修すると新品同様に戻ります');
  }

  function computeScore(s) {
    const diff = diffOf(s);
    const raw = s.pop * 10 + s.morale * 3 + Math.max(0, 220 - s.turn) * 15;
    const score = Math.round(raw * diff.scoreMult);
    let rank = 'C';
    if (score >= 4200) rank = 'S';
    else if (score >= 3200) rank = 'A';
    else if (score >= 2200) rank = 'B';
    return { score, rank, pop: s.pop, morale: Math.round(s.morale), turn: s.turn, difficulty: s.difficulty };
  }

  function checkEnd(s) {
    if (s.status !== 'playing') return;
    if (s.pop <= 0) {
      s.pop = 0;
      s.status = 'lost';
      s.endReason = s.wave >= s.dist ? '恒星の衝撃波が方舟を呑み込み、最後の灯が消えた。' : '最後の乗員が息を引き取り、方舟は沈黙した。';
      addLog(s, s.endReason, 'danger');
      return;
    }
    if (s.dist >= R.totalDistance) {
      s.dist = R.totalDistance;
      s.status = 'won';
      s.pendingEvent = null;
      s.score = computeScore(s);
      s.endReason = (s.turn - 1) + 'ターン目、方舟は惑星ヴェルダの軌道に到達した。' + s.pop + '人の入植者が新天地に降り立つ。';
      addLog(s, s.endReason, 'story');
      return;
    }
    if (s.turn > R.maxTurns) {
      s.status = 'lost';
      s.endReason = '航海は' + R.maxTurns + 'ターンを越えた。世代を重ねるうちに航行の目的は忘れ去られた…';
      addLog(s, s.endReason, 'danger');
    }
  }

  /* ---------- セーブ ---------- */
  function serialize(s) { return JSON.stringify(s); }
  function deserialize(str) {
    const s = JSON.parse(str);
    if (!s || s.version !== SAVE_VERSION || !Array.isArray(s.cells) || !s.route) {
      throw new Error('セーブデータの形式が違います');
    }
    return s;
  }

  return {
    D, newGame, computeFlows, fieldBreakdown, endTurn, resolveEvent, clone,
    canBuild, build, previewBuild, footprint, canDemolish, demolish, demolishRefund,
    canRepair, repair, canOverhaul, overhaul, overhaulCost, overhaulTurns, toggle,
    canExpand, expand, expandCost, canResearch, research, setMode, setSkipNext,
    currentLeg, currentPort, nextPortIndex, legIndexAt, isUnlocked, isEdge, isRear, placementOk, placementLabel,
    lifespan, wearLevel, breakChance, scanRange, hullCount, blockCap, waveSpeed,
    serialize, deserialize, computeScore, idx, rc, inGrid, EVENTS, rand
  };
});

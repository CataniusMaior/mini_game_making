/*
 * DRIFT ARK — 静的データ定義
 * モジュール・研究・宙域・航行モードなど、ゲームの数値はここにまとめる。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ArkData = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROWS = 7;
  const COLS = 7;

  /*
   * モジュール定義
   *  cost      : 建造に必要な資材
   *  build     : 完成までのターン数
   *  powerGen  : 発電量
   *  powerUse  : 消費電力
   *  workers   : 必要な人手（人口から割り当て）
   *  mass      : 質量（重いほど船速が落ちる）
   *  wear      : 1ターンあたりの平均劣化量
   *  place     : 'any' | 'edge'（外縁）| 'rear'（船尾：左隣が船外）
   *  priority  : 電力不足時の優先度（大きいほど優先して給電）
   *  research  : 解放に必要な研究ID（なければ最初から建造可）
   */
  const MODULES = {
    hab: {
      name: '居住区', glyph: '居', kind: 'hab', color: '#e0a458',
      cost: 40, build: 2, powerUse: 1, workers: 0, mass: 2, wear: 0.7,
      place: 'any', priority: 90, cap: 30,
      desc: '30人が暮らせる区画。酸素供給の範囲内でなければ住めない。電力が止まると収容力が半減する。'
    },
    life: {
      name: '生命維持装置', glyph: '気', kind: 'life', color: '#4fd1c5',
      cost: 50, build: 2, powerUse: 2, workers: 6, mass: 2, wear: 0.9,
      place: 'any', priority: 100, o2: 1,
      desc: '周囲1マス（3×3）に酸素を供給する。隣接する水耕農場の収穫を増やす。'
    },
    farm: {
      name: '水耕農場', glyph: '農', kind: 'farm', color: '#68d391',
      cost: 45, build: 2, powerUse: 2, workers: 10, mass: 2, wear: 0.8,
      place: 'any', priority: 85, food: 6,
      desc: '食料を6生産。上下左右に隣接する生命維持装置・バイオドーム1つにつき+2。'
    },
    reactor: {
      name: '核分裂炉', glyph: '炉', kind: 'reactor', color: '#f6e05e',
      cost: 70, build: 3, powerGen: 10, workers: 10, mass: 3, wear: 1.1,
      place: 'any', priority: 0, fuel: 0.5, heat: true,
      desc: '燃料0.5を消費して10発電。隣接する推進器の推力+20%。隣接する居住区は排熱で士気が下がる。'
    },
    solar: {
      name: '集光パネル', glyph: '光', kind: 'solar', color: '#faf089',
      cost: 35, build: 1, powerGen: 4, workers: 0, mass: 1, wear: 0.6,
      place: 'edge', priority: 0,
      desc: '外縁にのみ設置可。4発電するが、宙域の明るさで出力が変わる。'
    },
    engine: {
      name: '推進器', glyph: '推', kind: 'engine', color: '#f6865e',
      cost: 60, build: 3, powerUse: 3, workers: 12, mass: 3, wear: 1.2,
      place: 'rear', priority: 60, thrust: 10, fuel: 1.5,
      desc: '船尾（左隣が船外のマス）にのみ設置可。燃料1.5を消費して推力10を出す。'
    },
    storage: {
      name: '貯蔵庫', glyph: '庫', kind: 'storage', color: '#a0aec0',
      cost: 30, build: 1, powerUse: 0, workers: 0, mass: 1, wear: 0.3,
      place: 'any', priority: 0, store: { mat: 150, fuel: 150, food: 100 },
      desc: '資材・燃料の上限+150、食料の上限+100。'
    },
    lab: {
      name: '研究ラボ', glyph: '研', kind: 'lab', color: '#b794f4',
      cost: 55, build: 2, powerUse: 2, workers: 15, mass: 2, wear: 0.8,
      place: 'any', priority: 20, rp: 3,
      desc: '研究ポイントを3生産。隣接する研究ラボ1つにつき+1。'
    },
    shop: {
      name: '工房', glyph: '工', kind: 'shop', color: '#90cdf4',
      cost: 50, build: 2, powerUse: 1, workers: 10, mass: 2, wear: 0.8,
      place: 'any', priority: 40, ap: 1,
      desc: '1ターンに行える作業回数+1（最大5）。'
    },
    drone: {
      name: 'ドローン格納庫', glyph: '機', kind: 'drone', color: '#d69e2e',
      cost: 50, build: 2, powerUse: 1, workers: 6, mass: 2, wear: 0.9,
      place: 'edge', priority: 50, mine: 4,
      desc: '外縁にのみ設置可。資材を4採取。小惑星帯や恒星系では採取量が増え、停泊中は2倍。'
    },
    refinery: {
      name: '燃料精製所', glyph: '精', kind: 'refinery', color: '#c6a15b',
      cost: 60, build: 2, powerUse: 2, workers: 8, mass: 2, wear: 0.9,
      place: 'any', priority: 45, refine: { in: 3, out: 4 }, scoop: 5,
      desc: '資材3を燃料4に変換。星雲の中ではガスを集めて燃料+5。'
    },
    lounge: {
      name: 'ラウンジ', glyph: '憩', kind: 'lounge', color: '#f687b3',
      cost: 35, build: 1, powerUse: 1, workers: 4, mass: 1, wear: 0.6,
      place: 'any', priority: 15,
      desc: '士気の目標値+7（最大3つまで効果）。長い旅の憩いの場。'
    },
    medbay: {
      name: '医務室', glyph: '医', kind: 'medbay', color: '#feb2b2',
      cost: 55, build: 2, powerUse: 1, workers: 8, mass: 2, wear: 0.7,
      place: 'any', priority: 80, research: 'medicine',
      desc: '人口の増加速度+50%、疫病の被害を軽減。士気の目標値+3。'
    },
    shield: {
      name: 'シールド発生器', glyph: '盾', kind: 'shield', color: '#63b3ed',
      cost: 70, build: 2, powerUse: 3, workers: 4, mass: 2, wear: 0.8,
      place: 'any', priority: 55, shieldR: 1, research: 'shielding',
      desc: '周囲1マス（3×3）を隕石やフレアの被害から守る。'
    },
    bio: {
      name: 'バイオドーム', glyph: '緑', kind: 'bio', color: '#38a169',
      cost: 80, build: 3, powerUse: 3, workers: 12, mass: 3, wear: 0.9,
      place: 'any', priority: 95, food: 10, o2: 1, research: 'biodome',
      desc: '食料を10生産し、周囲1マスに酸素も供給する。'
    },
    arcology: {
      name: '高密度居住区', glyph: '塔', kind: 'hab', color: '#ed8936',
      cost: 90, build: 3, powerUse: 3, workers: 0, mass: 3, wear: 0.8,
      place: 'any', priority: 90, cap: 75, research: 'arcology',
      desc: '75人が暮らせる積層居住区。酸素供給が必要。'
    },
    ion: {
      name: 'イオン推進器', glyph: '翔', kind: 'engine', color: '#fc8181',
      cost: 100, build: 3, powerUse: 7, workers: 10, mass: 3, wear: 1.0,
      place: 'rear', priority: 60, thrust: 15, fuel: 0.5, research: 'iondrive',
      desc: '船尾にのみ設置可。電力7と燃料0.5で推力15。'
    },
    fusion: {
      name: '核融合炉', glyph: '融', kind: 'reactor', color: '#fefcbf',
      cost: 150, build: 4, powerGen: 24, workers: 14, mass: 4, wear: 0.9,
      place: 'any', priority: 0, fuel: 0.5, research: 'fusion',
      desc: '燃料0.5で24発電。排熱がなく、隣接する推進器の推力+20%。'
    }
  };

  const BUILD_ORDER = [
    'hab', 'life', 'farm', 'reactor', 'solar', 'engine', 'storage', 'lab', 'shop',
    'drone', 'refinery', 'lounge', 'medbay', 'shield', 'bio', 'arcology', 'ion', 'fusion'
  ];

  /* 研究（研究ポイントで解放） */
  const RESEARCH = {
    scanner:   { name: '長距離スキャナ', cost: 25, desc: '先の宙域を3つ多く観測でき、隕石・フレアの被害を30%軽減。' },
    medicine:  { name: '船内医療', cost: 30, desc: '医務室を建造可能にする。', unlock: 'medbay' },
    hulltech:  { name: '船体工学', cost: 40, desc: '外殻拡張のコストを半分にする。' },
    shielding: { name: '偏向シールド', cost: 50, desc: 'シールド発生器を建造可能にする。', unlock: 'shield' },
    genecrops: { name: '遺伝子改良作物', cost: 55, desc: '水耕農場の基本生産+3。' },
    biodome:   { name: '閉鎖生態系', cost: 70, desc: 'バイオドームを建造可能にする。', unlock: 'bio' },
    arcology:  { name: '積層建築', cost: 80, desc: '高密度居住区を建造可能にする。', unlock: 'arcology' },
    nanobots:  { name: '修復ナノマシン', cost: 90, desc: '稼働中の全モジュールが毎ターン耐久+2回復。' },
    iondrive:  { name: 'イオン推進', cost: 110, desc: 'イオン推進器を建造可能にする。', unlock: 'ion' },
    automation:{ name: '自動化AI', cost: 120, desc: '全モジュールの必要人手を40%減らす。' },
    fusion:    { name: '核融合', cost: 150, desc: '核融合炉を建造可能にする。', unlock: 'fusion' }
  };

  const RESEARCH_ORDER = [
    'scanner', 'medicine', 'hulltech', 'shielding', 'genecrops', 'biodome',
    'arcology', 'nanobots', 'iondrive', 'automation', 'fusion'
  ];

  /*
   * 宙域タイプ
   *  light : 集光パネルの出力倍率
   *  mine  : ドローンの採取倍率
   *  scoop : 燃料精製所がガスを集められるか
   *  morale: 毎ターンの士気変化
   *  event : イベント発生率
   */
  const SECTORS = {
    normal:   { name: '通常宙域', short: '通常', color: '#4a5878', light: 1.0, mine: 1.0, scoop: false, morale: 0, event: 0.22,
                desc: '穏やかな星間空間。' },
    asteroid: { name: '小惑星帯', short: '小惑星', color: '#9c7a4a', light: 1.0, mine: 4.0, scoop: false, morale: 0, event: 0.38,
                desc: '資材の宝庫だが、隕石の衝突に注意。' },
    nebula:   { name: '星雲', short: '星雲', color: '#7b5ea7', light: 0.35, mine: 0.5, scoop: true, morale: 0, event: 0.3,
                desc: '光が届きにくい。燃料精製所はガスを集められる。' },
    star:     { name: '恒星系', short: '恒星', color: '#c9a227', light: 2.0, mine: 2.0, scoop: false, morale: 4, event: 0.32,
                desc: '強い光で集光パネルが2倍働く。恒星フレアに注意。' },
    derelict: { name: '漂流船の墓場', short: '残骸', color: '#5f7d7a', light: 0.8, mine: 2.0, scoop: false, morale: -4, event: 0.4,
                desc: '過去の船の残骸が漂う。回収の好機か、それとも罠か。' },
    void:     { name: '暗黒宙域', short: '暗黒', color: '#22283a', light: 0.25, mine: 0.3, scoop: false, morale: -10, event: 0.25,
                desc: '星明かりすらない虚無。乗員の心が沈む。' },
    goal:     { name: 'ヴェルダ星系', short: '目的地', color: '#3fa36b', light: 1.5, mine: 1.0, scoop: false, morale: 10, event: 0.1,
                desc: '目的地、居住可能惑星ヴェルダを擁する星系。' }
  };

  /* 航行モード */
  const MODES = {
    hold:   { name: '停泊', thrust: 0, fuel: 0, wear: 0.2, drone: 2.0, desc: '進まない。推進器を休ませ、ドローンの採取量が2倍。' },
    cruise: { name: '巡航', thrust: 1.0, fuel: 1.0, wear: 1.0, drone: 1.0, desc: '標準の航行。' },
    full:   { name: '全速', thrust: 1.5, fuel: 2.2, wear: 2.5, drone: 0.7, desc: '推力1.5倍。燃料2.2倍、推進器の劣化2.5倍。' }
  };

  const RULES = {
    totalDistance: 2400,     // 目的地までの距離（光年）
    speedK: 45,              // 船速係数
    drift: 3,                // 慣性による最低限の移動（巡航/全速時）
    hullMassPerCell: 0.5,    // 外殻1マスあたりの質量
    foodPerPerson: 0.08,     // 1人1ターンあたりの食料消費
    baseCap: { mat: 300, fuel: 300, food: 150 },
    baseAp: 2,
    maxAp: 5,
    basePower: 6,            // 艦橋の補助電源（常に発電）
    repairCost: 15,
    repairAmount: 60,
    expandCost: 60,
    maxTurns: 300,
    reactorAdjBonus: 0.2,
    eventChanceScale: 1.0,
    wearScale: 0.75,         // 劣化速度の全体倍率
    breakChance: 0.05,       // 耐久30%未満のときの故障率
    // 士気は目標値へ毎ターン rate の割合で近づく
    morale: { base: 62, fatiguePerTurn: 0.1, fatigueMax: 12, rate: 0.15 }
  };

  /* 初期配置（行, 列, モジュール） */
  const START_LAYOUT = [
    [1, 1, 'solar'], [1, 2, 'hab'], [1, 4, 'hab'], [1, 5, 'solar'],
    [2, 1, 'engine'], [2, 2, 'farm'], [2, 3, 'life'],
    [3, 1, 'reactor'], [3, 2, 'storage'], [3, 3, 'hab'], [3, 4, 'lab'], [3, 5, 'solar'],
    [4, 1, 'engine'], [4, 2, 'farm'], [4, 3, 'life'],
    [5, 2, 'hab'], [5, 4, 'hab']
  ];

  const START = {
    pop: 120, morale: 70, food: 80, fuel: 260, mat: 200, rp: 0,
    hull: { r0: 1, r1: 5, c0: 1, c1: 5 }
  };

  return { ROWS, COLS, MODULES, BUILD_ORDER, RESEARCH, RESEARCH_ORDER, SECTORS, MODES, RULES, START_LAYOUT, START };
});

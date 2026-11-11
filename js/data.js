/*
 * DRIFT ARK — 静的データ定義
 * モジュール・研究・航路・難易度など、ゲームの数値はここにまとめる。
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
   * 範囲供給（フィールド）
   *  施設は周囲のマスへ「電力・空気・食料・快適・研究支援・医療」を届ける。
   *  距離はチェビシェフ距離（周囲1マス＝3×3、2マス＝5×5…）。距離ごとの強さは FALLOFF を掛ける。
   */
  const FIELDS = {
    power:   { name: '電力', unit: '', color: '#f6e05e' },
    air:     { name: '空気', unit: '', color: '#4fd1c5' },
    food:    { name: '食料', unit: '', color: '#68d391' },
    comfort: { name: '快適', unit: '', color: '#f687b3' },
    lab:     { name: '研究支援', unit: '%', color: '#b794f4' },
    med:     { name: '医療', unit: '%', color: '#feb2b2' }
  };
  const FIELD_ORDER = ['power', 'air', 'food', 'comfort', 'lab', 'med'];
  const FALLOFF = [1, 1, 0.5, 0.25];          // 距離0（自分のマス）,1,2,3
  const RELAY_FALLOFF = [1, 1, 1, 0.6];        // 配電ノードの範囲内での電力の届き方

  /*
   * モジュール定義
   *  emit   : { フィールド: [強さ, 範囲] }（快適が負なら騒音・排熱）
   *  need   : 稼働に必要な電力（このマスに届いている電力がこれ以上なら100%、半分以上なら50%、それ未満は停止）
   *  life   : 寿命（ターン）。寿命の6割を過ぎると壊れやすくなる
   *  place  : 'any' | 'edge'（外縁）| 'rear'（船尾：左隣が船外）
   */
  const MODULES = {
    bridge: {
      name: '艦橋', kind: 'bridge', color: '#90cdf4', fixed: true,
      cost: 0, build: 0, need: 0, life: 0, place: 'any',
      emit: { power: [8, 1], air: [6, 1] },
      desc: '船の中枢。取り壊せず、壊れない。周囲に少しの電力と空気を届ける。'
    },
    life: {
      name: '生命維持装置', kind: 'life', color: '#4fd1c5',
      cost: 50, build: 2, need: 10, life: 80, place: 'any',
      emit: { air: [10, 2] },
      desc: '周囲2マスに空気を届ける（隣10・2マス先5）。'
    },
    farm: {
      name: '水耕農場', kind: 'farm', color: '#68d391',
      cost: 45, build: 2, need: 10, life: 80, place: 'any',
      emit: { food: [8, 2] },
      desc: '周囲2マスに食料を届ける（隣8・2マス先4）。'
    },
    reactor: {
      name: '核分裂炉', kind: 'reactor', color: '#f6e05e',
      cost: 70, build: 3, need: 0, life: 70, place: 'any', fuel: 1,
      emit: { power: [30, 2], comfort: [-8, 1] },
      desc: '燃料1で周囲2マスに電力（隣30・2マス先15）。排熱で隣の居住ブロックの快適さが下がる。'
    },
    solar: {
      name: '集光パネル', kind: 'solar', color: '#faf089',
      cost: 35, build: 1, need: 0, life: 90, place: 'edge',
      emit: { power: [10, 1] }, solar: true,
      desc: '外縁のみ。隣のマスに電力10。宙域の明るさで強さが変わる。'
    },
    engine: {
      name: '推進器', kind: 'engine', color: '#f6865e',
      cost: 60, build: 3, need: 12, life: 60, place: 'rear', thrust: 10, fuel: 2,
      emit: { comfort: [-6, 1] },
      desc: '船尾のみ。燃料2で推力10。噴射音で隣の快適さが下がる。'
    },
    booster: {
      name: '推力増幅器', kind: 'booster', color: '#ff9f43',
      cost: 55, build: 2, need: 10, life: 60, place: 'any', boost: 0.5, fuel: 1.5,
      emit: { comfort: [-4, 1] },
      desc: '上下左右に隣接する推進器の推力+50%（重ねがけ可）。増幅する推進器1基ごとに燃料1.5。'
    },
    storage: {
      name: '貯蔵庫', kind: 'storage', color: '#a0aec0',
      cost: 30, build: 1, need: 0, life: 150, place: 'any', store: { mat: 200, fuel: 200 },
      desc: '資材と燃料の上限+200。'
    },
    lab: {
      name: '研究ラボ', kind: 'lab', color: '#b794f4',
      cost: 55, build: 2, need: 15, life: 80, place: 'any',
      emit: { lab: [60, 2] },
      desc: '周囲2マスの住人が生む研究を増やす（隣+60%・2マス先+30%）。'
    },
    shop: {
      name: '工房', kind: 'shop', color: '#90cdf4',
      cost: 50, build: 2, need: 8, life: 90, place: 'any', ap: 1,
      desc: '1ターンの作業回数+1（最大5）。'
    },
    lander: {
      name: '降下艇格納庫', kind: 'lander', color: '#d69e2e',
      cost: 50, build: 2, need: 8, life: 70, place: 'edge', harvest: { mat: 20, fuel: 14, rp: 8 },
      desc: '外縁のみ。寄港中に降下艇が資源を採る（1ターンに資材20・燃料14まで）。小惑星帯では航行中も少し採掘する。'
    },
    refinery: {
      name: '燃料精製所', kind: 'refinery', color: '#c6a15b',
      cost: 60, build: 2, need: 12, life: 70, place: 'any', refine: { in: 3, out: 2 }, scoop: 4,
      emit: { comfort: [-4, 1] },
      desc: '資材3を燃料2に変える。星雲ではガスを集めて燃料+4。'
    },
    lounge: {
      name: 'ラウンジ', kind: 'lounge', color: '#f687b3',
      cost: 35, build: 1, need: 6, life: 90, place: 'any',
      emit: { comfort: [12, 2] },
      desc: '周囲2マスの快適さを上げる（隣+12・2マス先+6）。'
    },
    medbay: {
      name: '医務室', kind: 'medbay', color: '#feb2b2', research: 'medicine',
      cost: 55, build: 2, need: 8, life: 80, place: 'any',
      emit: { med: [50, 2], comfort: [4, 1] },
      desc: '周囲2マスの人口増加+50%・疫病の被害を軽減。'
    },
    shield: {
      name: 'シールド発生器', kind: 'shield', color: '#63b3ed', research: 'shielding',
      cost: 70, build: 2, need: 15, life: 70, place: 'any', shieldR: 1,
      desc: '周囲1マスを隕石・フレア・衝撃波の被害から守る。'
    },
    bio: {
      name: 'バイオドーム', kind: 'bio', color: '#38a169', research: 'biodome',
      cost: 80, build: 3, need: 14, life: 80, place: 'any',
      emit: { food: [8, 2], air: [6, 2], comfort: [3, 1] },
      desc: '周囲2マスに食料（隣8）と空気（隣6）を届ける。'
    },
    relay: {
      name: '配電ノード', kind: 'relay', color: '#fbd38d', research: 'grid',
      cost: 40, build: 1, need: 0, life: 100, place: 'any',
      desc: '周囲1マスでは電力が弱まらず届く（2マス先も100%、3マス先も60%）。'
    },
    ion: {
      name: 'イオン推進器', kind: 'engine', color: '#fc8181', research: 'iondrive',
      cost: 100, build: 3, need: 30, life: 70, place: 'rear', thrust: 15, fuel: 0.5,
      emit: { comfort: [-4, 1] },
      desc: '船尾のみ。電力30を食うが、燃料0.5で推力15。'
    },
    fusion: {
      name: '核融合炉', kind: 'reactor', color: '#fefcbf', research: 'fusion',
      cost: 150, build: 4, need: 0, life: 90, place: 'any', fuel: 0.5,
      emit: { power: [60, 3] },
      desc: '燃料0.5で周囲3マスに電力（隣60・2マス先30・3マス先15）。排熱はない。'
    },
    jump: {
      name: '跳躍ドライブ', kind: 'engine', color: '#d6bcfa', research: 'jumpdrive',
      cost: 180, build: 4, need: 70, life: 60, place: 'rear', thrust: 45, fuel: 0,
      emit: { comfort: [-10, 1] },
      desc: '船尾のみ。燃料を使わず推力45。ただし電力70が必要。'
    }
  };

  const BUILD_ORDER = [
    'life', 'farm', 'reactor', 'solar', 'engine', 'booster', 'storage', 'lab', 'shop',
    'lander', 'refinery', 'lounge', 'medbay', 'shield', 'bio', 'relay', 'ion', 'fusion', 'jump'
  ];

  /* 研究（研究ポイントで解放） */
  const RESEARCH = {
    scanner:    { name: '長距離スキャナ', cost: 30, desc: '先の航路を3区間多く観測でき、隕石・フレアの被害を3割減らす。' },
    medicine:   { name: '船内医療', cost: 35, desc: '医務室を建造できるようにする。', unlock: 'medbay' },
    hulltech:   { name: '船体工学', cost: 40, desc: '外殻拡張のコストを半分にする。' },
    grid:       { name: '配電網', cost: 45, desc: '配電ノードを建造できるようにする。', unlock: 'relay' },
    shielding:  { name: '偏向シールド', cost: 60, desc: 'シールド発生器を建造できるようにする。', unlock: 'shield' },
    genecrops:  { name: '遺伝子改良作物', cost: 60, desc: '水耕農場とバイオドームの食料+50%。' },
    maintenance:{ name: '予防保全AI', cost: 70, desc: 'すべてのモジュールの寿命を1.5倍にする。' },
    biodome:    { name: '閉鎖生態系', cost: 80, desc: 'バイオドームを建造できるようにする。', unlock: 'bio' },
    arcology:   { name: '積層居住', cost: 90, desc: '居住ブロック1マスの定員を20人から30人にする。' },
    repairdrones:{ name: '修復ドローン', cost: 90, desc: '改修が1ターンで終わり、費用も半分になる。' },
    iondrive:   { name: 'イオン推進', cost: 110, desc: 'イオン推進器を建造できるようにする。', unlock: 'ion' },
    fusion:     { name: '核融合', cost: 160, desc: '核融合炉を建造できるようにする。', unlock: 'fusion' },
    jumpdrive:  { name: '空間跳躍', cost: 240, desc: '跳躍ドライブを建造できるようにする。', unlock: 'jump', requires: 'fusion' }
  };
  // 出航時に、このうち1つがランダムで研究済みになる（航海ごとの変化）
  const LEGACY_TECH = ['medicine', 'grid', 'genecrops', 'shielding', 'maintenance', 'repairdrones'];
  const RESEARCH_ORDER = [
    'scanner', 'medicine', 'hulltech', 'grid', 'shielding', 'genecrops', 'maintenance',
    'biodome', 'arcology', 'repairdrones', 'iondrive', 'fusion', 'jumpdrive'
  ];

  /*
   * 航路の区間（寄港地と寄港地のあいだ）
   *  light : 集光パネルの強さの倍率
   *  mine  : 降下艇格納庫が航行中に採る資材（1基あたり）
   *  scoop : 燃料精製所がガスを集められるか
   *  comfort: 全居住ブロックの快適さへの影響
   *  event : イベントの起きやすさ
   */
  const LEGS = {
    normal:   { name: '星間空間', short: '星間', color: '#4a5878', light: 1.0, mine: 0, scoop: false, comfort: 0, event: 0.22,
                desc: '穏やかな星間空間。' },
    asteroid: { name: '小惑星帯', short: '小惑星', color: '#9c7a4a', light: 1.0, mine: 3, scoop: false, comfort: 0, event: 0.4,
                desc: '降下艇格納庫が航行中も資材を採掘できる。隕石に注意。' },
    nebula:   { name: '星雲', short: '星雲', color: '#7b5ea7', light: 0.4, mine: 0, scoop: true, comfort: 0, event: 0.3,
                desc: '光が届きにくい。燃料精製所はガスを集められる。' },
    derelict: { name: '漂流船の墓場', short: '残骸', color: '#5f7d7a', light: 0.8, mine: 2, scoop: false, comfort: -4, event: 0.42,
                desc: '過去の船の残骸が漂う。回収の好機か、それとも罠か。' },
    void:     { name: '暗黒宙域', short: '暗黒', color: '#22283a', light: 0.2, mine: 0, scoop: false, comfort: -8, event: 0.26,
                desc: '星明かりすらない虚無。乗員の心が沈む。' }
  };

  /* 寄港地（惑星など）。寄港中は降下艇が埋蔵量から資源を採る */
  const PORTS = {
    rock:    { name: '岩石惑星', color: '#b7791f', mat: [240, 340], fuel: [30, 70], rp: 0, light: 1.0,
               desc: '鉱物資源が豊富な岩の惑星。' },
    ice:     { name: '氷の衛星', color: '#63b3ed', mat: [60, 120], fuel: [180, 260], rp: 0, light: 0.9,
               desc: '厚い氷に覆われた衛星。氷から燃料を作れる。' },
    gas:     { name: 'ガス巨星', color: '#ed8936', mat: [0, 30], fuel: [220, 320], rp: 0, light: 0.8,
               desc: '巨大なガス惑星。大気から燃料を汲み上げられる。' },
    station: { name: '廃棄ステーション', color: '#a0aec0', mat: [180, 260], fuel: [40, 90], rp: [40, 80], light: 1.0,
               desc: '放棄された宇宙基地。資材と古い研究データが眠る。' },
    star:    { name: '赤色矮星系', color: '#f56565', mat: [120, 180], fuel: [80, 140], rp: 0, light: 2.0,
               desc: '小さな恒星の光で集光パネルが2倍働く。フレアに注意。' }
  };

  /* 航行モード */
  const MODES = {
    orbit:  { name: '停泊', thrust: 0, fuel: 0, age: 0.3, desc: '寄港地にとどまり、降下艇で資源を採る。' },
    cruise: { name: '巡航', thrust: 1.0, fuel: 1.0, age: 1.0, desc: '標準の航行。' },
    full:   { name: '全速', thrust: 1.5, fuel: 2.0, age: 2.0, desc: '推力1.5倍。推進器の燃料2倍・老朽化2倍。' }
  };

  /* 難易度 */
  const DIFFICULTY = {
    easy: {
      name: 'やさしい', desc: '衝撃波が遅く、資源と寿命に余裕がある。はじめての航海に。',
      wave: { start: -420, speed: 8, accel: 0.10 }, mat: 320, fuel: 320, pop: 130,
      lifeMult: 1.3, eventDamage: 0.7, scoreMult: 0.8
    },
    normal: {
      name: 'ふつう', desc: '寄港と航行の配分を考えないと、衝撃波に追いつかれる。',
      wave: { start: -320, speed: 10, accel: 0.14 }, mat: 260, fuel: 260, pop: 120,
      lifeMult: 1.0, eventDamage: 1.0, scoreMult: 1.0
    },
    hard: {
      name: 'むずかしい', desc: '衝撃波が速く、施設も早く傷む。熟練の艦長向け。',
      wave: { start: -250, speed: 12, accel: 0.17 }, mat: 220, fuel: 220, pop: 110,
      lifeMult: 0.85, eventDamage: 1.3, scoreMult: 1.3
    }
  };

  const RULES = {
    totalDistance: 3000,     // 目的地までの距離（光年）
    drift: 2,                // 推力がなくても進む距離（巡航・全速時）
    blockCap: 20,            // 居住ブロック1マスの定員
    blockCapArcology: 30,
    airPerPerson: 0.4,       // 1人が必要とする空気
    foodPerPerson: 0.5,      // 1人が必要とする食料
    rpPerPerson: 0.05,       // 1人が生む研究
    baseComfort: 50,
    growth: 0.025,           // 1ターンの人口増加率（空きがあり快適なブロック）
    overflowLoss: 0.3,       // 住む場所のない人のうち1ターンで失われる割合
    baseCap: { mat: 300, fuel: 300 },
    baseAp: 2,
    maxAp: 5,
    repairCost: 8,
    overhaulRate: 0.4,       // 改修費用（建造費に対する割合）
    overhaulTurns: 2,
    expandCost: 60,
    maxTurns: 300,
    wearStart: 0.6,          // 寿命のこの割合を過ぎると壊れやすくなる
    morale: { rate: 0.2 },
    portSpacing: [240, 380], // 寄港地の間隔（光年）
    startPopRatio: 0.85,     // 初期人口（収容力に対する割合）
    startAge: [0.05, 0.3]    // 初期モジュールの老朽度（寿命に対する割合）
  };

  /* 初期配置（行, 列, モジュール）。空いた船体マスは居住ブロック */
  const START_LAYOUT = [
    [1, 3, 'solar'],
    [2, 1, 'engine'], [2, 2, 'farm'], [2, 3, 'life'], [2, 5, 'lander'],
    [3, 2, 'reactor'], [3, 3, 'bridge'], [3, 4, 'lab'], [3, 5, 'solar'],
    [4, 1, 'engine'], [4, 2, 'farm'], [4, 3, 'life'],
    [5, 3, 'solar'], [5, 5, 'storage']
  ];
  const START_HULL = { r0: 1, r1: 5, c0: 1, c1: 5 };

  return {
    ROWS, COLS, FIELDS, FIELD_ORDER, FALLOFF, RELAY_FALLOFF, MODULES, BUILD_ORDER, RESEARCH, RESEARCH_ORDER, LEGACY_TECH,
    LEGS, PORTS, MODES, DIFFICULTY, RULES, START_LAYOUT, START_HULL
  };
});

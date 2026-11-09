/*
 * DRIFT ARK — 画面描画と操作
 */
(function () {
  'use strict';
  const G = window.ArkGame;
  const D = G.D;
  const SAVE_KEY = 'driftark.save.v1';
  const BEST_KEY = 'driftark.best.v1';

  let S = null;                             // ゲーム状態
  let tool = { type: 'inspect', id: null }; // 現在のツール
  let selected = null;                      // 選択中のマス
  let overlay = 'none';                     // 'none' | 'o2' | 'shield'
  let tab = 'build';
  let lastTurnSeen = 0;
  let modalKind = null;

  /* ---------- 小道具 ---------- */
  const $ = id => document.getElementById(id);
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'style') e.setAttribute('style', v);
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(e.dataset, v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      e.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
    return e;
  }
  // モジュールのアイコン（icons.js が読めなかったときは従来の1文字表示）
  const iconOf = id => (window.ArkIcons ? window.ArkIcons.icon(id) : D.MODULES[id].glyph);
  const fmt = (n, d = 0) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d });
  const signed = (n, d = 1) => (n > 0.05 ? '+' : n < -0.05 ? '−' : '±') + fmt(Math.abs(n), d);

  function storageGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function storageSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* 保存できない環境では無視 */ } }
  function storageDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* noop */ } }

  let toastTimer = null;
  function toast(text, kind) {
    const t = $('toast');
    t.textContent = text;
    t.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
  }

  function save() {
    if (!S) return;
    storageSet(SAVE_KEY, G.serialize(S));
  }

  /* ---------- 操作の共通処理 ---------- */
  function act(fn, okMsg) {
    const res = fn();
    if (!res || !res.ok) {
      if (res && res.reason) toast(res.reason, 'bad');
      return false;
    }
    if (okMsg) toast(okMsg, 'good');
    save();
    render();
    return true;
  }

  function setTool(type, id) {
    if (tool.type === type && tool.id === (id || null) && type !== 'inspect') tool = { type: 'inspect', id: null };
    else tool = { type, id: id || null };
    render();
  }

  /* ---------- 描画 ---------- */
  function render() {
    if (!S) return;
    const F = G.computeFlows(S);
    $('turn').textContent = S.turn;
    renderRoute();
    renderStats(F);
    renderToolbar();
    renderGrid(F);
    renderControls(F);
    renderSide(F);
    renderLog();
    syncModal();
  }

  function renderRoute() {
    const box = $('route');
    box.textContent = '';
    const total = D.RULES.totalDistance;
    const bar = el('div', { class: 'routebar' });
    const range = G.scanRange(S);
    S.route.forEach((seg, k) => {
      const known = k <= S.sectorIndex + range || seg.type === 'goal';
      const def = D.SECTORS[seg.type];
      const w = (seg.len / total) * 100;
      const cls = 'seg' + (k === S.sectorIndex ? ' cur' : '') + (k < S.sectorIndex ? ' past' : '') + (known ? '' : ' unknown');
      bar.appendChild(el('div', {
        class: cls,
        style: 'width:' + w + '%;' + (known ? 'background:' + def.color : ''),
        title: known ? def.name + '（' + seg.len + '光年）— ' + def.desc : '未観測の宙域（長距離スキャナで先まで観測できる）'
      }, el('span', { text: known ? def.short : '？' })));
    });
    const pos = Math.min(100, (S.dist / total) * 100);
    bar.appendChild(el('div', { class: 'shipmark', style: 'left:' + pos + '%', title: '現在位置' }, '▶'));

    const sec = G.currentSector(S);
    const sd = D.SECTORS[sec.type];
    const remainSec = Math.max(0, sec.start + sec.len - S.dist);
    const next = S.route[S.sectorIndex + 1];
    const nextKnown = next && (1 <= range || next.type === 'goal');
    const info = el('div', { class: 'routeinfo' },
      el('span', { class: 'secname', style: 'border-color:' + sd.color }, sd.name),
      el('span', { class: 'muted' }, sd.desc),
      el('span', { class: 'spacer' }),
      el('span', null, 'この宙域の残り ', el('b', null, fmt(remainSec)), ' 光年'),
      next ? el('span', null, '次：', el('b', null, nextKnown ? D.SECTORS[next.type].name : '未観測')) : null,
      el('span', null, '目的地まで ', el('b', null, fmt(Math.max(0, total - S.dist))), ' 光年')
    );
    box.appendChild(bar);
    box.appendChild(info);
  }

  function stat(label, value, sub, opts) {
    opts = opts || {};
    return el('div', { class: 'stat ' + (opts.cls || ''), title: opts.title || null },
      el('div', { class: 'slabel' }, label),
      el('div', { class: 'svalue' }, value),
      sub !== null && sub !== undefined ? el('div', { class: 'ssub ' + (opts.subcls || '') }, sub) : null
    );
  }

  function renderStats(F) {
    const box = $('stats');
    box.textContent = '';
    const foodNet = F.foodProd - F.foodCons;
    const refScale = F.refIn > 0 ? Math.min(1, (S.mat + F.matProd) / F.refIn) : 1;
    const fuelNet = F.refOut * refScale + F.scoopOut - F.fuelUse;
    const matNet = F.matProd - F.refIn * refScale;
    const powerShort = F.powerDemand > F.powerGen + 1e-9;
    const etaTurns = F.speed > 0 ? Math.ceil((D.RULES.totalDistance - S.dist) / F.speed) : null;

    box.appendChild(stat('人口', fmt(S.pop) + ' / ' + fmt(F.cap), S.pop > F.cap ? '収容超過！' : '空き ' + fmt(F.cap - S.pop),
      { cls: S.pop > F.cap ? 'bad' : '', subcls: S.pop > F.cap ? 'bad' : '', title: '居住区の収容力は、酸素が届いていて電力のある居住区の合計です。' }));
    const mt = F.moraleTarget;
    box.appendChild(stat('士気', fmt(S.morale), '目標 ' + fmt(mt) + (mt > S.morale + 0.5 ? ' ↑' : mt < S.morale - 0.5 ? ' ↓' : ''),
      { cls: S.morale < 30 ? 'bad' : S.morale >= 75 ? 'good' : '', title: '士気は目標値へ少しずつ近づきます：\n' + F.moraleParts.map(p => p[0] + ' ' + signed(p[1], 0)).join('\n') }));
    box.appendChild(stat('食料', fmt(S.food) + ' / ' + fmt(F.capMat.food), signed(foodNet) + ' /ターン',
      { cls: foodNet < 0 ? (S.food < -foodNet * 5 ? 'bad' : 'warn') : '', subcls: foodNet < 0 ? 'bad' : 'good',
        title: '生産 ' + fmt(F.foodProd, 1) + ' − 消費 ' + fmt(F.foodCons, 1) + '（1人あたり' + D.RULES.foodPerPerson + '）' }));
    const fuelLeft = fuelNet < 0 ? Math.floor(S.fuel / -fuelNet) : null;
    box.appendChild(stat('燃料', fmt(S.fuel) + ' / ' + fmt(F.capMat.fuel), signed(fuelNet) + (fuelLeft !== null ? '（残' + fuelLeft + 'T）' : ' /ターン'),
      { cls: fuelNet < 0 && fuelLeft < 12 ? 'bad' : fuelNet < 0 ? 'warn' : '', subcls: fuelNet < 0 ? 'bad' : 'good',
        title: '消費 ' + fmt(F.fuelUse, 1) + '（炉・推進器）／精製 ' + fmt(F.refOut * refScale, 1) + '／星雲ガス ' + fmt(F.scoopOut, 1) }));
    box.appendChild(stat('資材', fmt(S.mat) + ' / ' + fmt(F.capMat.mat), signed(matNet) + ' /ターン',
      { subcls: matNet < 0 ? 'bad' : 'good', title: 'ドローン採取 ' + fmt(F.matProd, 1) + '／精製所への投入 ' + fmt(F.refIn * refScale, 1) }));
    box.appendChild(stat('電力', fmt(F.powerUse, 1) + ' / ' + fmt(F.powerGen, 1), powerShort ? '不足 ' + fmt(F.powerDemand - F.powerGen, 1) : '余剰 ' + fmt(F.powerGen - F.powerUse, 1),
      { cls: powerShort ? 'bad' : '', subcls: powerShort ? 'bad' : 'good', title: '使用 / 発電（艦橋の補助電源' + D.RULES.basePower + 'を含む）。不足すると優先度の低い区画から停止します。' }));
    box.appendChild(stat('人手', fmt(F.workersReq) + ' / ' + fmt(S.pop), F.workersReq > S.pop ? '不足 ' + fmt(F.workersReq - S.pop) : '余裕 ' + fmt(S.pop - F.workersReq),
      { cls: F.workersReq > S.pop ? 'warn' : '', subcls: F.workersReq > S.pop ? 'bad' : '', title: '稼働中の区画に必要な人手 / 人口。足りない場合は優先度の低い区画から効率が落ちます。' }));
    box.appendChild(stat('研究', fmt(S.rp), signed(F.rpProd) + ' /ターン', { subcls: 'good' }));
    box.appendChild(stat('速度', fmt(F.speed, 1) + ' 光年', etaTurns !== null ? '到着まで約' + etaTurns + 'T' : '停泊中',
      { title: '速度 = ' + D.RULES.drift + ' + ' + D.RULES.speedK + ' × 推力 ' + fmt(F.thrust, 1) + ' ÷ 質量 ' + fmt(F.mass, 1) }));
  }

  function renderToolbar() {
    const box = $('toolbar');
    box.textContent = '';
    const tb = (type, label, title) => el('button', {
      type: 'button', class: 'btn tool' + (tool.type === type ? ' on' : ''), title,
      onclick: () => setTool(type)
    }, label);
    box.appendChild(tb('inspect', '調べる', '区画をクリックして詳細を表示'));
    box.appendChild(tb('repair', '修理', '耐久+' + D.RULES.repairAmount + '・故障を直す（資材' + D.RULES.repairCost + '・作業1）'));
    box.appendChild(tb('demolish', '撤去', 'モジュールを撤去して資材を一部回収（作業1）'));
    box.appendChild(tb('expand', '外殻拡張', '船体の外側に区画を増やす（資材' + G.expandCost(S) + '・作業1）'));
    if (tool.type === 'build') {
      const def = D.MODULES[tool.id];
      box.appendChild(el('span', { class: 'toolnote' }, '建造：', el('b', { style: 'color:' + def.color }, def.name), '（配置先をクリック／Escで解除）'));
    }
    box.appendChild(el('span', { class: 'spacer' }));
    const ov = (key, label) => el('button', {
      type: 'button', class: 'btn tool small' + (overlay === key ? ' on' : ''),
      onclick: () => { overlay = overlay === key ? 'none' : key; render(); }
    }, label);
    box.appendChild(ov('o2', '酸素範囲'));
    box.appendChild(ov('shield', 'シールド範囲'));
  }

  function cellLabel(m) {
    const st = { active: '', building: '建造中', broken: '故障', off: '停止', blocked: '配置不適' }[m.status];
    return m.def.name + (st ? '（' + st + '）' : '');
  }

  function renderGrid(F) {
    const grid = $('grid');
    grid.textContent = '';
    grid.style.gridTemplateColumns = 'repeat(' + S.cols + ', 1fr)';
    for (let i = 0; i < S.rows * S.cols; i++) {
      const [r, c] = G.rc(S, i);
      const inHull = S.hull[i];
      const m = F.info[i];
      const classes = ['cell'];
      let title = '';
      const kids = [];
      if (!inHull) {
        classes.push('void');
        if (tool.type === 'expand') {
          const chk = G.canExpand(S, r, c);
          if (chk.ok) { classes.push('can'); kids.push(el('span', { class: 'plus' }, '+')); title = '外殻を拡張（資材' + G.expandCost(S) + '）'; }
          else title = chk.reason;
        }
      } else if (!m) {
        classes.push('empty');
        title = '空き区画';
        if (G.isRear(S, S.hull, r, c)) { classes.push('rear'); title += '（船尾）'; }
        else if (G.isEdge(S, S.hull, r, c)) { classes.push('edge'); title += '（外縁）'; }
        if (tool.type === 'build') {
          const chk = G.canBuild(S, r, c, tool.id);
          classes.push(chk.ok ? 'can' : 'cannot');
          if (!chk.ok) title += ' — ' + chk.reason;
        }
      } else {
        classes.push('mod', 'st-' + m.status);
        if (m.status === 'active' && !m.powered) classes.push('nopower');
        if (m.def.kind === 'engine' && m.out > 0) classes.push('thrusting');
        title = cellLabel(m);
        kids.push(el('span', { class: 'glyph', style: 'color:' + m.def.color }, iconOf(m.id)));
        kids.push(el('span', { class: 'mname' }, m.def.name));
        const cond = Math.max(0, Math.min(100, m.cell.cond));
        const condCls = cond < 30 ? 'low' : cond < 60 ? 'mid' : 'ok';
        kids.push(el('span', { class: 'cond' }, el('i', { class: condCls, style: 'width:' + cond + '%' })));
        const badges = [];
        if (m.status === 'building') badges.push(el('b', { class: 'bdg build', title: '完成まで' + m.cell.build + 'ターン' }, '⏳' + m.cell.build));
        if (m.status === 'broken') badges.push(el('b', { class: 'bdg bad', title: '故障中' }, '✖'));
        if (m.status === 'off') badges.push(el('b', { class: 'bdg', title: '手動で停止中' }, '⏸'));
        if (m.status === 'blocked') badges.push(el('b', { class: 'bdg bad', title: '配置条件を満たしていない' }, '⛔'));
        if (m.status === 'active' && !m.powered) badges.push(el('b', { class: 'bdg warn', title: '電力不足' }, '⚡'));
        if (m.status === 'active' && m.staff < 1) badges.push(el('b', { class: 'bdg warn', title: '人手不足' }, '人'));
        if (m.def.kind === 'hab' && m.status === 'active' && F.o2[i] <= 0) { badges.push(el('b', { class: 'bdg bad', title: '酸素が届いていない' }, 'O₂')); classes.push('noair'); }
        if (badges.length) kids.push(el('span', { class: 'badges' }, badges));
        if (tool.type === 'repair') classes.push(G.canRepair(S, r, c).ok ? 'can' : 'cannot');
        if (tool.type === 'demolish') classes.push('can-demolish');
        title += ' 耐久' + Math.round(cond) + '%';
      }
      if (overlay === 'o2' && inHull && F.o2[i] > 0) classes.push('ov-o2');
      if (overlay === 'shield' && inHull && F.shield[i] > 0) classes.push('ov-shield');
      if (selected === i) classes.push('sel');
      const btn = el('button', {
        type: 'button', class: classes.join(' '), title,
        'aria-label': '(' + (r + 1) + ',' + (c + 1) + ') ' + (title || '船外'),
        onclick: () => onCell(i),
        onmouseenter: () => hoverInfo(i),
        oncontextmenu: (e) => { e.preventDefault(); if (tool.type !== 'inspect') setTool('inspect'); }
      }, kids);
      grid.appendChild(btn);
    }
  }

  function hoverInfo(i) {
    const line = $('hoverline');
    const F = G.computeFlows(S);
    const m = F.info[i];
    const [r, c] = G.rc(S, i);
    let t = '(' + (r + 1) + ',' + (c + 1) + ') ';
    if (!S.hull[i]) t += '船外';
    else if (!m) t += '空き区画' + (G.isRear(S, S.hull, r, c) ? '・船尾' : G.isEdge(S, S.hull, r, c) ? '・外縁' : '') + (F.o2[i] > 0 ? '・酸素あり' : '・酸素なし');
    else t += cellLabel(m) + '　' + outputText(m, F) + '　耐久' + Math.round(m.cell.cond) + '%';
    line.textContent = t;
  }

  function onCell(i) {
    const [r, c] = G.rc(S, i);
    if (tool.type === 'inspect') {
      selected = i; tab = 'info'; render();
      // 1カラム表示（スマホ等）では詳細パネルが下にあるので見える位置までスクロール
      if (window.matchMedia('(max-width: 900px)').matches) {
        const side = document.querySelector('.side');
        if (side) side.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    if (tool.type === 'build') {
      const id = tool.id;
      if (S.cells[i] || !S.hull[i]) {
        // 既存モジュールや船外をクリックしたら、ツールを解除してその区画を調べる
        tool = { type: 'inspect', id: null };
        selected = i; tab = 'info'; render();
        return;
      }
      if (act(() => G.build(S, r, c, id))) {
        selected = i;
        if (S.ap < 1 || S.mat < D.MODULES[id].cost) { tool = { type: 'inspect', id: null }; render(); }
      }
      return;
    }
    if (tool.type === 'repair') { if (act(() => G.repair(S, r, c))) selected = i; return; }
    if (tool.type === 'demolish') { if (act(() => G.demolish(S, r, c))) selected = i; return; }
    if (tool.type === 'expand') { if (act(() => G.expand(S, r, c))) { selected = i; if (S.ap < 1) setTool('inspect'); } }
  }

  function renderControls(F) {
    const box = $('controls');
    box.textContent = '';
    const modes = el('div', { class: 'modes', role: 'radiogroup', 'aria-label': '航行モード' });
    for (const key of ['hold', 'cruise', 'full']) {
      const md = D.MODES[key];
      modes.appendChild(el('button', {
        type: 'button', class: 'btn mode' + (S.mode === key ? ' on' : ''), role: 'radio', 'aria-checked': S.mode === key ? 'true' : 'false',
        title: md.desc, onclick: () => act(() => G.setMode(S, key))
      }, md.name));
    }
    const apDots = el('div', { class: 'ap', title: '作業回数：建造・修理・撤去・拡張に1回ずつ使う' }, '作業 ');
    for (let k = 0; k < F.apMax; k++) apDots.appendChild(el('i', { class: k < S.ap ? 'on' : '' }));
    apDots.appendChild(el('span', null, ' ' + S.ap + '/' + F.apMax));
    const endBtn = el('button', { type: 'button', class: 'btn primary end', onclick: doEndTurn, title: 'Enterキーでも実行できます' }, 'ターン終了 ▶');
    box.appendChild(el('div', { class: 'modewrap' }, el('span', { class: 'muted' }, '航行'), modes));
    box.appendChild(el('div', { class: 'modedesc muted' }, D.MODES[S.mode].desc));
    box.appendChild(el('div', { class: 'endwrap' }, apDots, endBtn));
  }

  /* ---------- サイドパネル ---------- */
  function renderSide(F) {
    document.querySelectorAll('.tab').forEach(b => {
      b.classList.toggle('on', b.dataset.tab === tab);
      b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
    });
    const body = $('tabbody');
    body.textContent = '';
    if (tab === 'build') renderBuildTab(body, F);
    else if (tab === 'research') renderResearchTab(body);
    else renderInfoTab(body, F);
  }

  function renderBuildTab(body) {
    body.appendChild(el('p', { class: 'hint' }, 'モジュールを選んでから、グリッドの空き区画をクリック。建造には作業1回と資材が必要です。'));
    const list = el('div', { class: 'cards' });
    for (const id of D.BUILD_ORDER) {
      const def = D.MODULES[id];
      const unlocked = G.isUnlocked(S, id);
      if (!unlocked && def.research && !S.researched[def.research]) {
        // 研究前のモジュールも表示しておく（何が解放されるか分かるように）
      }
      const afford = S.mat >= def.cost;
      const on = tool.type === 'build' && tool.id === id;
      const meta = [];
      meta.push('資材' + def.cost);
      meta.push(def.build + 'T');
      if (def.powerGen) meta.push('⚡+' + def.powerGen);
      if (def.powerUse) meta.push('⚡−' + def.powerUse);
      if (def.workers) meta.push('人' + def.workers);
      const pl = G.placementLabel(def.place);
      const card = el('button', {
        type: 'button',
        class: 'card' + (on ? ' on' : '') + (!unlocked ? ' locked' : '') + (unlocked && !afford ? ' poor' : ''),
        disabled: !unlocked ? true : null,
        onclick: () => { setTool('build', id); },
        title: def.desc
      },
        el('span', { class: 'cglyph', style: 'color:' + def.color + ';border-color:' + def.color }, iconOf(id)),
        el('span', { class: 'cbody' },
          el('span', { class: 'cname' }, def.name, pl ? el('small', { class: 'tag' }, pl) : null),
          el('span', { class: 'cmeta' }, meta.join('・')),
          el('span', { class: 'cdesc' }, unlocked ? def.desc : '🔒 研究「' + D.RESEARCH[def.research].name + '」で解放')
        )
      );
      list.appendChild(card);
    }
    body.appendChild(list);
  }

  function renderResearchTab(body) {
    body.appendChild(el('p', { class: 'hint' }, '研究ラボが生む研究ポイントで新技術を解放します（作業回数は消費しません）。現在 ', el('b', null, fmt(S.rp)), ' pt'));
    const list = el('div', { class: 'cards' });
    for (const id of D.RESEARCH_ORDER) {
      const def = D.RESEARCH[id];
      const done = !!S.researched[id];
      const chk = G.canResearch(S, id);
      list.appendChild(el('div', { class: 'card rcard' + (done ? ' done' : '') },
        el('span', { class: 'cbody' },
          el('span', { class: 'cname' }, def.name, el('small', { class: 'tag' }, done ? '研究済み' : def.cost + ' pt')),
          el('span', { class: 'cdesc' }, def.desc)
        ),
        done ? null : el('button', {
          type: 'button', class: 'btn small' + (chk.ok ? ' primary' : ''), disabled: chk.ok ? null : true,
          onclick: () => act(() => G.research(S, id), '研究完了：' + def.name)
        }, '研究')
      ));
    }
    body.appendChild(list);
  }

  function outputText(m, F) {
    const k = m.def.kind;
    if (m.status === 'building') return '完成まで' + m.cell.build + 'ターン';
    if (m.status === 'broken') return '故障中（修理が必要）';
    if (m.status === 'off') return '停止中';
    if (m.status === 'blocked') return '配置条件（' + G.placementLabel(m.def.place) + '）を満たしていない';
    if (!m.powered) return '電力不足で停止';
    switch (k) {
      case 'hab': return '収容 ' + fmt(m.capEff) + ' / ' + m.def.cap + '人';
      case 'life': return '周囲1マスに酸素を供給';
      case 'bio': return '食料 +' + fmt(m.out, 1) + '・周囲1マスに酸素';
      case 'farm': return '食料 +' + fmt(m.out, 1);
      case 'reactor': case 'solar': return '発電 +' + fmt(m.gen, 1);
      case 'engine': return S.mode === 'hold' ? '待機中（停泊）' : '推力 ' + fmt(m.out, 1);
      case 'storage': return '上限 資材/燃料+' + m.def.store.mat + '・食料+' + m.def.store.food;
      case 'lab': return '研究 +' + fmt(m.out, 1);
      case 'shop': return m.eff >= 0.5 ? '作業回数 +1' : '人手不足で機能していない';
      case 'drone': return '資材 +' + fmt(m.out, 1);
      case 'refinery': return '資材' + fmt(m.def.refine.in * m.eff, 1) + ' → 燃料' + fmt(m.def.refine.out * m.eff, 1) + (G.sectorDef(S).scoop ? '・ガス回収+' + fmt(m.def.scoop * m.eff, 1) : '');
      case 'lounge': return '士気の目標 +' + fmt(7 * m.eff, 1);
      case 'medbay': return '人口増加+50%・疫病を軽減';
      case 'shield': return '周囲1マスを防護';
      default: return '';
    }
  }

  function renderInfoTab(body, F) {
    if (selected === null) { renderShipSummary(body, F); return; }
    const i = selected;
    const [r, c] = G.rc(S, i);
    const m = F.info[i];
    const pos = '区画 (' + (r + 1) + ', ' + (c + 1) + ')';
    if (!S.hull[i]) {
      const chk = G.canExpand(S, r, c);
      body.appendChild(el('h3', { class: 'itit' }, '船外 ', el('small', null, pos)));
      body.appendChild(el('p', null, '外殻を拡張すると、ここを区画として使えるようになります。拡張した区画は質量+' + D.RULES.hullMassPerCell + '。'));
      body.appendChild(el('button', { type: 'button', class: 'btn' + (chk.ok ? ' primary' : ''), disabled: chk.ok ? null : true, onclick: () => act(() => G.expand(S, r, c)) }, '外殻拡張（資材' + G.expandCost(S) + '）'));
      if (!chk.ok) body.appendChild(el('p', { class: 'muted small' }, chk.reason));
      body.appendChild(backBtn());
      return;
    }
    if (!m) {
      const tags = [];
      if (G.isRear(S, S.hull, r, c)) tags.push('船尾');
      if (G.isEdge(S, S.hull, r, c)) tags.push('外縁');
      body.appendChild(el('h3', { class: 'itit' }, '空き区画 ', el('small', null, pos)));
      body.appendChild(el('ul', { class: 'kv' },
        el('li', null, el('span', null, '位置'), el('b', null, tags.length ? tags.join('・') : '内部')),
        el('li', null, el('span', null, '酸素'), el('b', null, F.o2[i] > 0 ? '供給あり' : 'なし')),
        el('li', null, el('span', null, 'シールド'), el('b', null, F.shield[i] > 0 ? '範囲内' : '範囲外'))
      ));
      body.appendChild(el('p', { class: 'muted small' }, '「建造」タブでモジュールを選んでからクリックすると建造できます。'));
      const quick = el('div', { class: 'quick' });
      for (const id of D.BUILD_ORDER) {
        if (!G.isUnlocked(S, id)) continue;
        const chk = G.canBuild(S, r, c, id);
        if (!chk.ok && /船尾|外縁/.test(chk.reason)) continue;
        const def = D.MODULES[id];
        quick.appendChild(el('button', {
          type: 'button', class: 'qb', disabled: chk.ok ? null : true, title: def.desc + (chk.ok ? '' : '（' + chk.reason + '）'),
          onclick: () => act(() => G.build(S, r, c, id))
        }, el('span', { class: 'qg', style: 'color:' + def.color }, iconOf(id)), el('span', { class: 'qn' }, def.name), el('span', { class: 'qc' }, def.cost)));
      }
      body.appendChild(el('p', { class: 'small' }, 'ここに直接建造（数字は資材）：'));
      body.appendChild(quick);
      body.appendChild(backBtn());
      return;
    }
    const def = m.def;
    body.appendChild(el('h3', { class: 'itit' }, el('span', { class: 'cglyph', style: 'color:' + def.color + ';border-color:' + def.color }, iconOf(m.id)), ' ', def.name, ' ', el('small', null, pos)));
    const stText = { active: m.powered ? (m.eff < 0.99 && !def.powerGen ? '稼働中（効率' + Math.round(m.eff * 100) + '%）' : '稼働中') : '電力不足で停止', building: '建造中（残り' + m.cell.build + 'ターン）', broken: '故障中', off: '手動で停止中', blocked: '配置条件を満たしていない' }[m.status];
    const rows = [
      ['状態', stText],
      ['出力', outputText(m, F)],
      ['耐久', Math.round(m.cell.cond) + '%'],
    ];
    if (def.powerUse) rows.push(['消費電力', String(def.powerUse)]);
    if (def.workers) rows.push(['必要人手', fmt(def.workers * (S.researched.automation ? 0.6 : 1), 1) + '人' + (m.staff !== undefined && m.staff < 1 ? '（充足' + Math.round(m.staff * 100) + '%）' : '')]);
    if (def.fuel) rows.push(['燃料消費', def.fuel + (def.kind === 'engine' ? '×' + D.MODES[S.mode].fuel : '')]);
    rows.push(['質量', String(def.mass)]);
    body.appendChild(el('ul', { class: 'kv' }, rows.map(([k, v]) => el('li', null, el('span', null, k), el('b', null, v)))));
    if (m.notes.length) body.appendChild(el('p', { class: 'notes' }, '⚠ ' + m.notes.join('・')));
    body.appendChild(el('p', { class: 'desc' }, def.desc));

    const btns = el('div', { class: 'btnrow' });
    const rep = G.canRepair(S, r, c);
    btns.appendChild(el('button', { type: 'button', class: 'btn' + (rep.ok ? ' primary' : ''), disabled: rep.ok ? null : true, title: rep.ok ? '' : rep.reason, onclick: () => act(() => G.repair(S, r, c)) }, '修理（資材' + D.RULES.repairCost + '）'));
    if (m.status !== 'building') {
      btns.appendChild(el('button', { type: 'button', class: 'btn', onclick: () => act(() => G.toggle(S, r, c)) }, m.cell.enabled ? '停止する' : '稼働させる'));
    }
    const dem = G.canDemolish(S, r, c);
    btns.appendChild(el('button', { type: 'button', class: 'btn danger', disabled: dem.ok ? null : true, title: dem.ok ? '' : dem.reason, onclick: () => act(() => G.demolish(S, r, c)) }, '撤去（資材+' + G.demolishRefund(S, r, c) + '）'));
    body.appendChild(btns);
    body.appendChild(el('p', { class: 'muted small' }, '「停止する」は作業回数を使いません。電力や人手を他の区画に回したいときに。'));
    body.appendChild(backBtn());
  }

  function backBtn() {
    return el('button', { type: 'button', class: 'btn ghost small', onclick: () => { selected = null; render(); } }, '← 船の概況に戻る');
  }

  function renderShipSummary(body, F) {
    body.appendChild(el('h3', { class: 'itit' }, '船の概況'));
    body.appendChild(el('p', { class: 'muted small' }, '区画をクリックすると詳細を表示します。'));
    const section = (title, rows) => {
      body.appendChild(el('h4', { class: 'sub' }, title));
      body.appendChild(el('ul', { class: 'kv' }, rows.map(([k, v, cls]) => el('li', { class: cls || '' }, el('span', null, k), el('b', null, v)))));
    };
    section('士気の内訳（目標 ' + fmt(F.moraleTarget) + '）', F.moraleParts.map(p => [p[0], signed(p[1], 0), p[1] < 0 ? 'neg' : 'pos']));
    const gens = {};
    gens['艦橋の補助電源'] = D.RULES.basePower;
    for (const m of F.mods) if (m.gen > 0) gens[m.def.name] = (gens[m.def.name] || 0) + m.gen;
    section('発電', Object.entries(gens).map(([k, v]) => [k, '+' + fmt(v, 1)]));
    const unpowered = F.mods.filter(m => m.status === 'active' && !m.powered).map(m => m.def.name);
    if (unpowered.length) body.appendChild(el('p', { class: 'notes' }, '⚡ 電力不足で停止中：' + unpowered.join('、')));
    const broken = F.mods.filter(m => m.status === 'broken').map(m => m.def.name);
    if (broken.length) body.appendChild(el('p', { class: 'notes' }, '✖ 故障中：' + broken.join('、')));
    const worn = F.mods.filter(m => m.status === 'active' && m.cell.cond < 40).map(m => m.def.name + ' ' + Math.round(m.cell.cond) + '%');
    if (worn.length) body.appendChild(el('p', { class: 'notes warnc' }, '🔧 劣化が進んでいる：' + worn.join('、')));
    const sd = G.sectorDef(S);
    section('現在の宙域：' + sd.name, [
      ['集光パネル出力', '×' + sd.light],
      ['ドローン採取', '×' + sd.mine + (S.mode === 'hold' ? '（停泊で×2）' : '')],
      ['星雲ガス回収', sd.scoop ? '可能' : '不可'],
      ['イベント発生率', Math.round(sd.event * 100) + '%']
    ]);
    section('航行', [
      ['推力', fmt(F.thrust, 1)],
      ['質量', fmt(F.mass, 1) + '（外殻' + G.hullCount(S) + 'マス）'],
      ['速度', fmt(F.speed, 1) + ' 光年/ターン']
    ]);
  }

  /* ---------- 日誌 ---------- */
  function renderLog() {
    const box = $('log');
    box.textContent = '';
    // ターンは新しい順、同じターン内は起きた順に表示する
    const groups = [];
    for (const e of S.log.slice(-120)) {
      const g = groups[groups.length - 1];
      if (g && g.turn === e.turn) g.items.push(e); else groups.push({ turn: e.turn, items: [e] });
    }
    for (const g of groups.reverse()) {
      box.appendChild(el('li', { class: 'lturn' }, 'ターン ' + g.turn));
      for (const e of g.items) box.appendChild(el('li', { class: 'l-' + e.kind + (e.turn >= lastTurnSeen ? ' fresh' : '') }, e.text));
    }
  }

  /* ---------- ターン終了 ---------- */
  function doEndTurn() {
    if (!S || S.status !== 'playing' || S.pendingEvent) return;
    const before = S.log.length;
    const turn = S.turn;
    const res = G.endTurn(S);
    if (!res.ok) { toast(res.reason, 'bad'); return; }
    lastTurnSeen = turn;
    selected = (selected !== null && S.hull[selected]) ? selected : null;
    if (tool.type === 'build' && S.mat < D.MODULES[tool.id].cost) tool = { type: 'inspect', id: null };
    save();
    render();
    const fresh = S.log.slice(before).filter(e => e.kind === 'danger');
    if (fresh.length) toast(fresh[fresh.length - 1].text, 'bad');
    const grid = $('grid');
    grid.classList.remove('pulse'); void grid.offsetWidth; grid.classList.add('pulse');
  }

  /* ---------- モーダル ---------- */
  function openModal(kind, build) {
    modalKind = kind;
    const back = $('modal');
    const box = $('modalbox');
    box.textContent = '';
    box.className = 'modal ' + kind;
    build(box);
    back.hidden = false;
    const f = box.querySelector('button.primary, button');
    if (f) f.focus();
  }
  function closeModal() {
    modalKind = null;
    $('modal').hidden = true;
  }

  function syncModal() {
    if (!S) return;
    if (S.status !== 'playing') { if (modalKind !== 'end' && modalKind !== 'end-view' && modalKind !== 'help' && modalKind !== 'menu') showEnd(); return; }
    if (S.pendingEvent) { if (modalKind !== 'event') showEvent(); return; }
    if (modalKind === 'event' || modalKind === 'end') closeModal();
  }

  function showEvent() {
    const pe = S.pendingEvent;
    openModal('event', box => {
      box.appendChild(el('div', { class: 'mkicker' }, 'ターン ' + S.turn + '・' + G.sectorDef(S).name));
      box.appendChild(el('h2', null, pe.title));
      box.appendChild(el('p', null, pe.text));
      const list = el('div', { class: 'choices' });
      pe.choices.forEach((ch, k) => {
        list.appendChild(el('button', {
          type: 'button', class: 'btn choice' + (k === 0 ? ' primary' : ''),
          onclick: () => {
            const res = G.resolveEvent(S, k);
            if (!res.ok) { toast(res.reason, 'bad'); return; }
            closeModal();
            save();
            render();
            if (res.lines && res.lines.length) toast(res.lines[res.lines.length - 1], res.kind === 'danger' ? 'bad' : res.kind === 'good' ? 'good' : '');
          }
        }, el('b', null, ch.label), el('small', null, ch.hint)));
      });
      box.appendChild(list);
    });
  }

  function showEnd() {
    const won = S.status === 'won';
    let best = null;
    try { best = JSON.parse(storageGet(BEST_KEY) || 'null'); } catch (e) { best = null; }
    let isBest = false;
    if (won && S.score && (!best || S.score.score > best.score)) {
      storageSet(BEST_KEY, JSON.stringify(Object.assign({ date: new Date().toISOString().slice(0, 10) }, S.score)));
      isBest = true;
      best = S.score;
    }
    openModal('end', box => {
      box.appendChild(el('div', { class: 'mkicker' }, won ? '航海成功' : '航海失敗'));
      box.appendChild(el('h2', null, won ? '新天地ヴェルダに到達' : '方舟の灯が消えた'));
      box.appendChild(el('p', null, S.endReason));
      const rows = [
        ['航海ターン', S.turn],
        ['到着時の人口', S.pop],
        ['最大人口', S.stats.maxPop],
        ['誕生', S.stats.born],
        ['犠牲', S.stats.lost],
        ['建造数', S.stats.built],
        ['修理数', S.stats.repaired],
        ['航行距離', fmt(S.dist) + ' 光年']
      ];
      box.appendChild(el('ul', { class: 'kv' }, rows.map(([k, v]) => el('li', null, el('span', null, k), el('b', null, String(v))))));
      if (won && S.score) {
        box.appendChild(el('div', { class: 'score' },
          el('span', { class: 'rank r-' + S.score.rank }, S.score.rank),
          el('span', null, 'スコア ', el('b', null, fmt(S.score.score)), isBest ? el('em', null, ' 自己ベスト！') : null)
        ));
        box.appendChild(el('p', { class: 'muted small' }, 'スコア = 人口×10 + 士気×4 + 早さボーナス（220ターンから1ターン早いごとに15）'));
      }
      if (best && !isBest) box.appendChild(el('p', { class: 'muted small' }, '自己ベスト：' + best.rank + '（' + fmt(best.score) + '・' + best.turn + 'ターン）'));
      box.appendChild(el('div', { class: 'btnrow' },
        el('button', { type: 'button', class: 'btn primary', onclick: () => { closeModal(); startNew(); } }, '新しい航海へ'),
        el('button', { type: 'button', class: 'btn', onclick: () => { modalKind = 'end-view'; $('modal').hidden = true; } }, '船を眺める')
      ));
    });
  }

  function showTitle() {
    const hasSave = !!storageGet(SAVE_KEY);
    openModal('title', box => {
      box.appendChild(el('div', { class: 'tlogo' }, 'DRIFT ARK'));
      box.appendChild(el('div', { class: 'tsub' }, '世代船グリッド航行記'));
      box.appendChild(el('p', null, '母星の恒星が膨張を始めた。最後の世代船は、' + D.RULES.totalDistance.toLocaleString('ja-JP') + '光年先の居住可能惑星ヴェルダを目指して旅立つ。'));
      box.appendChild(el('p', null, '船内のグリッドに居住区・生命維持装置・農場・炉・推進器を配置し、電力・酸素・食料・燃料をやりくりしながら、乗員を生かしたまま目的地へ導こう。'));
      const btns = el('div', { class: 'btnrow center' });
      if (hasSave) btns.appendChild(el('button', { type: 'button', class: 'btn primary', onclick: () => { closeModal(); if (!loadSave()) showTitle(); } }, '続きから'));
      btns.appendChild(el('button', { type: 'button', class: 'btn' + (hasSave ? '' : ' primary'), onclick: () => { closeModal(); startNew(); } }, '新しい航海'));
      btns.appendChild(el('button', { type: 'button', class: 'btn ghost', onclick: showHelp }, '遊び方'));
      box.appendChild(btns);
      let best = null;
      try { best = JSON.parse(storageGet(BEST_KEY) || 'null'); } catch (e) { best = null; }
      if (best) box.appendChild(el('p', { class: 'muted small center' }, '自己ベスト：ランク' + best.rank + '・スコア' + fmt(best.score) + '（' + best.turn + 'ターン）'));
    });
  }

  function showHelp() {
    const prev = modalKind;
    openModal('help', box => {
      box.appendChild(el('h2', null, '遊び方'));
      const sec = (title, items) => {
        box.appendChild(el('h4', { class: 'sub' }, title));
        box.appendChild(el('ul', { class: 'help' }, items.map(t => el('li', null, t))));
      };
      sec('目的', [
        '目的地ヴェルダまで' + D.RULES.totalDistance.toLocaleString('ja-JP') + '光年。人口が0になるか、' + D.RULES.maxTurns + 'ターンを過ぎると失敗。',
        '到着時の人口・士気・ターン数でスコアが決まります。'
      ]);
      sec('1ターンの流れ', [
        '作業回数（初期2、工房1つごとに+1・最大5）の範囲で、建造・修理・撤去・外殻拡張を行います。研究と稼働/停止の切り替えは作業回数を使いません。',
        '「ターン終了」で時間が進み、生産・消費・航行・劣化・イベントが処理されます。'
      ]);
      sec('配置のルール', [
        '居住区は生命維持装置（またはバイオドーム）の周囲1マス（3×3）の中でなければ住めません。',
        '推進器は「船尾」＝左隣が船外のマスにしか置けません。集光パネルとドローン格納庫は「外縁」のみ。',
        '隣接ボーナス：水耕農場は生命維持装置の隣で増産、推進器は炉の隣で推力+20%、研究ラボは並べると増産。',
        '核分裂炉の隣の居住区は排熱で士気が下がります。',
        '外殻拡張で区画を増やせます。ただし推進器の噴射口や外縁専用モジュールを塞ぐ拡張はできません。'
      ]);
      sec('資源と人', [
        '電力は優先度の高い区画（生命維持→居住区→農場→推進器…）から順に配られ、足りない区画は停止します。残りで動かせる小さな区画には回されます。',
        '人口はそのまま人手になります。人手が足りないと、優先度の低い区画から効率が落ちます。',
        '燃料は炉に優先して回り、残りが推進器へ。精製所で資材から作れるほか、星雲ではガスも集められます。',
        '資材はドローン格納庫で採取。小惑星帯や恒星系では採取量が増え、停泊すると2倍になります。',
        'モジュールは使うほど劣化し、耐久が尽きたり30%を切ったりすると故障します。早めに修理を。'
      ]);
      sec('速度', [
        '速度 = ' + D.RULES.drift + ' + ' + D.RULES.speedK + ' × 推力 ÷ 質量。モジュールや外殻を増やすほど船は重くなります。',
        '航行モード：停泊（進まずドローン2倍）／巡航／全速（推力1.5倍・燃料2.2倍・推進器の劣化2.5倍）。'
      ]);
      sec('操作', [
        'クリック：区画を調べる／選んだツールを使う。右クリックかEscでツール解除。',
        'Enter：ターン終了。ステータスにマウスを乗せると内訳が見られます。'
      ]);
      box.appendChild(el('div', { class: 'btnrow center' }, el('button', {
        type: 'button', class: 'btn primary',
        onclick: () => { closeModal(); if (!S) showTitle(); else if (prev === 'menu') showMenu(); else syncModal(); }
      }, '閉じる')));
    });
  }

  function showMenu() {
    openModal('menu', box => {
      box.appendChild(el('h2', null, 'メニュー'));
      box.appendChild(el('p', { class: 'muted small' }, '航海はターンごと・操作ごとにこのブラウザへ自動保存されています。シード：' + S.seed));
      box.appendChild(el('div', { class: 'btnrow col' },
        el('button', { type: 'button', class: 'btn primary', onclick: () => { closeModal(); syncModal(); } }, '航海に戻る'),
        el('button', { type: 'button', class: 'btn', onclick: showHelp }, '遊び方'),
        el('button', {
          type: 'button', class: 'btn danger', onclick: () => {
            if (window.confirm('現在の航海を破棄して、新しい航海を始めますか？')) { closeModal(); startNew(); }
          }
        }, '新しい航海を始める'),
        el('button', { type: 'button', class: 'btn ghost', onclick: () => { closeModal(); showTitle(); } }, 'タイトルへ')
      ));
    });
  }

  /* ---------- 開始・読み込み ---------- */
  function startNew(seed) {
    S = G.newGame(seed);
    tool = { type: 'inspect', id: null };
    selected = null;
    tab = 'build';
    lastTurnSeen = 1;
    save();
    render();
  }

  function loadSave() {
    const raw = storageGet(SAVE_KEY);
    if (!raw) return false;
    try {
      S = G.deserialize(raw);
    } catch (e) {
      toast('セーブデータを読み込めませんでした', 'bad');
      storageDel(SAVE_KEY);
      return false;
    }
    tool = { type: 'inspect', id: null };
    selected = null;
    lastTurnSeen = S.turn;
    render();
    return true;
  }

  function init() {
    document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
    $('btn-help').addEventListener('click', showHelp);
    $('btn-menu').addEventListener('click', () => { if (S) showMenu(); else showTitle(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (modalKind === 'help' || modalKind === 'menu') { closeModal(); if (S) syncModal(); else showTitle(); return; }
        if (tool.type !== 'inspect') { setTool('inspect'); return; }
        if (selected !== null) { selected = null; render(); }
        return;
      }
      // Enter はいつでも「ターン終了」（モーダル表示中を除く）。ボタンに焦点があっても誤操作しないよう既定動作を止める
      if (e.key === 'Enter' && !modalKind && S && !e.isComposing) {
        e.preventDefault();
        doEndTurn();
      }
    }, true);
    // URL の ?seed=123 で航路を固定できる（検証用）
    const m = /[?&]seed=(-?\d+)/.exec(window.location.search);
    if (m) { startNew(parseInt(m[1], 10)); return; }
    showTitle();
  }

  document.addEventListener('DOMContentLoaded', init);
})();

/*
 * DRIFT ARK — 画面描画と操作
 */
(function () {
  'use strict';
  const G = window.ArkGame;
  const D = G.D;
  const SAVE_KEY = 'driftark.save.v2';
  const BEST_KEY = 'driftark.best.v2';

  let S = null;                             // ゲーム状態
  let tool = { type: 'inspect', id: null }; // 現在のツール
  let selected = null;                      // 選択中のマス
  let overlay = 'none';                     // 重ね表示するフィールド
  let tab = 'build';
  let hoverIdx = null;
  let lastTurnSeen = 0;
  let modalKind = null;
  let undoSnap = null;                      // このターンの開始時点（やり直し用）
  let cellEls = [];

  /* ---------- 小道具 ---------- */
  const $ = id => document.getElementById(id);
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'style') e.setAttribute('style', v);
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      e.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
    return e;
  }
  const iconOf = id => (window.ArkIcons ? window.ArkIcons.icon(id) : document.createTextNode('■'));
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
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 2800);
  }

  function save() { if (S) storageSet(SAVE_KEY, G.serialize(S)); }
  function snapshot() { undoSnap = S ? G.serialize(S) : null; }
  const canUndo = () => !!(S && undoSnap && S.status === 'playing' && undoSnap !== G.serialize(S));
  function undo() {
    if (!canUndo()) return;
    S = G.deserialize(undoSnap);
    selected = null;
    tool = { type: 'inspect', id: null };
    save();
    render();
    toast('このターンの操作を取り消しました');
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

  /* ---------- 文言 ---------- */
  function emitText(def, short) {
    if (!def.emit) return '';
    return Object.keys(def.emit).map(f => {
      const [v, r] = def.emit[f];
      return D.FIELDS[f].name + (v < 0 ? '−' + (-v) : '+' + v) + D.FIELDS[f].unit + (short ? '/' + r : '（範囲' + r + '）');
    }).join(short ? '・' : '、');
  }

  function statusText(m) {
    switch (m.status) {
      case 'building': return '建造中（あと' + m.cell.build + 'ターン）';
      case 'overhaul': return '改修中（あと' + m.cell.overhaul + 'ターン）';
      case 'broken': return '故障中';
      case 'off': return '手動で停止中';
      case 'blocked': return '配置条件を満たしていない';
      default:
        if (m.eff >= 1) return '稼働中';
        if (m.eff > 0) return '出力50%（電力不足）';
        return m.def.kind === 'reactor' ? '燃料切れで停止' : '停止（電力不足）';
    }
  }

  function outputText(m, F) {
    if (m.status !== 'active') return statusText(m);
    const k = m.def.kind;
    if (m.def.emit && m.def.emit.power) return '電力 +' + fmt(m.gen, 1) + '（範囲' + m.def.emit.power[1] + '）';
    if (m.eff <= 0) return statusText(m);
    switch (k) {
      case 'engine': return S.mode === 'orbit' ? '待機中（停泊）' : '推力 ' + fmt(m.out, 1) + (m.boosters ? '（増幅×' + fmt(1 + 0.5 * m.boosters, 1) + '）' : '');
      case 'booster': return m.boosting ? '隣の推進器' + m.boosting + '基を増幅中' : '隣に推進器がない';
      case 'storage': return '資材・燃料の上限+' + m.def.store.mat;
      case 'shop': return m.eff >= 0.5 ? '作業回数+1' : '機能していない';
      case 'lander':
        if (G.currentPort(S)) return '採取中：資材' + fmt(m.def.harvest.mat * m.eff) + '・燃料' + fmt(m.def.harvest.fuel * m.eff) + '/ターンまで';
        return m.out > 0 ? '航行中の採掘 資材+' + fmt(m.out, 1) : '待機中（寄港地で採取）';
      case 'refinery': return '資材' + fmt(m.def.refine.in * m.eff, 1) + ' → 燃料' + fmt(m.def.refine.out * m.eff, 1) + (F.scoopOut > 0 ? '・ガス回収' : '');
      case 'shield': return '周囲1マスを防護中';
      case 'relay': return '周囲1マスの電力が弱まらない';
      default: return emitText(m.def) + (m.eff < 1 ? '（50%）' : '');
    }
  }

  /* ---------- 描画 ---------- */
  function render() {
    if (!S) return;
    const F = G.computeFlows(S);
    $('turn').textContent = S.turn;
    renderRoute(F);
    renderStats(F);
    renderToolbar();
    renderOverlayBar();
    renderGrid(F);
    renderControls(F);
    renderSide(F);
    renderSummary();
    renderLog();
    syncModal();
  }

  function renderRoute(F) {
    const box = $('route');
    box.textContent = '';
    const total = D.RULES.totalDistance;
    const pct = v => Math.max(0, Math.min(100, (v / total) * 100));
    const bar = el('div', { class: 'routebar' });
    const legNow = G.legIndexAt(S, S.dist);
    const range = G.scanRange(S);
    S.route.legs.forEach((leg, k) => {
      const known = k <= legNow + range;
      const def = D.LEGS[leg.type];
      bar.appendChild(el('div', {
        class: 'seg' + (k === legNow && S.portIndex < 0 ? ' cur' : '') + (k < legNow ? ' past' : '') + (known ? '' : ' unknown'),
        style: 'left:' + pct(leg.start) + '%;width:' + pct(leg.len) + '%;' + (known ? 'background:' + def.color : ''),
        title: known ? def.name + '（' + leg.len + '光年）— ' + def.desc : '未観測の区間（長距離スキャナで先まで観測できる）'
      }, el('span', null, known ? def.short : '？')));
    });
    S.route.ports.forEach((p, k) => {
      const known = G.legIndexAt(S, p.pos) <= legNow + range;
      const pd = D.PORTS[p.type];
      bar.appendChild(el('div', {
        class: 'port' + (p.visited ? ' visited' : '') + (k === S.portIndex ? ' here' : '') + (p.skip ? ' skip' : ''),
        style: 'left:' + pct(p.pos) + '%;' + (known ? 'background:' + pd.color : ''),
        title: known ? p.name + '（' + pd.name + '）' + (p.visited ? '・訪問済み' : '') + (p.skip ? '・寄らない' : '') : '未観測の寄港地'
      }));
    });
    bar.appendChild(el('div', { class: 'goal', style: 'left:100%', title: '目的地 惑星ヴェルダ' }));
    if (S.wave > 0) bar.appendChild(el('div', { class: 'wave', style: 'width:' + pct(S.wave) + '%', title: '恒星の衝撃波' }));
    bar.appendChild(el('div', { class: 'shipmark', style: 'left:' + pct(S.dist) + '%', title: '現在位置' }, '▶'));

    const port = G.currentPort(S);
    const leg = G.currentLeg(S);
    const nk = G.nextPortIndex(S);
    const next = nk >= 0 ? S.route.ports[nk] : null;
    const nextKnown = next && G.legIndexAt(S, next.pos) <= legNow + range;
    const gapCls = F.gap <= 0 ? 'bad' : (F.waveEta !== null && F.waveEta <= 4 ? 'bad' : F.waveEta !== null && F.waveEta <= 10 ? 'warn' : 'ok');
    const where = port
      ? el('span', { class: 'secname', style: 'border-color:' + D.PORTS[port.type].color }, port.name + '（' + D.PORTS[port.type].name + '）に停泊中')
      : el('span', { class: 'secname', style: 'border-color:' + D.LEGS[leg.type].color }, D.LEGS[leg.type].name);
    const info = el('div', { class: 'routeinfo' },
      where,
      el('span', { class: 'muted' }, port ? D.PORTS[port.type].desc : D.LEGS[leg.type].desc),
      el('span', { class: 'spacer' }),
      next ? el('span', null, '次の寄港地：', el('b', null, nextKnown ? next.name + '（' + D.PORTS[next.type].name + '）' : '未観測'), ' まで ', el('b', null, fmt(next.pos - S.dist)), ' 光年') : el('span', null, '目的地まで ', el('b', null, fmt(total - S.dist)), ' 光年'),
      el('span', { class: 'wavegap ' + gapCls }, F.gap <= 0 ? '衝撃波の中！' : '衝撃波まで ' + fmt(F.gap) + ' 光年' + (F.waveEta !== null ? '（約' + F.waveEta + 'ターン）' : '（引き離し中）'))
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

  function nets(F) {
    const refScale = F.refIn > 0 ? Math.min(1, (S.mat + F.matProd + F.harvest.mat) / F.refIn) : 1;
    return {
      mat: F.matProd + F.harvest.mat - F.refIn * refScale,
      fuel: F.harvest.fuel + F.refOut * refScale + F.scoopOut - F.fuelUse,
      rp: F.rpProd + F.harvest.rp
    };
  }

  function renderStats(F) {
    const box = $('stats');
    box.textContent = '';
    const n = nets(F);
    const popSub = F.overflow > 0 ? 'あふれ ' + F.overflow + '人！' : F.births > 0.05 ? '増加 約+' + fmt(F.births, 1) + '/T' : (F.support - S.pop > 0 ? '空き ' + (F.support - S.pop) + '人' : '満員');
    box.appendChild(stat('人口', fmt(S.pop) + ' / ' + fmt(F.support), popSub, {
      cls: F.overflow > 0 ? 'bad' : '', subcls: F.overflow > 0 ? 'bad' : F.births > 0.05 ? 'good' : '',
      title: '住人 / 住める人数（空気と食料の届いている居住ブロックの合計）'
    }));
    const mt = F.moraleTarget;
    box.appendChild(stat('士気', fmt(S.morale), '目標 ' + fmt(mt) + (mt > S.morale + 0.5 ? ' ↑' : mt < S.morale - 0.5 ? ' ↓' : ''), {
      cls: S.morale < 35 ? 'bad' : S.morale >= 70 ? 'good' : '',
      title: '士気は住人の快適さの平均（目標）へ少しずつ近づきます。35未満で暴動、70以上で人口増加・研究が上向き。'
    }));
    box.appendChild(stat('資材', fmt(S.mat) + ' / ' + fmt(F.capMat.mat), signed(n.mat) + ' /ターン', { subcls: n.mat < 0 ? 'bad' : n.mat > 0 ? 'good' : '' }));
    const fuelLeft = n.fuel < 0 ? Math.floor(S.fuel / -n.fuel) : null;
    box.appendChild(stat('燃料', fmt(S.fuel) + ' / ' + fmt(F.capMat.fuel), signed(n.fuel) + (fuelLeft !== null ? '（残' + fuelLeft + 'T）' : ' /ターン'), {
      cls: fuelLeft !== null && fuelLeft < 10 ? 'bad' : fuelLeft !== null && fuelLeft < 20 ? 'warn' : '',
      subcls: n.fuel < 0 ? 'bad' : 'good', title: '消費 ' + fmt(F.fuelUse, 1) + '（炉→推進系の順に回る）'
    }));
    box.appendChild(stat('研究', fmt(S.rp), signed(n.rp) + ' /ターン', { subcls: 'good', title: '住人が研究を生む。研究ラボの近くに住むほど多い。' }));
    box.appendChild(stat('速度', fmt(F.speed, 1) + ' 光年', '衝撃波は ' + fmt(F.waveSpeed, 1), {
      cls: S.mode !== 'orbit' && F.speed < F.waveSpeed ? 'warn' : '', subcls: S.mode !== 'orbit' && F.speed < F.waveSpeed ? 'bad' : '',
      title: '速度 = ' + D.RULES.drift + ' + 推力。衝撃波は少しずつ加速する。'
    }));
    box.appendChild(stat('衝撃波', F.gap <= 0 ? '呑まれている' : fmt(F.gap) + ' 光年', F.waveEta !== null ? '約' + F.waveEta + 'ターンで到達' : '引き離し中', {
      cls: F.gap <= 0 || (F.waveEta !== null && F.waveEta <= 4) ? 'bad' : F.waveEta !== null && F.waveEta <= 10 ? 'warn' : '',
      subcls: F.waveEta !== null ? 'bad' : 'good'
    }));
    box.appendChild(stat('作業', S.ap + ' / ' + F.apMax, '建造・修理・改修など', { title: '工房1つにつき+1（最大' + D.RULES.maxAp + '）' }));
  }

  function renderToolbar() {
    const box = $('toolbar');
    box.textContent = '';
    const tb = (type, label, title) => el('button', {
      type: 'button', class: 'btn tool' + (tool.type === type ? ' on' : ''), title,
      onclick: () => setTool(type)
    }, label);
    box.appendChild(tb('inspect', '調べる', '区画をクリックして詳細を表示'));
    box.appendChild(tb('repair', '修理', '故障を直して再稼働（資材' + D.RULES.repairCost + '・作業1）。老朽化はそのまま'));
    box.appendChild(tb('overhaul', '改修', '寿命を新品に戻す（建造費の40%・作業1・数ターン停止）'));
    box.appendChild(tb('demolish', '撤去', 'モジュールを撤去して資材を一部回収（作業1）。区画は居住ブロックに戻る'));
    box.appendChild(tb('expand', '外殻拡張', '船体の外側に区画を増やす（資材' + G.expandCost(S) + '・作業1）'));
    if (tool.type === 'build') {
      const def = D.MODULES[tool.id];
      box.appendChild(el('span', { class: 'toolnote' }, '建造：', el('b', { style: 'color:' + def.color }, def.name), '（置きたい区画にマウスを乗せると効果を予測／Escで解除）'));
    }
    box.appendChild(el('span', { class: 'spacer' }));
    box.appendChild(el('button', { type: 'button', class: 'btn tool small', disabled: canUndo() ? null : true, title: 'このターンの操作をすべて取り消す（Ctrl+Z）', onclick: undo }, '↶ やり直す'));
  }

  function renderOverlayBar() {
    const box = $('overlaybar');
    box.textContent = '';
    box.appendChild(el('span', { class: 'muted small' }, '範囲表示'));
    const ob = (key, label, color) => el('button', {
      type: 'button', class: 'btn chip' + (overlay === key ? ' on' : ''), role: 'radio', 'aria-checked': overlay === key ? 'true' : 'false',
      style: color ? '--chip:' + color : null,
      onclick: () => { overlay = overlay === key ? 'none' : key; render(); }
    }, label);
    box.appendChild(ob('none', 'なし'));
    for (const f of D.FIELD_ORDER) box.appendChild(ob(f, D.FIELDS[f].name, D.FIELDS[f].color));
    box.appendChild(ob('shield', 'シールド', '#63b3ed'));
  }

  function fieldValue(F, i) {
    if (overlay === 'shield') return F.shield[i] ? 1 : 0;
    return F.fields[overlay] ? F.fields[overlay][i] : 0;
  }

  function renderGrid(F) {
    const grid = $('grid');
    grid.textContent = '';
    grid.style.gridTemplateColumns = 'repeat(' + S.cols + ', 1fr)';
    cellEls = [];
    let maxV = 1;
    if (overlay !== 'none') for (let i = 0; i < S.hull.length; i++) if (S.hull[i]) maxV = Math.max(maxV, Math.abs(fieldValue(F, i)));
    const blockAt = {};
    for (const b of F.blocks) blockAt[b.i] = b;

    for (let i = 0; i < S.rows * S.cols; i++) {
      const [r, c] = G.rc(S, i);
      const inHull = S.hull[i];
      const m = F.info[i];
      const b = blockAt[i];
      const classes = ['cell'];
      const kids = [];
      let label = '';
      if (!inHull) {
        classes.push('void');
        label = '船外';
        if (tool.type === 'expand') {
          const chk = G.canExpand(S, r, c);
          if (chk.ok) { classes.push('can'); kids.push(el('span', { class: 'plus' }, '+')); label = '外殻を拡張できる'; }
        }
      } else if (b) {
        classes.push('blk');
        if (b.support <= 0) classes.push('nosupport');
        if (b.occ > 0 && b.occ >= b.support) classes.push('full');
        if (b.dark) classes.push('dark');
        kids.push(el('span', { class: 'glyph blkicon' }, iconOf('block')));
        kids.push(el('span', { class: 'occ' }, el('b', null, String(b.occ)), '/' + b.support));
        const cmf = Math.round(b.comfort);
        kids.push(el('span', { class: 'cmfbar', title: '快適 ' + cmf }, el('i', { class: cmf < 30 ? 'low' : cmf >= 70 ? 'high' : 'mid', style: 'width:' + cmf + '%' })));
        if (G.isRear(S, S.hull, r, c)) classes.push('rear');
        label = '居住ブロック ' + b.occ + '/' + b.support + '人・快適' + cmf;
        if (tool.type === 'build') classes.push(G.canBuild(S, r, c, tool.id).ok ? 'can' : 'cannot');
      } else if (m) {
        classes.push('mod', 'st-' + m.status);
        if (m.status === 'active' && m.eff < 1 && !(m.def.emit && m.def.emit.power)) classes.push(m.eff > 0 ? 'lowpower' : 'nopower');
        if (m.def.kind === 'engine' && m.out > 0) classes.push('thrusting');
        if (m.def.fixed) classes.push('fixed');
        kids.push(el('span', { class: 'glyph', style: 'color:' + m.def.color }, iconOf(m.id)));
        kids.push(el('span', { class: 'mname' }, m.def.name));
        if (!m.def.fixed) {
          const w = Math.min(1, G.wearLevel(S, m.cell));
          kids.push(el('span', { class: 'wear', title: '老朽度 ' + Math.round(w * 100) + '%' }, el('i', { class: w >= 0.85 ? 'low' : w >= D.RULES.wearStart ? 'mid' : 'ok', style: 'width:' + Math.round(w * 100) + '%' })));
        }
        const badges = [];
        if (m.status === 'building') badges.push(el('b', { class: 'bdg build' }, '⏳' + m.cell.build));
        if (m.status === 'overhaul') badges.push(el('b', { class: 'bdg build' }, '🔧' + m.cell.overhaul));
        if (m.status === 'broken') badges.push(el('b', { class: 'bdg bad' }, '✖'));
        if (m.status === 'off') badges.push(el('b', { class: 'bdg' }, '⏸'));
        if (m.status === 'blocked') badges.push(el('b', { class: 'bdg bad' }, '⛔'));
        if (m.status === 'active' && m.eff < 1 && !(m.def.emit && m.def.emit.power)) badges.push(el('b', { class: 'bdg warn' }, '⚡'));
        if (badges.length) kids.push(el('span', { class: 'badges' }, badges));
        label = m.def.name + '・' + statusText(m);
        if (tool.type === 'repair') classes.push(G.canRepair(S, r, c).ok ? 'can' : 'cannot');
        if (tool.type === 'overhaul') classes.push(G.canOverhaul(S, r, c).ok ? 'can' : 'cannot');
        if (tool.type === 'demolish') classes.push(G.canDemolish(S, r, c).ok ? 'can-demolish' : 'cannot');
        if (tool.type === 'build') classes.push('cannot');
      }
      if (overlay !== 'none' && inHull) {
        const v = fieldValue(F, i);
        if (v) {
          const col = overlay === 'shield' ? '#63b3ed' : (overlay === 'comfort' && v < 0 ? '#ff6b6b' : D.FIELDS[overlay].color);
          const a = Math.round(Math.min(1, Math.abs(v) / maxV) * 0x44 + 0x10).toString(16).padStart(2, '0');
          classes.push('ov');
          kids.push(el('span', { class: 'ovval', style: 'color:' + col }, overlay === 'shield' ? '防護' : fmt(v)));
          kids.push(el('span', { class: 'ovtint', style: 'background:' + col + a }));
        }
      }
      if (selected === i) classes.push('sel');
      const btn = el('button', {
        type: 'button', class: classes.join(' '),
        'aria-label': '(' + (r + 1) + ',' + (c + 1) + ') ' + label,
        onclick: () => onCell(i),
        onmouseenter: () => onHover(i),
        onfocus: () => onHover(i),
        oncontextmenu: (e) => { e.preventDefault(); if (tool.type !== 'inspect') setTool('inspect'); }
      }, kids);
      cellEls.push(btn);
      grid.appendChild(btn);
    }
    grid.onmouseleave = () => onHover(null);
    if (hoverIdx !== null) onHover(hoverIdx);
  }

  // マウスを乗せたマスの説明と、建造ツールなら効果範囲のプレビュー
  function onHover(i) {
    hoverIdx = i;
    for (const e of cellEls) e.classList.remove('fp', 'fpc');
    const line = $('hoverline');
    if (i === null || !S) { line.textContent = ' '; return; }
    const [r, c] = G.rc(S, i);
    const pos = '(' + (r + 1) + ',' + (c + 1) + ') ';
    if (tool.type === 'build' && S.hull[i] && !S.cells[i]) {
      for (const j of G.footprint(S, tool.id, r, c)) if (cellEls[j] && S.hull[j]) cellEls[j].classList.add('fp');
      cellEls[i].classList.add('fpc');
      const p = G.previewBuild(S, r, c, tool.id);
      line.textContent = '';
      if (p.powerAt === undefined) { line.appendChild(el('span', { class: 'bad' }, pos + p.reason)); return; }
      const parts = [];
      const def = D.MODULES[tool.id];
      if (p.need > 0) parts.push(el('span', { class: p.powerAt >= p.need ? 'good' : p.powerAt >= p.need / 2 ? 'warn' : 'bad' }, '電力 ' + fmt(p.powerAt) + '/' + p.need + (p.powerAt >= p.need ? ' ✓' : p.powerAt >= p.need / 2 ? '（50%）' : '（不足）')));
      const delta = (label, v, d, invert) => {
        if (Math.abs(v) < 0.05) return;
        parts.push(el('span', { class: (invert ? -v : v) > 0 ? 'good' : 'bad' }, label + ' ' + signed(v, d)));
      };
      delta('住める人数', p.support, 0);
      delta('研究', p.rp, 1);
      delta('速度', p.speed, 1);
      delta('士気目標', p.morale, 1);
      if (p.overflow > 0) parts.push(el('span', { class: 'bad' }, p.overflow + '人があふれる'));
      line.appendChild(el('span', null, pos + '完成後：'));
      parts.forEach((x, k) => { if (k) line.appendChild(document.createTextNode('・')); line.appendChild(x); });
      if (!parts.length) line.appendChild(el('span', { class: 'muted' }, '目に見える変化なし（' + def.name + '）'));
      if (!p.ok) line.appendChild(el('span', { class: 'bad' }, '　※' + p.reason));
      return;
    }
    const F = G.computeFlows(S);
    const m = F.info[i];
    const b = F.blocks.find(x => x.i === i);
    if (!S.hull[i]) line.textContent = pos + '船外' + (tool.type === 'expand' ? '　' + (G.canExpand(S, r, c).ok ? '拡張できる（資材' + G.expandCost(S) + '）' : G.canExpand(S, r, c).reason) : '');
    else if (b) line.textContent = pos + '居住ブロック ' + b.occ + '/' + b.support + '人（定員' + b.cap + '）・空気' + fmt(b.air) + '・食料' + fmt(b.food) + '・快適' + Math.round(b.comfort) + (b.dark ? '・電力なし（暗い）' : '');
    else if (m) line.textContent = pos + m.def.name + '：' + outputText(m, F) + (m.def.fixed ? '' : '・老朽' + Math.round(G.wearLevel(S, m.cell) * 100) + '%');
  }

  function onCell(i) {
    const [r, c] = G.rc(S, i);
    if (tool.type === 'inspect') {
      selected = i; tab = 'info'; render();
      if (window.matchMedia('(max-width: 900px)').matches) {
        const side = document.querySelector('.side');
        if (side) side.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    if (tool.type === 'build') {
      const id = tool.id;
      if (S.cells[i] || !S.hull[i]) { tool = { type: 'inspect', id: null }; selected = i; tab = 'info'; render(); return; }
      if (act(() => G.build(S, r, c, id))) {
        selected = i;
        if (S.ap < 1 || S.mat < D.MODULES[id].cost) { tool = { type: 'inspect', id: null }; render(); }
      }
      return;
    }
    const run = { repair: G.repair, overhaul: G.overhaul, demolish: G.demolish, expand: G.expand }[tool.type];
    if (run && act(() => run(S, r, c))) { selected = i; if (S.ap < 1) setTool('inspect'); }
  }

  function renderControls(F) {
    const box = $('controls');
    box.textContent = '';
    const port = G.currentPort(S);
    if (port) {
      const pd = D.PORTS[port.type];
      const panel = el('div', { class: 'portpanel', style: '--port:' + pd.color });
      panel.appendChild(el('div', { class: 'phead' }, el('b', null, port.name), el('span', { class: 'muted' }, pd.name + '・停泊中')));
      const res = (label, left, take) => el('div', { class: 'pres' }, el('span', null, label), el('b', null, fmt(left)), el('small', { class: take > 0 ? 'good' : 'muted' }, take > 0 ? '+' + fmt(take) + '/T' : '—'));
      panel.appendChild(el('div', { class: 'presrow' },
        res('資材の埋蔵', port.mat, F.harvest.mat),
        res('燃料の埋蔵', port.fuel, F.harvest.fuel),
        port.rp > 0 ? res('研究データ', port.rp, F.harvest.rp) : null));
      if (F.harvestCap.mat <= 0) panel.appendChild(el('div', { class: 'small bad' }, '降下艇格納庫が動いていないため採取できない'));
      panel.appendChild(el('div', { class: 'btnrow' },
        el('button', { type: 'button', class: 'btn on', disabled: true }, 'とどまって採取する'),
        el('button', { type: 'button', class: 'btn primary', onclick: () => act(() => G.setMode(S, 'cruise')) }, '巡航で出発'),
        el('button', { type: 'button', class: 'btn', onclick: () => act(() => G.setMode(S, 'full')) }, '全速で出発')
      ));
      box.appendChild(panel);
    } else {
      const modes = el('div', { class: 'modes', role: 'radiogroup', 'aria-label': '航行モード' });
      for (const key of ['cruise', 'full']) {
        const md = D.MODES[key];
        modes.appendChild(el('button', {
          type: 'button', class: 'btn mode' + (S.mode === key ? ' on' : ''), role: 'radio', 'aria-checked': S.mode === key ? 'true' : 'false',
          title: md.desc, onclick: () => act(() => G.setMode(S, key))
        }, md.name));
      }
      box.appendChild(el('div', { class: 'modewrap' }, el('span', { class: 'muted' }, '航行'), modes, el('span', { class: 'modedesc muted' }, D.MODES[S.mode].desc)));
      const nk = G.nextPortIndex(S);
      if (nk >= 0) {
        const p = S.route.ports[nk];
        const known = G.legIndexAt(S, p.pos) <= G.legIndexAt(S, S.dist) + G.scanRange(S);
        box.appendChild(el('label', { class: 'skipbox' },
          el('input', { type: 'checkbox', checked: p.skip ? null : true, onchange: (e) => act(() => G.setSkipNext(S, !e.target.checked)) }),
          ' 次の寄港地（' + (known ? p.name + '・' + D.PORTS[p.type].name : '未観測') + '）に寄る'));
      }
    }
    const apDots = el('div', { class: 'ap', title: '作業回数：建造・修理・改修・撤去・拡張に1回ずつ使う' }, '作業 ');
    for (let k = 0; k < F.apMax; k++) apDots.appendChild(el('i', { class: k < S.ap ? 'on' : '' }));
    apDots.appendChild(el('span', null, ' ' + S.ap + '/' + F.apMax));
    box.appendChild(el('div', { class: 'endwrap' }, apDots,
      el('button', { type: 'button', class: 'btn primary end', onclick: doEndTurn, title: 'Enterキーでも実行できます' }, 'ターン終了 ▶')));
  }

  /* ---------- サイドパネル ---------- */
  function renderSide(F) {
    document.querySelectorAll('.tab').forEach(b => {
      b.classList.toggle('on', b.dataset.tab === tab);
      b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
    });
    const body = $('tabbody');
    body.textContent = '';
    if (tab === 'build') renderBuildTab(body);
    else if (tab === 'research') renderResearchTab(body);
    else renderInfoTab(body, F);
  }

  function renderBuildTab(body) {
    body.appendChild(el('p', { class: 'hint' }, 'モジュールを選び、空きの居住ブロックに置く（そのマスの住人は他へ移るか、あふれる）。置く前にマスへマウスを乗せると効果を予測できます。'));
    const list = el('div', { class: 'cards' });
    for (const id of D.BUILD_ORDER) {
      const def = D.MODULES[id];
      const unlocked = G.isUnlocked(S, id);
      const afford = S.mat >= def.cost;
      const on = tool.type === 'build' && tool.id === id;
      const meta = ['資材' + def.cost, def.build + 'T'];
      if (def.need) meta.push('⚡' + def.need);
      if (def.fuel) meta.push('燃料' + def.fuel);
      if (def.thrust) meta.push('推力' + def.thrust);
      const pl = G.placementLabel(def.place);
      list.appendChild(el('button', {
        type: 'button',
        class: 'card' + (on ? ' on' : '') + (!unlocked ? ' locked' : '') + (unlocked && !afford ? ' poor' : ''),
        disabled: unlocked ? null : true,
        onclick: () => setTool('build', id),
        title: def.desc
      },
        el('span', { class: 'cglyph', style: 'color:' + def.color + ';border-color:' + def.color }, iconOf(id)),
        el('span', { class: 'cbody' },
          el('span', { class: 'cname' }, def.name, pl ? el('small', { class: 'tag' }, pl) : null),
          el('span', { class: 'cmeta' }, meta.join('・') + (def.emit ? '　' + emitText(def, true) : '')),
          el('span', { class: 'cdesc' }, unlocked ? def.desc : '🔒 研究「' + D.RESEARCH[def.research].name + '」で解放')
        )
      ));
    }
    body.appendChild(list);
  }

  function renderResearchTab(body) {
    body.appendChild(el('p', { class: 'hint' }, '住人が生む研究ポイントで新技術を解放します（作業回数は使いません）。現在 ', el('b', null, fmt(S.rp)), ' pt'));
    const list = el('div', { class: 'cards' });
    for (const id of D.RESEARCH_ORDER) {
      const def = D.RESEARCH[id];
      const done = !!S.researched[id];
      const chk = G.canResearch(S, id);
      list.appendChild(el('div', { class: 'card rcard' + (done ? ' done' : '') },
        el('span', { class: 'cbody' },
          el('span', { class: 'cname' }, def.name, el('small', { class: 'tag' }, done ? '研究済み' : def.cost + ' pt')),
          el('span', { class: 'cdesc' }, def.desc + (def.requires && !done ? '（要：' + D.RESEARCH[def.requires].name + '）' : ''))
        ),
        done ? null : el('button', {
          type: 'button', class: 'btn small' + (chk.ok ? ' primary' : ''), disabled: chk.ok ? null : true, title: chk.ok ? '' : chk.reason,
          onclick: () => act(() => G.research(S, id), '研究完了：' + def.name)
        }, '研究')
      ));
    }
    body.appendChild(list);
  }

  const kv = rows => el('ul', { class: 'kv' }, rows.filter(Boolean).map(([k, v, cls]) => el('li', { class: cls || '' }, el('span', null, k), el('b', null, v))));

  function sourcesList(F, i, field) {
    const src = G.fieldBreakdown(S, F, i, field);
    if (!src.length) return null;
    return el('div', { class: 'src' }, D.FIELDS[field].name + 'の出どころ：', src.slice(0, 5).map(x => {
      const [r, c] = G.rc(S, x.i);
      return el('span', { class: 'srci' }, D.MODULES[x.id].name + '(' + (r + 1) + ',' + (c + 1) + ') ' + signed(x.amount, 0));
    }));
  }

  function renderInfoTab(body, F) {
    if (selected === null) { renderShipSummary(body, F); return; }
    const i = selected;
    const [r, c] = G.rc(S, i);
    const m = F.info[i];
    const b = F.blocks.find(x => x.i === i);
    const pos = '区画 (' + (r + 1) + ', ' + (c + 1) + ')';
    if (!S.hull[i]) {
      const chk = G.canExpand(S, r, c);
      body.appendChild(el('h3', { class: 'itit' }, '船外 ', el('small', null, pos)));
      body.appendChild(el('p', null, '外殻を拡張すると、ここが新しい居住ブロックになります。'));
      body.appendChild(el('button', { type: 'button', class: 'btn' + (chk.ok ? ' primary' : ''), disabled: chk.ok ? null : true, onclick: () => act(() => G.expand(S, r, c)) }, '外殻拡張（資材' + G.expandCost(S) + '）'));
      if (!chk.ok) body.appendChild(el('p', { class: 'muted small' }, chk.reason));
      body.appendChild(backBtn());
      return;
    }
    if (b) {
      const tags = [];
      if (G.isRear(S, S.hull, r, c)) tags.push('船尾');
      if (G.isEdge(S, S.hull, r, c)) tags.push('外縁');
      body.appendChild(el('h3', { class: 'itit' }, el('span', { class: 'cglyph blk' }, iconOf('block')), ' 居住ブロック ', el('small', null, pos + (tags.length ? '・' + tags.join('・') : ''))));
      const airCap = Math.floor(b.air / D.RULES.airPerPerson + 1e-9), foodCap = Math.floor(b.food / D.RULES.foodPerPerson + 1e-9);
      const limit = b.support >= b.cap ? '定員' : airCap <= foodCap ? '空気' : '食料';
      body.appendChild(kv([
        ['住人', b.occ + ' / ' + b.support + '人（定員' + b.cap + '）'],
        ['住める人数を決めているもの', limit, b.support < b.cap ? 'neg' : 'pos'],
        ['空気', fmt(b.air) + '（' + airCap + '人分）', airCap < b.cap ? 'neg' : ''],
        ['食料', fmt(b.food) + '（' + foodCap + '人分）', foodCap < b.cap ? 'neg' : ''],
        ['快適', Math.round(b.comfort) + (b.comfort < 30 ? '（不満）' : b.comfort >= 70 ? '（良好）' : ''), b.comfort < 30 ? 'neg' : b.comfort >= 70 ? 'pos' : ''],
        ['電力', fmt(b.power) + (b.dark ? '（暗い・快適−8）' : '')],
        ['研究', '+' + fmt(b.rp, 2) + '/ターン（研究支援+' + fmt(b.lab) + '%）'],
        ['人口増加', b.growth > 0 ? '+' + fmt(b.growth, 2) + '/ターン' : '—'],
        ['医療・シールド', (b.med > 0 ? '医療+' + fmt(b.med) + '%' : '医療なし') + '・' + (b.shielded ? '防護あり' : '防護なし')]
      ]));
      for (const f of ['air', 'food', 'comfort']) { const x = sourcesList(F, i, f); if (x) body.appendChild(x); }
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
      body.appendChild(el('p', { class: 'small' }, 'ここに建造（数字は資材。住人' + b.occ + '人は他のブロックへ移る）：'));
      body.appendChild(quick);
      body.appendChild(backBtn());
      return;
    }
    const def = m.def;
    body.appendChild(el('h3', { class: 'itit' }, el('span', { class: 'cglyph', style: 'color:' + def.color + ';border-color:' + def.color }, iconOf(m.id)), ' ', def.name, ' ', el('small', null, pos)));
    const L = G.lifespan(S, m.id);
    const w = G.wearLevel(S, m.cell);
    body.appendChild(kv([
      ['状態', statusText(m), m.status === 'active' && m.eff >= 1 ? 'pos' : m.status === 'active' && m.eff > 0 ? '' : 'neg'],
      ['出力', outputText(m, F)],
      def.need ? ['電力', fmt(m.power, 1) + ' / 必要' + def.need, m.power >= def.need ? 'pos' : 'neg'] : null,
      def.fixed ? null : ['老朽度', Math.round(w * 100) + '%（' + fmt(m.cell.age) + ' / 寿命' + fmt(L) + 'ターン）', w >= 0.85 ? 'neg' : ''],
      def.fixed ? null : ['故障の起きやすさ', fmt(G.breakChance(S, m.cell) * 100, 1) + '% / ターン', w >= D.RULES.wearStart ? 'neg' : ''],
      def.fuel ? ['燃料', def.fuel + (def.kind === 'engine' || def.kind === 'booster' ? '（全速で2倍）' : '') + '/ターン'] : null,
      def.emit ? ['範囲', emitText(def)] : null
    ]));
    if (m.notes.length) body.appendChild(el('p', { class: 'notes' }, '⚠ ' + m.notes.join('・')));
    if (def.need) { const x = sourcesList(F, i, 'power'); if (x) body.appendChild(x); }
    body.appendChild(el('p', { class: 'desc' }, def.desc));
    if (!def.fixed) {
      const btns = el('div', { class: 'btnrow' });
      const rep = G.canRepair(S, r, c);
      if (m.cell.broken) btns.appendChild(el('button', { type: 'button', class: 'btn' + (rep.ok ? ' primary' : ''), disabled: rep.ok ? null : true, title: rep.ok ? '' : rep.reason, onclick: () => act(() => G.repair(S, r, c)) }, '修理（資材' + D.RULES.repairCost + '）'));
      const oh = G.canOverhaul(S, r, c);
      btns.appendChild(el('button', { type: 'button', class: 'btn' + (oh.ok && w >= D.RULES.wearStart ? ' primary' : ''), disabled: oh.ok ? null : true, title: oh.ok ? '' : oh.reason, onclick: () => act(() => G.overhaul(S, r, c)) }, '改修（資材' + G.overhaulCost(S, m.id) + '・' + G.overhaulTurns(S) + 'T停止）'));
      if (m.status !== 'building') btns.appendChild(el('button', { type: 'button', class: 'btn', onclick: () => act(() => G.toggle(S, r, c)) }, m.cell.enabled ? '停止する' : '稼働させる'));
      const dem = G.canDemolish(S, r, c);
      btns.appendChild(el('button', { type: 'button', class: 'btn danger', disabled: dem.ok ? null : true, title: dem.ok ? '' : dem.reason, onclick: () => act(() => G.demolish(S, r, c)) }, '撤去（資材+' + G.demolishRefund(S, r, c) + '）'));
      body.appendChild(btns);
      body.appendChild(el('p', { class: 'muted small' }, '修理は故障を直すだけで老朽化は残ります。改修は数ターン止まりますが、新品同様に戻ります。'));
    }
    body.appendChild(backBtn());
  }

  function backBtn() {
    return el('button', { type: 'button', class: 'btn ghost small', onclick: () => { selected = null; render(); } }, '← 船の概況に戻る');
  }

  function renderShipSummary(body, F) {
    body.appendChild(el('h3', { class: 'itit' }, '船の概況'));
    body.appendChild(el('p', { class: 'muted small' }, '区画をクリックすると詳細を表示します。'));
    const section = (title, rows) => { body.appendChild(el('h4', { class: 'sub' }, title)); body.appendChild(kv(rows)); };
    const issues = [];
    const broken = F.mods.filter(m => m.status === 'broken');
    if (broken.length) issues.push(['✖ 故障中', broken.map(m => m.def.name).join('、'), 'neg']);
    const low = F.mods.filter(m => m.status === 'active' && m.eff < 1 && !(m.def.emit && m.def.emit.power));
    if (low.length) issues.push(['⚡ 電力不足', low.map(m => m.def.name).join('、'), 'neg']);
    const worn = F.mods.filter(m => !m.def.fixed && m.status === 'active' && G.wearLevel(S, m.cell) >= 0.8);
    if (worn.length) issues.push(['🔧 寿命が近い', worn.map(m => m.def.name + ' ' + Math.round(G.wearLevel(S, m.cell) * 100) + '%').join('、'), 'neg']);
    const empty = F.blocks.filter(b => b.support <= 0).length;
    if (empty) issues.push(['居住できないブロック', empty + 'マス（空気か食料が届いていない）']);
    if (F.overflow) issues.push(['あふれている人', F.overflow + '人（毎ターン一部が失われる）', 'neg']);
    section('気になること', issues.length ? issues : [['特になし', '順調です', 'pos']]);
    section('衝撃波', [
      ['距離', F.gap <= 0 ? '呑まれている' : fmt(F.gap) + ' 光年', F.gap <= 0 ? 'neg' : ''],
      ['衝撃波の速さ', fmt(F.waveSpeed, 1) + ' 光年/ターン（だんだん速くなる）'],
      ['船の速さ', fmt(F.speed, 1) + ' 光年/ターン', F.speed < F.waveSpeed ? 'neg' : 'pos'],
      ['到達まで', F.waveEta !== null ? '約' + F.waveEta + 'ターン' : '引き離し中', F.waveEta !== null && F.waveEta <= 6 ? 'neg' : '']
    ]);
    section('士気（目標 ' + fmt(F.moraleTarget) + '）', F.moraleParts.map(p => [p[0], p[1] < 0 ? signed(p[1], 0) : fmt(p[1]), p[1] < 0 ? 'neg' : '']));
    const pop = F.blocks.reduce((a, b) => a + b.cap, 0);
    section('居住', [
      ['居住ブロック', F.blocks.length + 'マス（定員の合計 ' + pop + '人）'],
      ['住める人数', F.support + '人'],
      ['研究', '+' + fmt(F.rpProd, 1) + '/ターン']
    ]);
  }

  /* ---------- 結果のまとめと日誌 ---------- */
  function renderSummary() {
    const box = $('summary');
    const sm = S.summary;
    if (!sm) { box.hidden = true; return; }
    box.hidden = false;
    box.textContent = '';
    const item = (label, v, d, invert) => el('span', { class: 'sumi ' + (Math.abs(v) < 0.05 ? '' : ((invert ? -v : v) > 0 ? 'good' : 'bad')) }, label + ' ', el('b', null, signed(v, d || 0)));
    box.appendChild(el('span', { class: 'sumt' }, 'ターン' + sm.turn + 'の結果'));
    box.appendChild(item('人口', sm.popDelta));
    if (sm.births || sm.deaths) box.appendChild(el('span', { class: 'muted small' }, '（誕生' + sm.births + '・死亡' + sm.deaths + '）'));
    box.appendChild(el('span', { class: 'sumi' }, '前進 ', el('b', null, fmt(sm.dist)), ' 光年'));
    box.appendChild(item('資材', sm.mat));
    box.appendChild(item('燃料', sm.fuel));
    box.appendChild(item('研究', sm.rp));
  }

  function renderLog() {
    const box = $('log');
    box.textContent = '';
    const groups = [];
    for (const e of S.log.slice(-150)) {
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
    if (tool.type === 'build' && S.mat < D.MODULES[tool.id].cost) tool = { type: 'inspect', id: null };
    if (selected !== null && !S.hull[selected]) selected = null;
    snapshot();
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
    const box = $('modalbox');
    box.textContent = '';
    box.className = 'modal ' + kind;
    build(box);
    $('modal').hidden = false;
    const f = box.querySelector('button.primary') || box.querySelector('button');
    if (f) f.focus();
  }
  function closeModal() { modalKind = null; $('modal').hidden = true; }

  function syncModal() {
    if (!S) return;
    if (S.status !== 'playing') { if (!['end', 'end-view', 'help', 'menu'].includes(modalKind)) showEnd(); return; }
    if (S.pendingEvent) { if (modalKind !== 'event') showEvent(); return; }
    if (modalKind === 'event' || modalKind === 'end') closeModal();
  }

  function showEvent() {
    const pe = S.pendingEvent;
    openModal('event', box => {
      const port = G.currentPort(S);
      box.appendChild(el('div', { class: 'mkicker' }, 'ターン ' + S.turn + '・' + (port ? port.name : D.LEGS[G.currentLeg(S).type].name)));
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
            snapshot();
            save();
            render();
            if (res.lines && res.lines.length) toast(res.lines[res.lines.length - 1], res.kind === 'danger' ? 'bad' : res.kind === 'good' ? 'good' : '');
          }
        }, el('b', null, ch.label), el('small', null, ch.hint)));
      });
      box.appendChild(list);
    });
  }

  function readBest() { try { return JSON.parse(storageGet(BEST_KEY) || 'null') || {}; } catch (e) { return {}; } }

  function showEnd() {
    const won = S.status === 'won';
    const bests = readBest();
    const best = bests[S.difficulty];
    let isBest = false;
    if (won && S.score && (!best || S.score.score > best.score)) {
      bests[S.difficulty] = Object.assign({ date: new Date().toISOString().slice(0, 10) }, S.score);
      storageSet(BEST_KEY, JSON.stringify(bests));
      isBest = true;
    }
    openModal('end', box => {
      box.appendChild(el('div', { class: 'mkicker' }, (won ? '航海成功' : '航海失敗') + '・' + D.DIFFICULTY[S.difficulty].name));
      box.appendChild(el('h2', null, won ? '新天地ヴェルダに到達' : '方舟の灯が消えた'));
      box.appendChild(el('p', null, S.endReason));
      box.appendChild(kv([
        ['航海ターン', String(S.turn - 1)],
        ['到着時の人口', String(S.pop)],
        ['最大人口', String(S.stats.maxPop)],
        ['誕生 / 犠牲', S.stats.born + ' / ' + S.stats.lost],
        ['寄港', S.stats.ports + 'か所（採取 ' + fmt(S.stats.harvested) + '）'],
        ['建造 / 修理 / 改修', S.stats.built + ' / ' + S.stats.repaired + ' / ' + S.stats.overhauled],
        ['航行距離', fmt(S.dist) + ' 光年']
      ]));
      if (won && S.score) {
        box.appendChild(el('div', { class: 'score' },
          el('span', { class: 'rank r-' + S.score.rank }, S.score.rank),
          el('span', null, 'スコア ', el('b', null, fmt(S.score.score)), isBest ? el('em', null, ' 自己ベスト！') : null)));
        box.appendChild(el('p', { class: 'muted small' }, 'スコア =（人口×10 + 士気×3 + 早さボーナス）× 難易度の倍率'));
      }
      if (best && !isBest) box.appendChild(el('p', { class: 'muted small' }, 'この難易度の自己ベスト：' + best.rank + '（' + fmt(best.score) + '・' + best.turn + 'ターン）'));
      box.appendChild(el('div', { class: 'btnrow' },
        el('button', { type: 'button', class: 'btn primary', onclick: () => { closeModal(); showDifficulty(); } }, '新しい航海へ'),
        el('button', { type: 'button', class: 'btn', onclick: () => { modalKind = 'end-view'; $('modal').hidden = true; } }, '船を眺める')
      ));
    });
  }

  function showDifficulty() {
    openModal('diff', box => {
      box.appendChild(el('h2', null, '難易度を選ぶ'));
      const bests = readBest();
      const list = el('div', { class: 'choices' });
      for (const key of ['easy', 'normal', 'hard']) {
        const d = D.DIFFICULTY[key];
        const b = bests[key];
        list.appendChild(el('button', {
          type: 'button', class: 'btn choice' + (key === 'normal' ? ' primary' : ''),
          onclick: () => { closeModal(); startNew(undefined, key); }
        }, el('b', null, d.name), el('small', null, d.desc + (b ? '（自己ベスト ' + b.rank + '・' + fmt(b.score) + '）' : ''))));
      }
      box.appendChild(list);
      box.appendChild(el('div', { class: 'btnrow center' }, el('button', { type: 'button', class: 'btn ghost', onclick: () => { closeModal(); if (S) syncModal(); else showTitle(); } }, 'もどる')));
    });
  }

  function showTitle() {
    const hasSave = !!storageGet(SAVE_KEY);
    openModal('title', box => {
      box.appendChild(el('div', { class: 'tlogo' }, 'DRIFT ARK'));
      box.appendChild(el('div', { class: 'tsub' }, '世代船グリッド航行記'));
      box.appendChild(el('p', null, '母星の恒星が崩壊を始めた。背後から迫る衝撃波を振り切り、最後の世代船は' + D.RULES.totalDistance.toLocaleString('ja-JP') + '光年先の惑星ヴェルダを目指す。'));
      box.appendChild(el('p', null, '施設は周囲のマスに電力・空気・食料・快適さを届ける。何も置かないマスに人が住む。配置を練り、寄港地で資源を集め、老いていく船を保ちながら旅を続けよう。'));
      const btns = el('div', { class: 'btnrow center' });
      if (hasSave) btns.appendChild(el('button', { type: 'button', class: 'btn primary', onclick: () => { closeModal(); if (!loadSave()) showTitle(); } }, '続きから'));
      btns.appendChild(el('button', { type: 'button', class: 'btn' + (hasSave ? '' : ' primary'), onclick: () => { closeModal(); showDifficulty(); } }, '新しい航海'));
      btns.appendChild(el('button', { type: 'button', class: 'btn ghost', onclick: showHelp }, '遊び方'));
      box.appendChild(btns);
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
        '目的地ヴェルダまで' + D.RULES.totalDistance.toLocaleString('ja-JP') + '光年。背後から恒星の衝撃波が迫り、だんだん速くなる。追いつかれると船が壊れ、人が失われる。',
        '人口が0になるか、' + D.RULES.maxTurns + 'ターンを過ぎると失敗。到着時の人口・士気・早さでスコアが決まる。'
      ]);
      sec('居住ブロックと範囲供給', [
        '何も置いていない船体マスは「居住ブロック」。定員は20人（研究で30人）。',
        '施設は周囲のマスに電力・空気・食料・快適さなどを届ける。隣のマスは100%、2マス先は50%、3マス先は25%。',
        '居住ブロックに住める人数は、届いている空気（1人0.4）と食料（1人0.5）で決まる。住める人数を超えた人はあふれて、毎ターン一部が失われる。',
        '施設を建てると、そのマスの居住ブロックはなくなる（住人は空きのある別のブロックへ移る）。',
        '施設は、届いている電力が必要量以上で100%、半分以上で50%、それ未満は止まる。',
        '炉・推進器などは騒音や排熱で隣の快適さを下げる。ラウンジは上げる。快適さの平均が士気になる。'
      ]);
      sec('研究と人口', [
        '研究は住人が生む。研究ラボの近くに住む人ほど多くの研究を生む。',
        '空きのある快適な居住ブロックでは人口が増える。医務室の範囲ではさらに増えやすい。'
      ]);
      sec('寄港と航行', [
        '航路の途中にある寄港地に着くと停泊する。降下艇格納庫が資材・燃料（ステーションでは研究データも）を採る。埋蔵量には限りがある。',
        '出発するときは「巡航で出発」か「全速で出発」。次の寄港地に寄らずに通過することもできる。',
        '速度 = ' + D.RULES.drift + ' + 推力。推進器は船尾（左隣が船外）にしか置けない。推力増幅器を推進器の上下左右に置くと推力+50%。',
        '全速は推力1.5倍だが、推進器の燃料と老朽化が2倍。'
      ]);
      sec('老朽化と整備', [
        'モジュールは使うほど老いる。寿命の6割を過ぎると故障しやすくなり、寿命を過ぎるとほぼ毎ターン壊れる。',
        '「修理」は故障を直すだけ（安い）。「改修」は数ターン止まるが、新品同様に戻る。寄港中の改修がおすすめ。'
      ]);
      sec('操作', [
        'クリック：区画を調べる／選んだツールを使う。建造ツールでマスにマウスを乗せると、完成後の効果を予測できる。',
        '「範囲表示」で電力・空気・食料などの届き方を色と数字で見られる。',
        'Enter：ターン終了　Ctrl+Z：このターンの操作をやり直す　Esc：ツール解除'
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
      box.appendChild(el('p', { class: 'muted small' }, '航海は操作ごとにこのブラウザへ自動保存されます。難易度：' + D.DIFFICULTY[S.difficulty].name + '・シード：' + S.seed));
      box.appendChild(el('div', { class: 'btnrow col' },
        el('button', { type: 'button', class: 'btn primary', onclick: () => { closeModal(); syncModal(); } }, '航海に戻る'),
        el('button', { type: 'button', class: 'btn', onclick: showHelp }, '遊び方'),
        el('button', { type: 'button', class: 'btn danger', onclick: () => { if (window.confirm('現在の航海を破棄して、新しい航海を始めますか？')) { closeModal(); showDifficulty(); } } }, '新しい航海を始める'),
        el('button', { type: 'button', class: 'btn ghost', onclick: () => { closeModal(); showTitle(); } }, 'タイトルへ')
      ));
    });
  }

  /* ---------- 開始・読み込み ---------- */
  function startNew(seed, difficulty) {
    S = G.newGame(seed, difficulty);
    tool = { type: 'inspect', id: null };
    selected = null;
    tab = 'build';
    overlay = 'none';
    lastTurnSeen = 1;
    snapshot();
    save();
    render();
  }

  function loadSave() {
    const raw = storageGet(SAVE_KEY);
    if (!raw) return false;
    try { S = G.deserialize(raw); } catch (e) {
      toast('セーブデータを読み込めませんでした', 'bad');
      storageDel(SAVE_KEY);
      return false;
    }
    tool = { type: 'inspect', id: null };
    selected = null;
    lastTurnSeen = S.turn;
    snapshot();
    render();
    return true;
  }

  function init() {
    document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
    $('btn-help').addEventListener('click', showHelp);
    $('btn-menu').addEventListener('click', () => { if (S) showMenu(); else showTitle(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (modalKind === 'help' || modalKind === 'menu' || modalKind === 'diff') { closeModal(); if (S) syncModal(); else showTitle(); return; }
        if (tool.type !== 'inspect') { setTool('inspect'); return; }
        if (selected !== null) { selected = null; render(); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !modalKind) { e.preventDefault(); undo(); return; }
      // Enter はいつでも「ターン終了」（モーダル表示中を除く）。ボタンに焦点があっても誤操作しないよう既定動作を止める
      if (e.key === 'Enter' && !modalKind && S && !e.isComposing) {
        if (e.target && e.target.tagName === 'INPUT') return;
        e.preventDefault();
        doEndTurn();
      }
    }, true);
    // URL の ?seed=123&difficulty=hard で航路と難易度を固定できる（検証用）
    const m = /[?&]seed=(-?\d+)/.exec(window.location.search);
    const dm = /[?&]difficulty=(easy|normal|hard)/.exec(window.location.search);
    if (m) { startNew(parseInt(m[1], 10), dm ? dm[1] : 'normal'); return; }
    showTitle();
  }

  document.addEventListener('DOMContentLoaded', init);
})();

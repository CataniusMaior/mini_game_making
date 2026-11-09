/*
 * DRIFT ARK — モジュールのアイコン（オリジナルの線画ピクトグラム）
 * 24×24 の座標で描き、線の色は親要素の color（currentColor）を使う。
 */
(function (root) {
  'use strict';

  const ICONS = {
    // 居住区：家
    hab: '<path d="M3.5 11.5 12 4l8.5 7.5"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
    // 生命維持装置：空気の流れ
    life: '<path d="M3 8.5h10.5a3 3 0 1 0-3-3"/><path d="M3 12.5h14.5a3 3 0 1 1-3 3"/><path d="M3 16.5h6"/>',
    // 水耕農場：芽と水面
    farm: '<path d="M12 19v-7"/><path d="M12 12c0-4.2 2.8-7 7.5-7 0 4.5-2.8 7-7.5 7z"/><path d="M12 14.5c0-3-2-5-5.5-5 0 3.4 2 5 5.5 5z"/><path d="M4 19.5c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1"/>',
    // 核分裂炉：原子
    reactor: '<circle cx="12" cy="12" r="1.7"/><ellipse cx="12" cy="12" rx="9" ry="3.5"/><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(120 12 12)"/>',
    // 集光パネル：傾いたパネルと支柱
    solar: '<path d="M3 16 6.5 6h11L21 16z"/><path d="M4.8 11h14.4"/><path d="M10.2 6 9.2 16"/><path d="M13.8 6l1 10"/><path d="M12 16v4"/><path d="M8.5 20h7"/>',
    // 推進器：本体・噴射口・噴流（船は右へ進むので噴流は左）
    engine: '<path d="M21 8.5v7h-6v-7z"/><path d="M15 10 10 7v10l5-3"/><path d="M7 9H3.5"/><path d="M7.5 12H2"/><path d="M7 15H3.5"/>',
    // 貯蔵庫：コンテナ
    storage: '<path d="M3.5 8 12 4l8.5 4v8.5L12 20.5l-8.5-4z"/><path d="M3.5 8 12 12l8.5-4"/><path d="M12 12v8.5"/><path d="M7.8 6l8.5 4"/>',
    // 研究ラボ：フラスコ
    lab: '<path d="M9 3.5h6"/><path d="M10 3.5V9l-5.2 8.7A2 2 0 0 0 6.5 20.7h11a2 2 0 0 0 1.7-3L14 9V3.5"/><path d="M7.4 15h9.2"/><circle cx="10.5" cy="17.6" r=".6"/><circle cx="13.6" cy="18.3" r=".6"/>',
    // 工房：スパナ
    shop: '<path d="M14.8 3.6a4.6 4.6 0 0 0-4.1 6.4L3.9 16.8a1.9 1.9 0 0 0 2.7 2.7l6.8-6.8a4.6 4.6 0 0 0 6.4-4.1l-2.6 2.6-2.6-.6-.6-2.6z"/>',
    // ドローン格納庫：4つの回転翼
    drone: '<rect x="9.5" y="10" width="5" height="4" rx="1"/><path d="M9.5 10.8 7.6 9M14.5 10.8 16.4 9M9.5 13.2l-1.9 1.8M14.5 13.2l1.9 1.8"/><circle cx="6" cy="7.5" r="2.6"/><circle cx="18" cy="7.5" r="2.6"/><circle cx="6" cy="16.5" r="2.6"/><circle cx="18" cy="16.5" r="2.6"/>',
    // 燃料精製所：しずくと矢印
    refinery: '<path d="M12 3.5c3 3.9 5.7 6.7 5.7 10.2a5.7 5.7 0 0 1-11.4 0c0-3.5 2.7-6.3 5.7-10.2z"/><path d="M9.3 14.2a2.7 2.7 0 0 0 2.7 2.7"/>',
    // ラウンジ：湯気の立つカップ
    lounge: '<path d="M4.5 10h11.5v4.5a5 5 0 0 1-5 5h-1.5a5 5 0 0 1-5-5z"/><path d="M16 11.2h1.3a2.4 2.4 0 0 1 0 4.8H16"/><path d="M8.5 3.2c1.1 1.1-1.1 2.2 0 3.6M12.5 3.2c1.1 1.1-1.1 2.2 0 3.6"/>',
    // 医務室：十字
    medbay: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 7.5v9M7.5 12h9"/>',
    // シールド発生器：盾
    shield: '<path d="M12 3.2 19.5 6v6c0 4.6-3.2 7.7-7.5 8.8C7.7 19.7 4.5 16.6 4.5 12V6z"/><path d="M8.8 12.2 11 14.4l4.3-4.6"/>',
    // バイオドーム：ドームと植物
    bio: '<path d="M2.5 19.5h19"/><path d="M3.5 19.5a8.5 8.5 0 0 1 17 0"/><path d="M8.5 11.5c1-1.3 2.2-2 3.5-2.2"/><path d="M12 19.5v-3.8"/><path d="M12 15.7c0-1.8 1.3-3 3.3-3 0 2-1.3 3-3.3 3z"/><path d="M12 17c0-1.4-1-2.3-2.6-2.3 0 1.6 1 2.3 2.6 2.3z"/>',
    // 高密度居住区：塔
    arcology: '<path d="M7 20.5V5.5L12 3l5 2.5v15"/><path d="M3.5 20.5h17"/><path d="M10 8h.01M14 8h.01M10 11.5h.01M14 11.5h.01M10 15h.01M14 15h.01"/><path d="M10.5 20.5v-2.5h3v2.5"/>',
    // イオン推進器：推進器と放電
    ion: '<path d="M21 8.5v7h-6v-7z"/><path d="M15 10 10 7v10l5-3"/><path d="M6.5 6.5 3.5 12h3.2l-2.2 5.5"/>',
    // 核融合炉：閉じ込めた光
    fusion: '<circle cx="12" cy="12" r="8.8"/><path d="M12 6.3l1.4 4.3 4.3 1.4-4.3 1.4-1.4 4.3-1.4-4.3L6.3 12l4.3-1.4z"/>'
  };

  // 未定義のときの予備（四角）
  const FALLBACK = '<rect x="5" y="5" width="14" height="14" rx="3"/>';

  function icon(id) {
    const wrap = document.createElement('span');
    wrap.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICONS[id] || FALLBACK) + '</svg>';
    return wrap.firstChild;
  }

  root.ArkIcons = { icon, ids: Object.keys(ICONS) };
})(typeof self !== 'undefined' ? self : this);

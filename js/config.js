// 調整用の設定値はすべてここ。秒・ピクセル単位。
// 画面は 960x640 の論理座標。
var CONFIG = {
  // 本体の制限時間（秒）
  bodyTime: 90,

  // 闘技場（白砂）の範囲
  arena: { x0: 40, y0: 86, x1: 920, y1: 556 },

  // 初期配置
  layout: {
    body: { x: 150, y: 480 },
    enemy: { x: 690, y: 250 },
    clones: [
      { x: 300, y: 330 },
      { x: 225, y: 400 },
      { x: 330, y: 455 },
    ],
  },

  clone: {
    radius: 14,
    speed: 225, // 移動速度 px/秒
  },

  katana: {
    range: 64, // 刃の届く距離（分身の中心から）
    arcDeg: 120, // 振りの角度
    windup: 0.05, // 振り始め
    active: 0.09, // 当たり判定が出ている時間
    recover: 0.3, // 振り終わりの硬直
    damage: 1, // 通常時のダメージ
    openDamage: 3, // 敵の隙（大技の後）に当てたときのダメージ
    moveMul: 0.35, // 振っている間の移動速度倍率
    buffer: 0.15, // 先行入力の受付時間
  },

  shuriken: {
    count: 5, // 分身ひとりあたりの所持数（回復しない）
    speed: 660,
    radius: 6,
    cooldown: 0.4,
    damage: 3, // 通常時（刀の3倍。枚数が少ないぶん一発が重い）
    openDamage: 5, // 隙に当てたとき
    life: 1.6,
  },

  enemy: {
    hp: 55,
    radius: 24,
    speed: 100, // 歩く速さ（分身より遅い）
    firstThink: 2.2, // 開始直後の様子見
    thinkMin: 0.5, // 攻撃の合間（ランダム幅）
    thinkMax: 1.1,
    aggroThink: 0.25, // 隙以外で斬られたとき、すぐ反撃に移るまでの時間
    patience: 2.4, // 遠くても突進に踏み切るまでの時間

    // 突進斬り：狙った分身へ直線。予備動作の前半は狙いを追い、後半で方向が固定される
    dash: {
      windup: 1.0,
      track: 0.55, // ここまで狙いを追う（以降は方向固定＝避けどき）
      speed: 980,
      overshoot: 160, // 狙った位置からさらに踏み込む距離
      minLen: 200,
      maxLen: 540,
      minRange: 120,
      maxRange: 520,
      halfWidth: 26, // 当たり幅（予告の帯と同じ）
      recover: 1.2, // 隙（避けた本人は届きにくい）
    },

    // 範囲薙ぎ払い：近くの分身をまとめて斬る。密集対策
    sweep: {
      windup: 0.8,
      radius: 118, // 予告の円と同じ
      trigger: 135, // この距離以内に分身がいると選びやすい
      crowd: 2, // この人数が近くにいると必ず薙ぎ払う
      active: 0.12,
      recover: 0.9,
      creep: 45, // 予備動作中ににじり寄る速さ
    },
  },
};
if (typeof module !== 'undefined') module.exports = CONFIG;

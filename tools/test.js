// node tools/test.js            ルール確認 + ボット対戦での駆け引き確認
// node tools/test.js --games 300
const path = require('path');
const BASE = require(path.join(__dirname, '../js/config.js'));
const Sim = require(path.join(__dirname, '../js/logic.js'));
const C = () => JSON.parse(JSON.stringify(BASE));
const DT = 1 / 120;
let fails = 0;
function ok(cond, msg) { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; }
function run(s, sec, inputFn) { const n = Math.round(sec / DT); for (let i = 0; i < n && s.phase === 'play'; i++) Sim.step(s, DT, inputFn ? inputFn(s, i) : {}); }

console.log('■ ルール');
{ // 一撃で消滅、補充されない
  const s = Sim.create(C(), 1);
  s.clones[0].x = s.enemy.x - 60; s.clones[0].y = s.enemy.y;
  s.enemy.think = 0;
  run(s, 2.0);
  ok(!s.clones[0].alive, '薙ぎ払いが一度当たった分身は消滅する');
  run(s, 20);
  ok(s.clones.filter((c) => c.alive).length <= 2, '消滅した分身は復活しない（20秒後も増えない）');
}
{ // 消滅した分身は選べない／自動引き継ぎ
  const s = Sim.create(C(), 2);
  s.active = 1;
  s.clones[1].x = s.enemy.x - 60; s.clones[1].y = s.enemy.y;
  s.enemy.think = 0;
  run(s, 2.0);
  ok(!s.clones[1].alive, '操作中の分身1が斬られた');
  ok(s.active !== 1 && s.clones[s.active].alive, `自動で生存中の分身${s.active + 1}に引き継がれた`);
  ok(s.events.some((e) => e.type === 'autoSwitch'), 'autoSwitch イベントが出る');
  const before = s.active;
  Sim.step(s, DT, { select: 1 });
  ok(s.active === before, '消滅した分身2（番号キー）は選べない');
  ok(s.events.some((e) => e.type === 'selectDead'), 'selectDead が通知される');
  for (let k = 0; k < 6; k++) { Sim.step(s, DT, { switchNext: true }); ok(s.clones[s.active].alive, `Space 切替${k + 1}回目も生存者のみ（→${s.active + 1}）`); }
}
{ // 切り替えで予備動作・狙いがキャンセルされない
  const s = Sim.create(C(), 3);
  s.clones.forEach((c, i) => { c.x = 120 + i * 30; c.y = 150; });
  s.clones[0].x = s.enemy.x - 300; s.clones[0].y = s.enemy.y;
  s.enemy.think = 0;
  Sim.step(s, DT, {});
  ok(s.enemy.state === 'dashWind' && s.enemy.target === 0, '突進斬りの予備動作に入り、分身1を狙う');
  let cancelled = false;
  for (let i = 0; i < 200 && s.enemy.state !== 'recover'; i++) {
    Sim.step(s, DT, i % 10 === 0 ? { switchNext: true } : i % 10 === 5 ? { select: 2 } : {});
    if (s.enemy.state === 'stalk') cancelled = true;
    if (s.enemy.target !== 0) cancelled = true;
  }
  ok(!cancelled, '切り替えを連打しても予備動作・突進は中断されず、狙いも分身1のまま');
  ok(!s.clones[0].alive, '狙われた（待機中の）分身1は突進で消滅');
  ok(s.enemy.state === 'recover' && s.enemy.open, '突進のあとに隙ができる');
}
{ // 手裏剣は分身ごと
  const s = Sim.create(C(), 4);
  s.enemy.think = 99;
  const aim = { x: 40, y: 100 };
  Sim.step(s, DT, { throw: true, aim }); run(s, 0.5);
  Sim.step(s, DT, { throw: true, aim }); run(s, 0.5);
  Sim.step(s, DT, { select: 1 });
  Sim.step(s, DT, { throw: true, aim }); run(s, 0.5);
  const N = BASE.shuriken.count;
  const n = s.clones.map((c) => c.shuriken).join(',');
  ok(n === [N - 2, N - 1, N].join(','), `手裏剣の残数が分身ごとに減る（${n}）`);
  Sim.step(s, DT, { select: 0 });
  for (let k = 0; k < N - 2; k++) { Sim.step(s, DT, { throw: true, aim }); run(s, 0.5); }
  s.events.length = 0;
  Sim.step(s, DT, { throw: true, aim }); run(s, 0.5);
  ok(s.clones[0].shuriken === 0 && s.events.some((e) => e.type === 'empty'), '0枚では投げられない（empty）');
  let gained = false; run(s, 30, (ss) => { if (ss.clones.some((c, i) => c.shuriken > [0, N - 1, N][i])) gained = true; return {}; });
  ok(!gained, '時間経過で回復しない');
  const s2 = Sim.create(C(), 5);
  s2.active = 2; s2.clones[2].x = s2.enemy.x - 60; s2.clones[2].y = s2.enemy.y; s2.enemy.think = 0;
  run(s2, 2);
  ok(!s2.clones[2].alive && s2.clones[2].shuriken === 0 && s2.clones[2].lostShuriken === BASE.shuriken.count, '消滅した分身の手裏剣は失われる');
  ok(s2.clones[s2.active].shuriken === BASE.shuriken.count, `引き継いだ分身は自分の${BASE.shuriken.count}枚のまま`);
}
{ // 決着
  const s = Sim.create(C(), 6);
  s.clones.forEach((c, i) => { c.x = 60 + i * 30; c.y = 110; });
  s.enemy.x = 880; s.enemy.y = 520; s.enemy.think = 999;
  s.C.enemy.speed = 0;
  run(s, 100);
  ok(s.phase === 'lost' && s.result === 'body', `本体の時間切れで敗北（result=${s.result}）`);
  ok(s.clones.every((c) => !c.alive), '本体が死ぬと分身も全員消える');
  const w = Sim.create(C(), 7);
  w.clones.forEach((c) => { c.x = w.enemy.x - 40; c.y = w.enemy.y + (c.id - 1) * 30; });
  w.enemy.think = 0;
  run(w, 3);
  ok(w.phase === 'lost' && w.result === 'wipe', `全滅で敗北（result=${w.result}）`);
  const v = Sim.create(C(), 8);
  v.enemy.hp = 1; v.enemy.think = 99;
  v.clones[0].x = v.enemy.x - 50; v.clones[0].y = v.enemy.y;
  Sim.step(v, DT, { attack: true, aim: { x: v.enemy.x, y: v.enemy.y } });
  run(v, 0.3);
  ok(v.phase === 'won' && v.result === 'win', '敵の体力0で勝利');
}
{ // リトライ相当（新規生成）で初期化
  const a = Sim.create(C(), 9);
  run(a, 5, () => ({ attack: true, throw: true, move: { x: 1, y: 0 }, aim: { x: 900, y: 300 } }));
  const b = Sim.create(C(), 9);
  ok(b.time === 0 && b.body.life === BASE.bodyTime && b.enemy.hp === BASE.enemy.hp && b.shots.length === 0 &&
    b.clones.every((c) => c.alive && c.shuriken === BASE.shuriken.count && !c.swing) && b.enemy.state === 'stalk' && b.enemy.atk === null,
  'create() で時間・体力・手裏剣・分身・敵の攻撃状態がすべて初期値');
}

// ---------------------------------------------------------------- ボット
// 反応の遅れ（予告が見えてから動き出すまで）
const REACT = 0.35;
const REACT_JITTER = 0.5; // 0.35〜0.85秒（アクションが得意でない人くらい）
function bot(s, mode, mem) {
  const e = s.enemy, me = s.clones[s.active], K = s.C.katana, E = s.C.enemy, cr = s.C.clone.radius;
  const inp = { move: { x: 0, y: 0 }, aim: { x: e.x, y: e.y } };
  const d = Sim.dist(me, e);
  const toE = { x: (e.x - me.x) / (d || 1), y: (e.y - me.y) / (d || 1) };
  const go = (x, y) => { const m = Math.hypot(x, y) || 1; inp.move = { x: x / m, y: y / m }; };
  // 壁際に追い詰められないよう、中央へ少し寄る
  const A0 = s.C.arena, cx = (A0.x0 + A0.x1) / 2, cy = (A0.y0 + A0.y1) / 2;
  const wallK = Math.max(0, 1 - Math.min(me.x - A0.x0, A0.x1 - me.x, me.y - A0.y0, A0.y1 - me.y) / 120);
  const toC = { x: (cx - me.x) / (Math.hypot(cx - me.x, cy - me.y) || 1), y: (cy - me.y) / (Math.hypot(cx - me.x, cy - me.y) || 1) };
  // 反応の遅れは攻撃ごとにばらつく（人間らしさ）
  if (e.state !== mem.lastState) { mem.lastState = e.state; if (e.state.endsWith('Wind')) mem.react = REACT + mem.rand() * REACT_JITTER; }
  const seen = e.state === 'dashWind' || e.state === 'sweepWind' ? e.t >= mem.react : e.state === 'dash' || e.state === 'sweep';

  if (mode === 'tank') { go(toE.x, toE.y); inp.attack = d < K.range + e.r; return inp; }
  // 切り替え型：狙われた待機中の分身に乗り移って避ける
  if (mode === 'switch' && (e.state === 'dashWind' || e.state === 'sweepWind') && e.target !== s.active && s.clones[e.target].alive && e.t >= mem.react * 0.5) {
    inp.select = e.target; return inp;
  }

  // 予告への対応
  if (seen && (e.state === 'dashWind' || e.state === 'dash')) {
    const a = e.atk, ax = e.state === 'dash' ? a.x0 : e.x, ay = e.state === 'dash' ? a.y0 : e.y;
    const bx = ax + Math.cos(a.dir) * a.len, by = ay + Math.sin(a.dir) * a.len;
    const sd = Sim.segDist(me.x, me.y, ax, ay, bx, by);
    if (sd < E.dash.halfWidth + cr + 18) {
      const nx = -Math.sin(a.dir), ny = Math.cos(a.dir);
      const side = (me.x - ax) * nx + (me.y - ay) * ny;
      let sgn = side >= 0 ? 1 : -1;
      if (mode === 'switch') {
        // 待機中の仲間から離れる側へ避ける（突進の帯に仲間を巻き込まない）
        let push = 0;
        for (const c of s.clones) if (c.alive && c.id !== s.active) push += ((c.x - me.x) * nx + (c.y - me.y) * ny) / (Sim.dist(c, me) || 1);
        if (Math.abs(push) > 0.05) sgn = push > 0 ? -1 : 1;
      }
      const A = s.C.arena;
      const tx = me.x + nx * sgn * 50, ty = me.y + ny * sgn * 50;
      if (tx < A.x0 + 20 || tx > A.x1 - 20 || ty < A.y0 + 20 || ty > A.y1 - 20) sgn = -sgn;
      go(nx * sgn, ny * sgn);
      return inp;
    }
  }
  if (seen && (e.state === 'sweepWind' || e.state === 'sweep') && d < E.sweep.radius + cr + 25) { go(-toE.x + toC.x * wallK * 1.5, -toE.y + toC.y * wallK * 1.5); return inp; }

  if (e.open) {
    // 隙：別の分身のほうが近ければ切り替えて斬る
    if (mode === 'switch') {
      let best = s.active, bd = d;
      for (const c of s.clones) if (c.alive && Sim.dist(c, e) < bd - 40) { best = c.id; bd = Sim.dist(c, e); }
      if (best !== s.active) { inp.select = best; return inp; }
    }
    const left = e.recoverDur - e.t;
    if (d > K.range + e.r - 6) {
      const reach = (d - (K.range + e.r - 6)) / s.C.clone.speed;
      if (me.shuriken > 0 && reach > left - 0.15) { inp.throw = true; return inp; }
      go(toE.x, toE.y);
    } else {
      inp.attack = true;
    }
    return inp;
  }
  // 平常時
  if (mode === 'switch' && mem.lure) {
    // 囮：待機中の分身Bの手前に立ち、突進の終点がBの横になるように誘う
    const others = s.clones.filter((c) => c.alive && c.id !== s.active);
    if (others.length) {
      const B = others.reduce((p, c) => (Sim.dist(c, e) < Sim.dist(p, e) ? c : p));
      const db = Sim.dist(B, e) || 1;
      const ux = (e.x - B.x) / db, uy = (e.y - B.y) / db;
      const tx = B.x + ux * 115 - uy * 62, ty = B.y + uy * 115 + ux * 62;
      if (Math.hypot(tx - me.x, ty - me.y) > 8) go(tx - me.x, ty - me.y);
      return inp;
    }
  }
  const want = 190;
  let tang = { x: -toE.y, y: toE.x };
  if (tang.x * toC.x + tang.y * toC.y < 0) tang = { x: -tang.x, y: -tang.y };
  const radial = d < want - 20 ? -1 : d > want + 40 ? 1 : 0;
  go(toE.x * radial + tang.x * 0.4 + toC.x * wallK * 1.2, toE.y * radial + tang.y * 0.4 + toC.y * wallK * 1.2);
  return inp;
}

function play(mode, seed, opts) {
  const s = Sim.create(C(), seed);
  if (opts && opts.solo) { s.clones[1].alive = false; s.clones[2].alive = false; s.clones[1].shuriken = s.clones[2].shuriken = 0; }
  let rs = seed * 7919 + 13;
  const mem = { lure: false, react: REACT, lastState: '', rand: () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; } };
  let i = 0;
  while (s.phase === 'play' && i < 200 / DT) { Sim.step(s, DT, bot(s, mode, mem)); i++; s.events.length = 0; }
  return s;
}

const games = +(process.argv[process.argv.indexOf('--games') + 1] || 200) || 200;
console.log(`\n■ ボット対戦（各${games}戦、反応遅れ${REACT}〜${(REACT + REACT_JITTER).toFixed(2)}s）`);
function summary(label, mode, opts) {
  let win = 0, body = 0, wipe = 0, tWin = 0, openHits = 0, sw = 0, alive = 0;
  for (let k = 0; k < games; k++) {
    const s = play(mode, 1000 + k, opts);
    if (s.result === 'win') { win++; tWin += s.body.max - s.body.life; alive += s.clones.filter((c) => c.alive).length; }
    else if (s.result === 'body') body++; else wipe++;
    openHits += s.stats.openHits; sw += s.stats.switches;
  }
  const r = { win: win / games, body: body / games, wipe: wipe / games, alive: alive / games };
  console.log(`  ${label.padEnd(26, '　')} 勝率 ${(r.win * 100).toFixed(0).padStart(3)}%  時間切れ ${(r.body * 100).toFixed(0).padStart(3)}%  全滅 ${(r.wipe * 100).toFixed(0).padStart(3)}%` +
    `  勝利時の所要 ${win ? (tWin / win).toFixed(1) : '-'}s 残存 ${win ? (alive / win).toFixed(2) : '-'}  隙の一撃/戦 ${(openHits / games).toFixed(1)}  切替/戦 ${(sw / games).toFixed(1)}`);
  return r;
}
const tank = summary('正面から斬り続ける', 'tank');
const solo3 = summary('避けて隙に斬る（切替なし）', 'dodge');
const sw = summary('囮＋切り替えで反撃', 'switch');
const solo1 = summary('最後の一体だけ', 'dodge', { solo: true });
ok(tank.win < 0.1, '正面から斬り続けるだけではほぼ勝てない');
ok(solo1.win > 0.05, `最後の一体でも勝てる（勝率 ${(solo1.win * 100).toFixed(0)}%）`);
console.log('  （参考）ボットは避けが正確すぎるため、勝率の差は難易度の目安にならない。切替の効果は下の再現テストで確認する');

// 囮と切り替えの再現：分身1が突進を引きつけて横に避ける。
// A) 分身1のまま反撃  B) 突進の終点そばに置いた分身2へ切り替えて反撃 ── 隙の間に与えたダメージを比べる
console.log('\n■ 囮＋切り替えの再現');
function decoy(useSwitch) {
  const s = Sim.create(C(), 77);
  s.enemy.x = 700; s.enemy.y = 300; s.enemy.think = 0;
  s.clones[0].x = 420; s.clones[0].y = 300;   // 囮（狙われる）
  s.clones[1].x = 250; s.clones[1].y = 362;   // 待ち伏せ（突進の帯の外、終点の横）
  s.clones[2].x = 120; s.clones[2].y = 120;
  let hp0 = null, phase = 'wait';
  for (let i = 0; i < 5 / DT && s.phase === 'play'; i++) {
    const e = s.enemy, me = s.clones[s.active];
    const inp = { aim: { x: e.x, y: e.y }, move: { x: 0, y: 0 } };
    if (phase === 'wait' && e.state === 'dashWind' && e.atk.locked) phase = 'dodge';
    if (phase === 'dodge') inp.move = { x: 0, y: -1 };
    if (e.state === 'recover' && phase !== 'counter') { phase = 'counter'; hp0 = e.hp; if (useSwitch) inp.select = 1; }
    if (phase === 'counter') {
      if (e.state !== 'recover') break;
      const d = Sim.dist(me, e);
      if (d > s.C.katana.range + e.r - 6) { const m = d || 1; inp.move = { x: (e.x - me.x) / m, y: (e.y - me.y) / m }; }
      inp.attack = true;
    }
    Sim.step(s, DT, inp); s.events.length = 0;
  }
  return { dmg: hp0 == null ? 0 : hp0 - s.enemy.hp, alive: s.clones.filter((c) => c.alive).length };
}
const A = decoy(false), B = decoy(true);
console.log(`  囮がそのまま反撃: ${A.dmg} ダメージ（生存 ${A.alive}）／ 待ち伏せへ切り替え: ${B.dmg} ダメージ（生存 ${B.alive}）`);
ok(A.alive === 3 && B.alive === 3, '囮は横に避けて生き残り、待ち伏せの分身も帯の外で無事');
ok(B.dmg > A.dmg, '待ち伏せへ切り替えたほうが、隙に多く斬れる');

console.log(fails ? `\n${fails} 件失敗` : '\nすべて通過');
process.exit(fails ? 1 : 0);

// 描画・入力・演出・音。中身の判定は logic.js（NinjaSim）。
(() => {
  'use strict';
  const C = window.CONFIG, Sim = window.NinjaSim;
  const W = 960, H = 640;
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * DPR; cv.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  const SERIF = '"Yu Mincho","YuMincho","Hiragino Mincho ProN","Noto Serif JP","MS PMincho",serif';
  const SANS = '"Yu Gothic UI","Yu Gothic","Meiryo","Hiragino Sans","Noto Sans JP",sans-serif';
  const KANJI = ['一', '二', '三'];
  const params = new URLSearchParams(location.search);
  const fixedSeed = params.has('seed') ? +params.get('seed') : null;

  const G = {
    mode: 'title', // title | intro | play | end
    sim: null, tries: 0, paused: false, pauseReason: '',
    introT: 0, introLen: 0, endT: 0, endFrom: null,
    clock: 0, fx: [], shake: 0, banner: null, bodySay: null, saidAt: {},
    muted: false, beatT: 0, panelShown: false,
  };

  // ---------------------------------------------------------------- 音
  const AU = { ctx: null, master: null, noiseBuf: null };
  function audioInit() {
    if (AU.ctx) { if (AU.ctx.state === 'suspended') AU.ctx.resume(); return; }
    try {
      AU.ctx = new (window.AudioContext || window.webkitAudioContext)();
      AU.master = AU.ctx.createGain(); AU.master.gain.value = 0.45;
      AU.master.connect(AU.ctx.destination);
      const len = AU.ctx.sampleRate;
      AU.noiseBuf = AU.ctx.createBuffer(1, len, AU.ctx.sampleRate);
      const d = AU.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { AU.ctx = null; }
  }
  function tone(f, dur, type, vol, slideTo, delay) {
    if (!AU.ctx || G.muted) return;
    const t0 = AU.ctx.currentTime + (delay || 0);
    const o = AU.ctx.createOscillator(), g = AU.ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(AU.master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, freq, ftype, freqTo, delay) {
    if (!AU.ctx || G.muted) return;
    const t0 = AU.ctx.currentTime + (delay || 0);
    const src = AU.ctx.createBufferSource(); src.buffer = AU.noiseBuf;
    const f = AU.ctx.createBiquadFilter(); f.type = ftype || 'bandpass';
    f.frequency.setValueAtTime(freq || 2000, t0);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t0 + dur);
    f.Q.value = 0.9;
    const g = AU.ctx.createGain();
    g.gain.setValueAtTime(vol || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(AU.master);
    src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.02);
  }
  const sfx = {
    swing: () => noise(0.09, 0.22, 2600, 'bandpass', 5000),
    hit: (crit) => { tone(crit ? 240 : 170, 0.14, 'square', 0.12, crit ? 120 : 90); noise(0.07, 0.25, 1400); if (crit) tone(1300, 0.18, 'triangle', 0.08); },
    poof: () => { noise(0.45, 0.3, 900, 'lowpass', 180); tone(300, 0.25, 'sine', 0.08, 120); },
    warn: () => { tone(300, 0.09, 'triangle', 0.13); tone(300, 0.09, 'triangle', 0.13, null, 0.12); },
    lock: () => tone(620, 0.08, 'square', 0.08),
    dash: () => noise(0.3, 0.32, 1200, 'bandpass', 300),
    sweep: () => noise(0.25, 0.3, 3000, 'bandpass', 600),
    throw: () => noise(0.06, 0.16, 6000, 'highpass'),
    empty: () => tone(110, 0.06, 'square', 0.07),
    sw: () => tone(900, 0.05, 'sine', 0.07),
    beat: () => { tone(58, 0.13, 'sine', 0.45); tone(52, 0.13, 'sine', 0.35, null, 0.17); },
    gong: () => { tone(196, 1.6, 'sine', 0.22); tone(392, 1.2, 'sine', 0.08); },
    win: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.5, 'triangle', 0.1, null, i * 0.12)); },
    lose: () => { tone(196, 0.9, 'sine', 0.18, 98); },
  };

  // ---------------------------------------------------------------- 入力
  const keys = new Set();
  const inp = { mouse: { x: W / 2, y: H / 2 }, lmb: false, lmbPressed: false, rmbPressed: false, switchNext: false, select: null };
  const BLOCK = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown', 'Home', 'End'];

  window.addEventListener('keydown', (e) => {
    if (BLOCK.includes(e.code)) e.preventDefault();
    audioInit();
    if (e.repeat && (e.code === 'Space' || e.code === 'Escape' || e.code === 'KeyR')) return;
    keys.add(e.code);
    if (e.code === 'KeyM') { G.muted = !G.muted; return; }
    if (G.mode === 'title') {
      if (e.code === 'Space' || e.code === 'Enter') startNew();
      return;
    }
    if (G.mode === 'intro') {
      if (e.code === 'Escape') return;
      if (e.code === 'Space' || e.code === 'Enter') skipIntro();
      return;
    }
    if (G.mode === 'play') {
      if (e.code === 'Escape') { setPause(!G.paused, 'menu'); return; }
      if (G.paused) { if (e.code === 'KeyR') startNew(); return; }
      if (e.code === 'Space') inp.switchNext = true;
      const m = /^(Digit|Numpad)([1-3])$/.exec(e.code);
      if (m) inp.select = +m[2] - 1;
      return;
    }
    if (G.mode === 'end' && e.code === 'KeyR') startNew();
  }, { passive: false });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  function toWorld(ev) {
    const r = cv.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * W / r.width, y: (ev.clientY - r.top) * H / r.height };
  }
  window.addEventListener('mousemove', (e) => { inp.mouse = toWorld(e); });
  cv.addEventListener('mousedown', (e) => {
    e.preventDefault(); cv.focus(); audioInit();
    inp.mouse = toWorld(e);
    if (G.mode === 'title') { startNew(); return; }
    if (G.mode === 'intro') { skipIntro(); return; }
    if (G.mode === 'end') { if (G.panelShown && G.endT > G.panelAt + 0.6) startNew(); return; }
    if (G.paused) { setPause(false); return; }
    if (e.button === 0) { inp.lmb = true; inp.lmbPressed = true; }
    if (e.button === 2) inp.rmbPressed = true;
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) inp.lmb = false; });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  window.addEventListener('blur', () => { keys.clear(); inp.lmb = false; if (G.mode === 'play') setPause(true, 'blur'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && G.mode === 'play') setPause(true, 'blur'); });

  function setPause(p, why) {
    G.paused = p; G.pauseReason = why || '';
    keys.clear(); inp.lmb = false;
  }

  function readInput() {
    let x = 0, y = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
    const out = {
      move: { x, y }, aim: inp.mouse,
      attack: inp.lmbPressed || inp.lmb, throw: inp.rmbPressed,
      switchNext: inp.switchNext, select: inp.select,
    };
    inp.lmbPressed = false; inp.rmbPressed = false; inp.switchNext = false; inp.select = null;
    return out;
  }

  // ---------------------------------------------------------------- 進行
  function startNew() {
    audioInit();
    G.tries++;
    G.sim = Sim.create(C, fixedSeed != null ? fixedSeed + G.tries - 1 : undefined);
    G.mode = 'intro'; G.paused = false; G.introT = 0;
    G.introLen = G.tries === 1 ? 7.2 : 1.7;
    G.fx = []; G.banner = null; G.bodySay = null; G.saidAt = {}; G.shake = 0;
    G.endT = 0; G.panelShown = false; G.beatT = 0;
    keys.clear(); inp.lmb = false; inp.lmbPressed = inp.rmbPressed = inp.switchNext = false; inp.select = null;
  }
  function skipIntro() {
    if (G.mode !== 'intro') return;
    if (G.introT < G.introLen - 0.5) G.introT = G.introLen - 0.5;
  }
  function beginPlay() {
    G.mode = 'play';
    sfx.gong();
    pushText(W / 2, H / 2 - 10, '始め', { size: 64, color: '#fff3d6', font: SERIF, dur: 0.9, rise: 0, stroke: '#000' });
  }

  function enterEnd() {
    const s = G.sim;
    G.mode = 'end'; G.endT = 0; G.panelShown = false;
    G.endFrom = s.clones.map((c) => ({ x: c.x, y: c.y }));
    G.panelAt = s.result === 'win' ? 4.6 : 2.4;
    s.clones.forEach((c) => { c.swing = null; });
    if (s.result === 'win') sfx.win(); else sfx.lose();
    // 帰還する分身の並び位置
    const b = s.body;
    const spots = [{ x: b.x + 10, y: b.y - 46 }, { x: b.x + 58, y: b.y - 22 }, { x: b.x - 40, y: b.y - 40 }];
    G.endTo = s.clones.map((c, i) => spots[i]);
    G.merged = s.clones.map(() => false);
  }

  function update(dt) {
    G.clock += dt;
    if (G.mode === 'intro') {
      G.introT += dt;
      introEvents();
      if (G.introT >= G.introLen) beginPlay();
    } else if (G.mode === 'play' && !G.paused) {
      const s = G.sim;
      const input = readInput();
      const n = Math.max(1, Math.ceil(dt / (1 / 120)));
      for (let i = 0; i < n && s.phase === 'play'; i++) {
        Sim.step(s, dt / n, i === 0 ? input : { move: input.move, aim: input.aim, attack: input.attack && inp.lmb });
      }
      handleEvents();
      bodyLines();
      heartbeat(dt);
      if (s.phase !== 'play') enterEnd();
    } else if (G.mode === 'end') {
      G.endT += dt;
      handleEvents();
      endUpdate(dt);
    }
    if (!(G.mode === 'play' && G.paused)) {
      for (const f of G.fx) f.t += dt;
      G.fx = G.fx.filter((f) => f.t < f.dur);
      G.shake = Math.max(0, G.shake - dt);
      if (G.banner) { G.banner.t += dt; if (G.banner.t > G.banner.dur) G.banner = null; }
      if (G.bodySay) { G.bodySay.t += dt; if (G.bodySay.t > G.bodySay.dur) G.bodySay = null; }
    }
  }

  // 冒頭の段取り
  function introEvents() {
    const t = G.introT, first = G.tries === 1, s = G.sim;
    const once = (k, fn) => { if (!G.saidAt['i_' + k]) { G.saidAt['i_' + k] = 1; fn(); } };
    const poofAt = first ? [1.0, 1.15, 1.3] : [0.05, 0.12, 0.19];
    s.clones.forEach((c, i) => { if (t >= poofAt[i]) once('p' + i, () => { addSmoke(c.x, c.y, 0.6); sfx.poof(); }); });
    if (first) {
      if (t >= 0.2) once('g', () => say('ぐ……ふっ', 1.6));
      if (t >= 5.7) once('e', () => noise(0.3, 0.25, 900, 'bandpass', 300));
      if (t >= 5.6) once('b', () => say('ひゅー……ひゅー……', 1.6));
    }
  }
  function introClonesVisible(i) {
    if (G.mode !== 'intro') return true;
    const at = G.tries === 1 ? [1.0, 1.15, 1.3] : [0.05, 0.12, 0.19];
    return G.introT >= at[i] + 0.08;
  }
  function introEnemyPos() {
    const s = G.sim, L = C.layout;
    if (G.mode !== 'intro' || G.tries > 1) return null;
    const near = { x: L.body.x + 105, y: L.body.y + 42 };
    // 「……で？」のあと、大きく跳び退いて間合いを取る
    const k = Math.max(0, Math.min(1, (G.introT - 5.7) / 0.7));
    const e = k * (2 - k);
    return { x: near.x + (s.enemy.x - near.x) * e, y: near.y + (s.enemy.y - near.y) * e, jump: Math.sin(Math.PI * k),
      face: k <= 0 ? Math.atan2(L.body.y - near.y, L.body.x - near.x) : Math.atan2(L.clones[0].y - near.y, L.clones[0].x - near.x) };
  }

  function handleEvents() {
    const s = G.sim;
    for (const ev of s.events) {
      switch (ev.type) {
        case 'swing': sfx.swing(); break;
        case 'hit':
          sfx.hit(ev.crit);
          G.fx.push({ kind: 'spark', x: ev.x, y: ev.y, t: 0, dur: 0.25, crit: ev.crit });
          pushText(ev.x + 30, ev.y - 30, (ev.crit ? '隙あり ' : '') + ev.dmg, { size: ev.crit ? 22 : 16, color: ev.crit ? '#ffd23f' : '#fff', dur: 0.7 });
          break;
        case 'poof':
          addSmoke(ev.x, ev.y, 0.75); sfx.poof();
          if (ev.cause !== 'body') {
            G.shake = 0.14;
            pushText(ev.x, ev.y - 30, 'ドロン', { size: 16, color: '#555', dur: 0.9 });
            if (s.phase === 'play') say(['ああ……', 'おい……一人減ったぞ……', 'うっ……', '分身が……'][(ev.id + s.clones.filter((c) => c.alive).length) % 4], 1.4);
          }
          break;
        case 'autoSwitch':
          G.banner = { text: `分身${KANJI[ev.id]}に引き継ぐ`, t: 0, dur: 1.3 };
          sfx.sw();
          break;
        case 'switch': sfx.sw(); break;
        case 'selectDead': {
          pushText(150 + ev.id * 200, 560, `分身${KANJI[ev.id]}はもう煙だ`, { size: 15, color: '#ffb0a0', dur: 1.0 });
          sfx.empty();
          break;
        }
        case 'throw': sfx.throw(); break;
        case 'empty': {
          const c = s.clones[ev.id];
          pushText(c.x, c.y - 40, '手裏剣切れ', { size: 14, color: '#ffb0a0', dur: 0.8 });
          sfx.empty();
          break;
        }
        case 'shotMiss': G.fx.push({ kind: 'tink', x: ev.x, y: ev.y, t: 0, dur: 0.2 }); break;
        case 'windup': sfx.warn(); break;
        case 'lock': sfx.lock(); break;
        case 'dash': sfx.dash(); break;
        case 'sweep': sfx.sweep(); G.fx.push({ kind: 'sweepArc', x: s.enemy.x, y: s.enemy.y, t: 0, dur: 0.22, face: s.enemy.face }); break;
      }
    }
    s.events.length = 0;
  }

  function bodyLines() {
    const s = G.sim, life = s.body.life;
    const lines = [[78, '……ぅ'], [60, 'ま、まだか……'], [42, '早く……してくれ……'], [25, 'か、川が……見えてきた……'], [12, 'ばあちゃん……？'], [4, '……']];
    for (const [th, txt] of lines) {
      if (life <= th && !G.saidAt[th]) { G.saidAt[th] = 1; say(txt, 2.2); }
    }
  }
  function say(text, dur) { G.bodySay = { text, t: 0, dur }; }

  function heartbeat(dt) {
    const life = G.sim.body.life;
    if (life > 25) return;
    G.beatT -= dt;
    if (G.beatT <= 0) { sfx.beat(); G.beatT = 0.5 + (life / 25) * 0.5; }
  }

  function endUpdate() {
    const s = G.sim, t = G.endT;
    if (s.result === 'win') {
      // 生き残った分身が本体のもとへ戻り、煙になって還る
      s.clones.forEach((c, i) => {
        if (!c.alive || G.merged[i]) return;
        const k = Math.max(0, Math.min(1, (t - 0.9) / 1.3));
        const e = k * k * (3 - 2 * k);
        const a = G.endFrom[i], b = G.endTo[i];
        c.x = a.x + (b.x - a.x) * e; c.y = a.y + (b.y - a.y) * e;
        c.aim = Math.atan2(s.body.y - c.y, s.body.x - c.x);
        if (t >= 2.45 + i * 0.18) {
          G.merged[i] = true; addSmoke(c.x, c.y, 0.55); sfx.poof();
          pushText(c.x, c.y - 26, 'ドロン', { size: 15, color: '#666', dur: 0.8 });
        }
      });
      if (t >= 0.25 && !G.saidAt.e1) { G.saidAt.e1 = 1; pushText(s.enemy.x, s.enemy.y - 46, '無念……', { size: 20, color: '#fff', dur: 1.6, font: SERIF, stroke: '#000' }); }
      if (t >= 3.15 && !G.saidAt.e2) { G.saidAt.e2 = 1; say('た……助かった……', 2.4); }
    } else if (s.result === 'body') {
      if (t >= 0.9 && !G.saidAt.e1) { G.saidAt.e1 = 1; pushText(W / 2, 250, '本体、息絶える', { size: 40, color: '#ffdddd', dur: 1.6, font: SERIF, stroke: '#000', rise: 0 }); }
    } else {
      if (t >= 0.8 && !G.saidAt.e1) { G.saidAt.e1 = 1; say('……え？', 2.5); }
    }
    if (t >= G.panelAt) G.panelShown = true;
  }

  // ---------------------------------------------------------------- 演出部品
  function addSmoke(x, y, dur) {
    const parts = [];
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, sp = 20 + Math.random() * 60;
      parts.push({ a, sp, r: 8 + Math.random() * 10, ox: Math.cos(a) * 4, oy: Math.sin(a) * 4 });
    }
    G.fx.push({ kind: 'smoke', x, y, t: 0, dur: dur || 0.7, parts });
  }
  function pushText(x, y, text, o) {
    G.fx.push(Object.assign({ kind: 'text', x, y, text, t: 0, dur: 1, size: 16, color: '#fff', rise: 26, font: SANS }, o || {}));
  }

  // ---------------------------------------------------------------- 背景（白砂の庭）
  const floor = document.createElement('canvas');
  (function buildFloor() {
    floor.width = W * DPR; floor.height = H * DPR;
    const g = floor.getContext('2d');
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    const A = C.arena;
    g.fillStyle = '#1c1a22'; g.fillRect(0, 0, W, H);
    // 外周の板塀
    g.fillStyle = '#3b2a1e'; g.fillRect(A.x0 - 22, A.y0 - 22, A.x1 - A.x0 + 44, A.y1 - A.y0 + 44);
    g.strokeStyle = '#2a1d14'; g.lineWidth = 1;
    for (let x = A.x0 - 22; x < A.x1 + 22; x += 18) { g.beginPath(); g.moveTo(x, A.y0 - 22); g.lineTo(x, A.y0); g.moveTo(x, A.y1); g.lineTo(x, A.y1 + 22); g.stroke(); }
    for (let y = A.y0 - 22; y < A.y1 + 22; y += 18) { g.beginPath(); g.moveTo(A.x0 - 22, y); g.lineTo(A.x0, y); g.moveTo(A.x1, y); g.lineTo(A.x1 + 22, y); g.stroke(); }
    // 白砂
    g.fillStyle = '#e7e0cd'; g.fillRect(A.x0, A.y0, A.x1 - A.x0, A.y1 - A.y0);
    g.save(); g.beginPath(); g.rect(A.x0, A.y0, A.x1 - A.x0, A.y1 - A.y0); g.clip();
    g.strokeStyle = 'rgba(160,145,110,0.22)'; g.lineWidth = 1.4;
    for (let y = A.y0 + 10; y < A.y1; y += 12) {
      g.beginPath();
      for (let x = A.x0; x <= A.x1; x += 8) {
        const yy = y + Math.sin(x / 70 + y / 40) * 2.2;
        if (x === A.x0) g.moveTo(x, yy); else g.lineTo(x, yy);
      }
      g.stroke();
    }
    // 砂の粒
    let seed = 7;
    const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 900; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(120,105,80,0.12)' : 'rgba(255,255,255,0.35)';
      g.fillRect(A.x0 + r() * (A.x1 - A.x0), A.y0 + r() * (A.y1 - A.y0), 1.5, 1.5);
    }
    g.restore();
    g.strokeStyle = '#1a120c'; g.lineWidth = 3; g.strokeRect(A.x0, A.y0, A.x1 - A.x0, A.y1 - A.y0);
    // 四隅の灯籠
    const lant = (x, y) => {
      g.fillStyle = '#6f6a62'; g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4c4842'; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,200,110,0.9)'; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
    };
    lant(A.x0 - 11, A.y0 - 11); lant(A.x1 + 11, A.y0 - 11); lant(A.x0 - 11, A.y1 + 11); lant(A.x1 + 11, A.y1 + 11);
  })();

  // ---------------------------------------------------------------- 描画
  function render() {
    const s = G.sim;
    ctx.save();
    if (G.shake > 0) ctx.translate((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
    ctx.drawImage(floor, 0, 0, W, H);
    // 時間切れ間近は庭の縁がほんのり赤く（点滅はしない）
    if (s && G.mode === 'play' && s.body.life < 20) {
      const a = (1 - s.body.life / 20) * 0.22;
      const A = C.arena;
      const grd = ctx.createRadialGradient(W / 2, (A.y0 + A.y1) / 2, 200, W / 2, (A.y0 + A.y1) / 2, 560);
      grd.addColorStop(0, 'rgba(160,0,0,0)'); grd.addColorStop(1, `rgba(160,0,0,${a})`);
      ctx.fillStyle = grd; ctx.fillRect(A.x0, A.y0, A.x1 - A.x0, A.y1 - A.y0);
    }
    if (G.mode === 'title') {
      drawTitleScene();
    } else if (s) {
      drawBody(s);
      if (G.mode === 'play') drawTelegraph(s);
      for (const p of s.shots) drawShuriken(p.x, p.y, p.spin, 7);
      s.clones.forEach((c) => drawClone(s, c));
      drawEnemy(s);
      drawTargetMark(s);
    }
    drawFx();
    ctx.restore();

    if (G.mode === 'title') { drawTitleUI(); return; }
    drawHUD(s);
    if (G.mode === 'intro') drawIntroUI();
    if (G.banner) drawBanner();
    if (G.mode === 'play' && G.paused) drawPause();
    if (G.mode === 'end' && G.panelShown) drawResult();
  }

  // 倒れた本体：赤い襟巻き、横たわる。呼吸と小さな痙攣で生きていると分かる
  function drawBody(s) {
    const b = s.body, t = G.clock;
    const ratio = b.life / b.max;
    const dead = s.result === 'body' && G.mode === 'end';
    const saved = s.result === 'win' && G.mode === 'end' && G.endT > 2.8;
    const rate = 2.2 + (1 - ratio) * 3.5;
    const breath = dead ? 0 : Math.sin(t * rate) * (0.06 + (1 - ratio) * 0.05);
    const twitch = !dead && !saved && (Math.sin(t * 0.9 + 1.3) > 0.985) ? Math.sin(t * 60) * 2 : 0;
    ctx.save();
    ctx.translate(b.x, b.y);
    if (saved) {
      const k = Math.min(1, (G.endT - 2.8) / 0.6);
      ctx.fillStyle = `rgba(255,236,170,${0.35 * k})`;
      ctx.beginPath(); ctx.arc(0, 0, 60, 0, Math.PI * 2); ctx.fill();
    }
    // 影
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(4, 6, 58, 18, 0, 0, Math.PI * 2); ctx.fill();
    const cloth = dead ? '#55545a' : '#3a3946';
    // 脚
    ctx.fillStyle = cloth;
    ctx.beginPath(); ctx.ellipse(34, 6, 22, 7, 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(36, -6, 22, 7, -0.05, 0, Math.PI * 2); ctx.fill();
    // 腕（片腕を投げ出し、ときどき震える）
    ctx.beginPath(); ctx.ellipse(-8, 18 + twitch, 16, 5, 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d9b59a';
    ctx.beginPath(); ctx.arc(-18 + twitch * 0.5, 28 + twitch, 4.5, 0, Math.PI * 2); ctx.fill();
    // 胴（呼吸で膨らむ）
    ctx.fillStyle = cloth;
    ctx.beginPath(); ctx.ellipse(0, 0, 25, 14 * (1 + breath), 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1b1a22'; ctx.lineWidth = 2; ctx.stroke();
    // 赤い襟巻き（本体の印）
    ctx.fillStyle = '#c4302b';
    ctx.beginPath(); ctx.ellipse(-22, 0, 7, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-22, 6); ctx.quadraticCurveTo(-30, 26, -14, 34 + Math.sin(t * 2) * 2); ctx.lineTo(-10, 30); ctx.quadraticCurveTo(-22, 22, -16, 6); ctx.fill();
    // 頭
    ctx.fillStyle = '#2c2b33';
    ctx.beginPath(); ctx.arc(-36, -2, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d9b59a';
    ctx.beginPath(); ctx.ellipse(-40, -2, 5, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2a1a14'; ctx.lineWidth = 1.4;
    if (dead) {
      ctx.beginPath(); ctx.moveTo(-43, -6); ctx.lineTo(-39, -2); ctx.moveTo(-39, -6); ctx.lineTo(-43, -2); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(-43, -4); ctx.lineTo(-39, -3); ctx.stroke();
    }
    ctx.restore();

    // 「本体」札と小さな命ゲージ
    if (G.mode !== 'end' || s.result !== 'win' || G.endT < 2.8) {
      const x = b.x - 10, y = b.y - 52;
      ctx.fillStyle = dead ? '#666' : '#a8231f';
      roundRect(x - 24, y - 12, 48, 22, 4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `bold 14px ${SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('本体', x, y);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - 24, y + 13, 48, 5);
      ctx.fillStyle = lifeColor(ratio); ctx.fillRect(x - 24, y + 13, 48 * ratio, 5);
    }
    // 吐息
    if (!dead && G.mode !== 'title') {
      const ph = (t * (0.35 + (1 - ratio) * 0.4)) % 1;
      ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.55;
      ctx.fillStyle = '#7a7480'; ctx.font = `13px ${SANS}`; ctx.textAlign = 'center';
      ctx.fillText(ratio < 0.3 ? 'ひゅ…' : 'ぜぇ…', b.x - 62, b.y - 8 - ph * 22);
      ctx.globalAlpha = 1;
    }
    // 本体のつぶやき
    if (G.bodySay) {
      const k = G.bodySay.t, a = Math.min(1, k * 6, (G.bodySay.dur - k) * 4);
      speech(b.x - 10, b.y - 78, G.bodySay.text, a, 15, '#fff8f0', '#3a2a24');
    }
  }

  function lifeColor(r) {
    if (r > 0.5) return '#5fbf5f';
    if (r > 0.25) return '#e8b23a';
    return '#e0453a';
  }

  function drawClone(s, c) {
    const i = c.id;
    if (G.mode === 'intro' && !introClonesVisible(i)) return;
    if (!c.alive) return;
    if (G.mode === 'end' && s.result === 'win' && G.merged[i]) return;
    const active = s.active === i && G.mode === 'play';
    const t = G.clock, r = C.clone.radius;
    ctx.save();
    ctx.translate(c.x, c.y);
    // 足元の印（操作中）
    if (active) {
      ctx.fillStyle = 'rgba(255,205,60,0.22)';
      ctx.beginPath(); ctx.arc(0, 0, r + 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#f2b51d'; ctx.lineWidth = 2.5;
      ctx.setLineDash([7, 5]); ctx.lineDashOffset = -t * 20;
      ctx.beginPath(); ctx.arc(0, 0, r + 9, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    // 残像（分身らしさ）
    const back = c.aim + Math.PI;
    ctx.fillStyle = 'rgba(90,150,255,0.18)';
    ctx.beginPath(); ctx.arc(Math.cos(back) * 5 + Math.sin(t * 3 + i) * 1.5, Math.sin(back) * 5, r, 0, Math.PI * 2); ctx.fill();
    // 青い襟巻きのたなびき
    ctx.strokeStyle = '#3d8fe0'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(Math.cos(back) * 8, Math.sin(back) * 8);
    const wob = Math.sin(t * 9 + i) * 4;
    ctx.quadraticCurveTo(Math.cos(back) * 18 - Math.sin(back) * wob, Math.sin(back) * 18 + Math.cos(back) * wob, Math.cos(back) * 25, Math.sin(back) * 25);
    ctx.stroke();
    // 刀
    const sw = c.swing, K = C.katana;
    let bladeA = c.aim + 1.0;
    if (sw) {
      const k = Math.min(1, sw.t / (K.windup + K.active));
      bladeA = sw.dir - 1.05 + 2.1 * k;
    }
    ctx.strokeStyle = '#cfd6de'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(Math.cos(bladeA) * 8, Math.sin(bladeA) * 8); ctx.lineTo(Math.cos(bladeA) * 30, Math.sin(bladeA) * 30); ctx.stroke();
    ctx.lineCap = 'butt';
    // 体
    ctx.fillStyle = '#25305a';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = active ? '#ffd65a' : '#9cc4ff'; ctx.lineWidth = active ? 3 : 2;
    ctx.stroke();
    // 頭（向きを示す額当て）
    ctx.fillStyle = '#141a33';
    ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b9c3cf';
    ctx.beginPath(); ctx.arc(Math.cos(c.aim) * 6, Math.sin(c.aim) * 6, 3.4, 0, Math.PI * 2); ctx.fill();
    // 振りの軌跡（当たり判定と同じ扇）
    if (sw && sw.t >= K.windup * 0.5 && sw.t <= K.windup + K.active + 0.07) {
      const half = K.arcDeg / 2 * Math.PI / 180;
      ctx.fillStyle = sw.hit ? 'rgba(255,240,180,0.55)' : 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, K.range, sw.dir - half, sw.dir + half); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // 番号札
    const by = c.y - r - 15 - (active ? Math.abs(Math.sin(t * 5)) * 3 : 0);
    ctx.fillStyle = active ? '#f2b51d' : '#f1f4fa';
    ctx.beginPath(); ctx.arc(c.x, by, 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1a2040'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#1a2040'; ctx.font = `bold 13px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), c.x, by + 0.5);
    if (active) {
      ctx.fillStyle = '#f2b51d';
      ctx.beginPath(); ctx.moveTo(c.x - 6, by - 17); ctx.lineTo(c.x + 6, by - 17); ctx.lineTo(c.x, by - 11); ctx.closePath(); ctx.fill();
    }
    // 手裏剣の残り（頭上に小さく）
    for (let k = 0; k < c.shuriken; k++) drawShuriken(c.x + 15 + k * 8, by + 1, 0.4, 3.2);
  }

  function drawEnemy(s) {
    let e = s.enemy;
    const ip = introEnemyPos();
    if (ip) e = Object.assign({}, e, ip, { state: 'stalk' });
    const t = G.clock;
    const dead = G.mode === 'end' && s.result === 'win';
    ctx.save();
    if (ip && ip.jump > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath(); ctx.ellipse(e.x, e.y + 6, e.r, e.r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.translate(0, -ip.jump * 60);
    }
    ctx.translate(e.x, e.y);
    if (ip && ip.jump > 0) ctx.scale(1 + ip.jump * 0.35, 1 + ip.jump * 0.35);
    if (dead) ctx.globalAlpha = Math.max(0.35, 1 - G.endT * 0.4);
    // 隙のあいだは足元に黄色の輪
    if (e.open && G.mode === 'play') {
      ctx.strokeStyle = 'rgba(255,210,60,0.9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, e.r + 8, 0, Math.PI * 2); ctx.stroke();
    }
    // 影
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(3, 5, e.r + 4, e.r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(e.face);
    // 大太刀
    let swordA = 0.9;
    if (e.state === 'dashWind') swordA = 2.4; // 後ろに引いて構える
    else if (e.state === 'dash') swordA = 0.15;
    else if (e.state === 'sweepWind') swordA = -2.2 - Math.min(1, e.t / C.enemy.sweep.windup) * 0.6;
    else if (e.state === 'sweep') swordA = -2.8 + Math.min(1, e.t / C.enemy.sweep.active) * 5.6;
    else if (e.state === 'recover') swordA = 1.6 + Math.sin(t * 3) * 0.1;
    if (dead) swordA = 2.0;
    ctx.strokeStyle = '#d8dde3'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(Math.cos(swordA) * 14, Math.sin(swordA) * 14); ctx.lineTo(Math.cos(swordA) * 56, Math.sin(swordA) * 56); ctx.stroke();
    ctx.strokeStyle = '#2a1d10'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(Math.cos(swordA) * 10, Math.sin(swordA) * 10); ctx.lineTo(Math.cos(swordA) * 20, Math.sin(swordA) * 20); ctx.stroke();
    ctx.lineCap = 'butt';
    // 肩鎧
    ctx.fillStyle = '#5a1515';
    ctx.beginPath(); ctx.ellipse(-2, -e.r + 2, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-2, e.r - 2, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
    // 胴
    ctx.fillStyle = e.flash > 0 ? '#ffffff' : '#8a1f1f';
    ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#120808'; ctx.lineWidth = 3; ctx.stroke();
    // 兜と鍬形
    ctx.fillStyle = '#1f1414';
    ctx.beginPath(); ctx.arc(2, 0, 13, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#d9a72a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(6, -4); ctx.quadraticCurveTo(18, -10, 24, -18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, 4); ctx.quadraticCurveTo(18, 10, 24, 18); ctx.stroke();
    ctx.fillStyle = '#c23a2a';
    ctx.beginPath(); ctx.arc(11, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
    if (e.open && G.mode === 'play') {
      ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#3a2a00'; ctx.lineWidth = 3;
      ctx.font = `bold 20px ${SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const yy = e.y - e.r - 20 + Math.sin(t * 8) * 2;
      ctx.strokeText('隙', e.x, yy); ctx.fillText('隙', e.x, yy);
    }
    if (G.mode === 'intro' && G.tries === 1 && G.introT > 4.4 && G.introT < 5.7) {
      const k = G.introT - 4.4, a = Math.min(1, k * 6, (1.3 - k) * 4);
      speech(e.x, e.y - 50, '……で？', a, 17, '#fff', '#200');
    }
  }

  function drawTelegraph(s) {
    const e = s.enemy, E = C.enemy;
    if (e.state === 'dashWind' || e.state === 'dash') {
      const a = e.atk, hw = E.dash.halfWidth;
      const x0 = e.state === 'dash' ? a.x0 : e.x, y0 = e.state === 'dash' ? a.y0 : e.y;
      ctx.save();
      ctx.translate(x0, y0); ctx.rotate(a.dir);
      const locked = a.locked || e.state === 'dash';
      ctx.fillStyle = locked ? 'rgba(220,30,30,0.26)' : 'rgba(220,30,30,0.10)';
      ctx.fillRect(0, -hw, a.len, hw * 2);
      if (e.state === 'dashWind') {
        // 発動までの導火線
        const k = Math.min(1, e.t / E.dash.windup);
        ctx.fillStyle = 'rgba(200,20,20,0.30)';
        ctx.fillRect(0, -hw, a.len * k, hw * 2);
      }
      ctx.strokeStyle = locked ? 'rgba(170,10,10,0.95)' : 'rgba(190,30,30,0.7)';
      ctx.lineWidth = locked ? 2.5 : 1.5;
      if (!locked) ctx.setLineDash([8, 6]);
      ctx.strokeRect(0, -hw, a.len, hw * 2);
      ctx.setLineDash([]);
      // 矢印
      ctx.fillStyle = locked ? 'rgba(150,0,0,0.6)' : 'rgba(150,0,0,0.3)';
      for (let d = 50; d < a.len - 10; d += 46) {
        ctx.beginPath(); ctx.moveTo(d, -10); ctx.lineTo(d + 14, 0); ctx.lineTo(d, 10); ctx.lineTo(d + 5, 0); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    if (e.state === 'sweepWind' || e.state === 'sweep') {
      const R = E.sweep.radius;
      const k = e.state === 'sweep' ? 1 : Math.min(1, e.t / E.sweep.windup);
      ctx.fillStyle = 'rgba(220,30,30,0.12)';
      ctx.beginPath(); ctx.arc(e.x, e.y, R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(200,20,20,0.24)';
      ctx.beginPath(); ctx.arc(e.x, e.y, R * k, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(170,10,10,0.95)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(e.x, e.y, R, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // 敵が狙っている分身に印（切り替えても狙いは変わらない、が見て分かる）
  function drawTargetMark(s) {
    const e = s.enemy;
    if (G.mode !== 'play' || e.target == null || e.state === 'recover') return;
    const c = s.clones[e.target];
    if (!c || !c.alive) return;
    const attacking = e.state !== 'stalk';
    const rr = C.clone.radius + 14, t = G.clock;
    ctx.save();
    ctx.translate(c.x, c.y); ctx.rotate(t * (attacking ? 2.5 : 1));
    ctx.strokeStyle = attacking ? 'rgba(200,0,0,0.95)' : 'rgba(200,0,0,0.35)';
    ctx.lineWidth = attacking ? 2.5 : 1.5;
    for (let q = 0; q < 4; q++) {
      ctx.beginPath(); ctx.arc(0, 0, rr, q * Math.PI / 2 + 0.25, q * Math.PI / 2 + 1.3); ctx.stroke();
    }
    ctx.restore();
    if (attacking) {
      ctx.fillStyle = '#b00'; ctx.font = `bold 13px ${SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('狙', c.x + rr + 4, c.y + rr - 2);
    }
  }

  function drawShuriken(x, y, rot, size) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = '#5b6470'; ctx.strokeStyle = '#1d2128'; ctx.lineWidth = size > 5 ? 1.2 : 0.8;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, rr = k % 2 === 0 ? size : size * 0.38;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function drawFx() {
    for (const f of G.fx) {
      const k = f.t / f.dur;
      if (f.kind === 'smoke') {
        for (const p of f.parts) {
          const d = p.sp * Math.sqrt(k);
          ctx.fillStyle = `rgba(230,230,235,${0.85 * (1 - k)})`;
          ctx.beginPath(); ctx.arc(f.x + p.ox + Math.cos(p.a) * d, f.y + p.oy + Math.sin(p.a) * d - k * 14, p.r * (0.6 + k * 0.9), 0, Math.PI * 2); ctx.fill();
        }
        ctx.strokeStyle = `rgba(120,120,130,${0.5 * (1 - k)})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(f.x, f.y, 10 + k * 40, 0, Math.PI * 2); ctx.stroke();
      } else if (f.kind === 'spark') {
        ctx.strokeStyle = f.crit ? `rgba(255,210,60,${1 - k})` : `rgba(255,255,255,${1 - k})`;
        ctx.lineWidth = f.crit ? 3 : 2;
        for (let q = 0; q < 6; q++) {
          const a = q * Math.PI / 3 + 0.3, r1 = 4 + k * 10, r2 = 10 + k * (f.crit ? 26 : 16);
          ctx.beginPath(); ctx.moveTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1); ctx.lineTo(f.x + Math.cos(a) * r2, f.y + Math.sin(a) * r2); ctx.stroke();
        }
      } else if (f.kind === 'tink') {
        ctx.strokeStyle = `rgba(80,80,80,${1 - k})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(f.x, f.y, 3 + k * 8, 0, Math.PI * 2); ctx.stroke();
      } else if (f.kind === 'sweepArc') {
        ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - k)})`; ctx.lineWidth = 8 * (1 - k) + 2;
        ctx.beginPath(); ctx.arc(f.x, f.y, C.enemy.sweep.radius - 6, 0, Math.PI * 2); ctx.stroke();
      } else if (f.kind === 'text') {
        const a = Math.min(1, (1 - k) * 3);
        ctx.globalAlpha = a;
        ctx.font = `bold ${f.size}px ${f.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const y = f.y - f.rise * k;
        if (f.stroke) { ctx.strokeStyle = f.stroke; ctx.lineWidth = Math.max(3, f.size / 8); ctx.strokeText(f.text, f.x, y); }
        else { ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 3; ctx.strokeText(f.text, f.x, y); }
        ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, y);
        ctx.globalAlpha = 1;
      }
    }
  }

  function speech(x, y, text, alpha, size, bg, fg) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${size}px ${SERIF}`;
    const w = ctx.measureText(text).width + 20, h = size + 14;
    let bx = Math.max(8, Math.min(W - w - 8, x - w / 2));
    ctx.fillStyle = bg; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    roundRect(bx, y - h, w, h, 8); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 6, y - 1); ctx.lineTo(x + 6, y - 1); ctx.lineTo(x, y + 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + w / 2, y - h / 2 + 1);
    ctx.restore();
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------------------------------------------------------------- HUD
  function drawHUD(s) {
    // 上：本体の命／敵の体力
    ctx.fillStyle = 'rgba(14,13,19,0.92)'; ctx.fillRect(0, 0, W, 60);
    const ratio = s.body.life / s.body.max;
    const urgent = s.body.life < 20 && G.mode === 'play';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = '#e8d9c0'; ctx.font = `bold 15px ${SERIF}`;
    ctx.fillText('本体の命', 20, 20);
    ctx.fillStyle = '#2a2730'; ctx.fillRect(20, 34, 330, 14);
    ctx.fillStyle = lifeColor(ratio); ctx.fillRect(20, 34, 330 * ratio, 14);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(20, 34, 330, 14);
    const pulse = urgent ? 1 + Math.max(0, Math.sin(G.clock * 6)) * 0.06 : 1;
    ctx.save(); ctx.translate(372, 30); ctx.scale(pulse, pulse);
    ctx.font = `bold 30px ${SANS}`; ctx.fillStyle = urgent ? '#ff6a5a' : '#fff';
    ctx.fillText(s.body.life.toFixed(1), 0, 2);
    ctx.restore();
    ctx.font = `14px ${SANS}`; ctx.fillStyle = '#bbb'; ctx.textAlign = 'left';
    ctx.fillText('秒', 372 + 70, 34);

    const e = s.enemy, er = e.hp / e.maxHp;
    ctx.textAlign = 'right'; ctx.fillStyle = '#e8d9c0'; ctx.font = `bold 15px ${SERIF}`;
    ctx.fillText(`刺客　${e.hp} / ${e.maxHp}`, W - 20, 20);
    ctx.fillStyle = '#2a2730'; ctx.fillRect(W - 350, 34, 330, 14);
    ctx.fillStyle = '#b8322a'; ctx.fillRect(W - 350, 34, 330 * er, 14);
    ctx.strokeStyle = '#000'; ctx.strokeRect(W - 350, 34, 330, 14);

    // 下：分身の状況
    ctx.fillStyle = 'rgba(14,13,19,0.92)'; ctx.fillRect(0, 580, W, 60);
    s.clones.forEach((c, i) => {
      const x = 16 + i * 196, y = 586, w = 184, h = 48;
      const active = c.alive && s.active === i;
      ctx.fillStyle = c.alive ? (active ? '#3a3220' : '#22232e') : '#1a1a1f';
      roundRect(x, y, w, h, 6); ctx.fill();
      ctx.strokeStyle = active ? '#f2b51d' : (c.alive ? '#4a5a80' : '#333'); ctx.lineWidth = active ? 2.5 : 1.2; ctx.stroke();
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = c.alive ? (active ? '#f2b51d' : '#dfe6f5') : '#555';
      ctx.font = `bold 22px ${SANS}`; ctx.fillText(String(i + 1), x + 12, y + h / 2 + 1);
      ctx.font = `bold 14px ${SERIF}`;
      ctx.fillText(`分身${KANJI[i]}`, x + 36, y + 16);
      ctx.font = `12px ${SANS}`;
      ctx.fillStyle = c.alive ? (active ? '#f2d58a' : '#8f9ab5') : '#666';
      ctx.fillText(c.alive ? (active ? '操作中' : '待機中') : '煙になった', x + 36, y + 35);
      // 手裏剣
      const total = C.shuriken.count;
      for (let k = 0; k < total; k++) {
        const sx = x + 118 + k * 20, sy = y + h / 2;
        if (c.alive && k < c.shuriken) drawShuriken(sx, sy, 0.3, 7);
        else {
          ctx.strokeStyle = '#444'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.stroke();
        }
      }
      if (!c.alive) {
        ctx.strokeStyle = 'rgba(200,80,70,0.7)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + 8, y + h - 8); ctx.lineTo(x + w - 8, y + 8); ctx.stroke();
      }
    });
    ctx.textAlign = 'right'; ctx.fillStyle = '#8a8698'; ctx.font = `12px ${SANS}`;
    ctx.fillText('左クリック 刀　右クリック 手裏剣', W - 16, 598);
    ctx.fillText('Space 次の分身　1〜3 選択　Esc 説明', W - 16, 618);
  }

  function drawBanner() {
    const b = G.banner, a = Math.min(1, b.t * 8, (b.dur - b.t) * 4);
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(20,16,10,0.75)'; roundRect(W / 2 - 150, 72, 300, 36, 6); ctx.fill();
    ctx.fillStyle = '#ffd65a'; ctx.font = `bold 19px ${SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(b.text, W / 2, 91);
    ctx.restore();
  }

  function drawIntroUI() {
    const t = G.introT, first = G.tries === 1;
    const lineStart = first ? 1.7 : 0.3, lineEnd = first ? 4.4 : G.introLen;
    // 黒帯
    const bar = 46;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 60, W, bar * 0.6); ctx.fillRect(0, 580 - bar * 0.6, W, bar * 0.6);
    if (t >= lineStart && t < lineEnd + 0.3) {
      const k = t - lineStart, a = Math.min(1, k * 5, (lineEnd + 0.3 - t) * 4);
      const s = G.sim, c = s.clones[0];
      ctx.save(); ctx.globalAlpha = a;
      // 分身一から吹き出しの尾
      ctx.fillStyle = 'rgba(10,10,16,0.9)';
      const by = 120;
      roundRect(W / 2 - 300, by, 600, 104, 10); ctx.fill();
      ctx.strokeStyle = '#c9b48a'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W / 2 - 200, by + 103); ctx.lineTo(c.x + 6, c.y - 30); ctx.lineTo(W / 2 - 160, by + 103);
      ctx.fillStyle = 'rgba(10,10,16,0.9)'; ctx.fill();
      ctx.fillStyle = '#9cc4ff'; ctx.font = `bold 14px ${SANS}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('分身一', W / 2 - 280, by + 20);
      ctx.fillStyle = '#fff6e2'; ctx.font = `bold 40px ${SERIF}`; ctx.textAlign = 'center';
      const shown = '馬鹿め。そっちが本体だ';
      const n = first ? Math.min(shown.length, Math.floor(k * 14)) : shown.length;
      ctx.fillText(shown.slice(0, n), W / 2, by + 62);
      if (!first) {
        ctx.font = `14px ${SANS}`; ctx.fillStyle = '#a99f8f'; ctx.textAlign = 'right';
        ctx.fillText(`（${G.tries}回目）`, W / 2 + 285, by + 90);
      }
      ctx.restore();
    }
    if (first && t >= 5.7) {
      const a = Math.min(1, (t - 5.7) * 4);
      ctx.save(); ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(10,10,16,0.82)'; roundRect(W / 2 - 230, 250, 460, 70, 10); ctx.fill();
      ctx.fillStyle = '#ffdad2'; ctx.font = `bold 22px ${SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`本体の命、残り${C.bodyTime}秒。その前に刺客を討て`, W / 2, 285);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = `12px ${SANS}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText('クリック / Space で飛ばす', W - 16, 75);
  }

  function drawPause() {
    ctx.fillStyle = 'rgba(8,8,12,0.78)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#16141c'; roundRect(W / 2 - 300, 90, 600, 450, 12); ctx.fill();
    ctx.strokeStyle = '#7a6a4a'; ctx.lineWidth = 2; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f0e2c4'; ctx.font = `bold 30px ${SERIF}`;
    ctx.fillText('一時停止', W / 2, 130);
    ctx.font = `13px ${SANS}`; ctx.fillStyle = '#a89c88';
    ctx.fillText(G.pauseReason === 'blur' ? '（画面から離れたので止めました。本体の命も止まっています）' : '（本体の命も止まっています）', W / 2, 160);
    const rows = [
      ['WASD / 矢印', '移動'], ['マウス', '向き'], ['左クリック', '刀（振ったあと少し硬直）'], ['右クリック', `手裏剣（分身ごとに${C.shuriken.count}枚・補充なし）`],
      ['Space', '次の分身へ切り替え'], ['1〜3', '分身を直接選ぶ'], ['Esc', '一時停止 / 再開'], ['R', 'やり直す'], ['M', '音のオン / オフ'],
    ];
    ctx.font = `15px ${SANS}`;
    rows.forEach(([k, v], i) => {
      ctx.textAlign = 'right'; ctx.fillStyle = '#ffd65a'; ctx.fillText(k, W / 2 - 50, 200 + i * 25);
      ctx.textAlign = 'left'; ctx.fillStyle = '#e6e2da'; ctx.fillText(v, W / 2 - 30, 200 + i * 25);
    });
    ctx.textAlign = 'center'; ctx.fillStyle = '#cfc6b6'; ctx.font = `14px ${SANS}`;
    const tips = [
      '分身は一撃で煙になる。操作していない分身も斬られる。',
      '刺客は近い分身を狙う。切り替えても狙いは変わらない。',
      '大技のあとの「隙」に斬れば大きく効く。',
    ];
    tips.forEach((t, i) => ctx.fillText(t, W / 2, 440 + i * 22));
    ctx.fillStyle = '#ffd65a'; ctx.font = `bold 15px ${SANS}`;
    ctx.fillText('Esc / クリックで再開', W / 2, 515);
  }

  function drawResult() {
    const s = G.sim;
    const a = Math.min(1, (G.endT - G.panelAt) * 4);
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(8,8,12,0.6)'; ctx.fillRect(0, 60, W, 520);
    ctx.fillStyle = '#16141c'; roundRect(W / 2 - 280, 150, 560, 300, 12); ctx.fill();
    ctx.strokeStyle = s.result === 'win' ? '#d9b04a' : '#7a3a34'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const alive = s.clones.filter((c) => c.alive).length;
    let title, sub;
    if (s.result === 'win') {
      title = '本体、救出';
      sub = ['', '最後の一体がやり遂げた。格好はついた。', '分身をひとり失ったが、本体は助かった。', '分身、全員帰還。言うだけのことはあった。'][alive];
    } else if (s.result === 'body') {
      title = '本体、息絶える';
      sub = 'そっちが本体だったので、分身も全員消えた。';
    } else {
      title = '分身、全滅';
      sub = '本体は虫の息のまま、ひとり取り残された。';
    }
    ctx.fillStyle = s.result === 'win' ? '#ffe2a0' : '#ffb4a8';
    ctx.font = `bold 38px ${SERIF}`; ctx.fillText(title, W / 2, 200);
    ctx.fillStyle = '#e6e0d4'; ctx.font = `16px ${SERIF}`; ctx.fillText(sub, W / 2, 245);
    ctx.font = `15px ${SANS}`; ctx.fillStyle = '#bdb6a8';
    const lines = [
      `本体の残り命　${s.body.life.toFixed(1)} 秒`,
      `生き残った分身　${alive} / 3`,
      s.result === 'win' ? `隙に入れた一撃　${s.stats.openHits} 回` : `刺客の残り体力　${s.enemy.hp} / ${s.enemy.maxHp}`,
      `分身の切り替え　${s.stats.switches} 回`,
    ];
    lines.forEach((l, i) => ctx.fillText(l, W / 2, 290 + i * 26));
    ctx.fillStyle = '#ffd65a'; ctx.font = `bold 17px ${SANS}`;
    ctx.fillText('R ／ クリック　もう一度「馬鹿め」から', W / 2, 420);
    ctx.restore();
  }

  // タイトル：倒れた本体と、それを見下ろす刺客
  function drawTitleScene() {
    const L = C.layout;
    const fake = {
      body: { x: L.body.x, y: L.body.y, life: 60, max: 90 }, result: null,
    };
    drawBody(fake);
    const e = { x: L.body.x + 105, y: L.body.y + 42, r: C.enemy.radius, face: Math.atan2(-42, -105), state: 'stalk', t: 0, flash: 0, open: false };
    drawEnemy({ enemy: e, result: null });
  }
  function drawTitleUI() {
    ctx.fillStyle = 'rgba(10,9,14,0.55)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff3d6'; ctx.strokeStyle = '#000'; ctx.lineWidth = 8;
    ctx.font = `bold 62px ${SERIF}`;
    ctx.strokeText('馬鹿め。そっちが本体だ', W / 2, 200); ctx.fillText('馬鹿め。そっちが本体だ', W / 2, 200);
    ctx.font = `16px ${SANS}`; ctx.fillStyle = '#d6cbb6';
    ctx.fillText('倒れた本体の命が尽きる前に、残った分身三体で刺客を討て。', W / 2, 262);
    ctx.fillStyle = '#b0a898'; ctx.font = `14px ${SANS}`;
    ctx.fillText('WASD 移動 ／ マウス 向き ／ 左クリック 刀 ／ 右クリック 手裏剣 ／ Space・1〜3 分身切り替え ／ Esc 説明', W / 2, 300);
    const a = 0.6 + Math.sin(G.clock * 3) * 0.4;
    ctx.globalAlpha = a; ctx.fillStyle = '#ffd65a'; ctx.font = `bold 22px ${SERIF}`;
    ctx.fillText('クリックで始める', W / 2, 360);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#6f6a7a'; ctx.font = `12px ${SANS}`;
    ctx.fillText('音が鳴ります（M で消音）', W / 2, 392);
  }

  // ---------------------------------------------------------------- ループ
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!G.hold) update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 検証用フック
  window.__game = {
    G, C,
    get sim() { return G.sim; },
    start() { startNew(); },
    skip() { if (G.mode === 'intro') { G.introT = G.introLen; update(0); } },
    // 検証中は実時間の進行を止め、advance() でだけ進める
    hold(on) { G.hold = on !== false; },
    advance(sec, input) {
      G.hold = true;
      const n = Math.round(sec * 60);
      for (let i = 0; i < n; i++) {
        if (input) {
          if (input.keys) { keys.clear(); input.keys.forEach((k) => keys.add(k)); }
          if (input.mouse) inp.mouse = input.mouse;
          if (input.lmb != null) inp.lmb = input.lmb;
        }
        update(1 / 60);
      }
      render();
    },
    press(code) { window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })); },
    click(button) { if (button === 2) inp.rmbPressed = true; else inp.lmbPressed = true; },
    render,
  };
  if (params.has('autostart')) { startNew(); if (params.has('skip')) window.__game.skip(); }
})();

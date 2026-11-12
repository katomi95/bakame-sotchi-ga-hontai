// ゲームの中身（描画なし）。ブラウザでは window.NinjaSim、Node では module.exports。
// 敵のAIは「どの分身を操作しているか」を一切参照しない（切り替えで狙いが変わらない）。
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const angTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  function angDiff(a, b) {
    let d = (a - b) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L = dx * dx + dy * dy;
    let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }
  function rayToWall(x, y, ang, box, r) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let t = Infinity;
    if (dx > 1e-6) t = Math.min(t, (box.x1 - r - x) / dx);
    if (dx < -1e-6) t = Math.min(t, (box.x0 + r - x) / dx);
    if (dy > 1e-6) t = Math.min(t, (box.y1 - r - y) / dy);
    if (dy < -1e-6) t = Math.min(t, (box.y0 + r - y) / dy);
    return Math.max(0, t);
  }

  function create(C, seed) {
    if (seed == null) seed = (Math.random() * 2 ** 31) | 0;
    const L = C.layout;
    const s = {
      C, seed, rand: mulberry32(seed),
      time: 0, phase: 'play', result: null,
      body: { x: L.body.x, y: L.body.y, life: C.bodyTime, max: C.bodyTime },
      clones: L.clones.map((p, i) => ({
        id: i, x: p.x, y: p.y, alive: true,
        shuriken: C.shuriken.count, lostShuriken: 0,
        aim: Math.atan2(L.enemy.y - p.y, L.enemy.x - p.x),
        swing: null, buffer: 0, throwCd: 0,
      })),
      active: 0,
      enemy: {
        x: L.enemy.x, y: L.enemy.y, r: C.enemy.radius,
        hp: C.enemy.hp, maxHp: C.enemy.hp,
        face: Math.PI, state: 'stalk', t: 0,
        think: C.enemy.firstThink, stalkTime: 0,
        target: null, atk: null, open: false, recoverDur: 0, flash: 0,
      },
      shots: [],
      events: [],
      stats: { switches: 0, swordHits: 0, shurikenHits: 0, openHits: 0, damage: 0 },
    };
    return s;
  }

  function emit(s, type, data) { s.events.push(Object.assign({ type, t: s.time }, data || {})); }

  function nextAlive(s, from) {
    const n = s.clones.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (s.clones[i].alive) return i;
    }
    return null;
  }

  function nearestClone(s, p) {
    let best = null, bd = Infinity;
    for (const c of s.clones) {
      if (!c.alive) continue;
      const d = dist(p, c);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  function selectClone(s, i) {
    const c = s.clones[i];
    if (!c) return false;
    if (!c.alive) { emit(s, 'selectDead', { id: i }); return false; }
    if (i === s.active) return true;
    s.active = i;
    s.stats.switches++;
    emit(s, 'switch', { id: i });
    return true;
  }

  function killClone(s, c, cause) {
    if (!c.alive) return;
    c.alive = false;
    c.lostShuriken = c.shuriken;
    c.shuriken = 0;
    c.swing = null;
    emit(s, 'poof', { id: c.id, x: c.x, y: c.y, cause });
    if (s.active === c.id) {
      const n = nextAlive(s, c.id);
      if (n != null) { s.active = n; emit(s, 'autoSwitch', { id: n, from: c.id }); }
    }
  }

  function hurtEnemy(s, dmg, x, y, kind) {
    const e = s.enemy;
    const crit = e.open;
    e.hp = Math.max(0, e.hp - dmg);
    e.flash = 0.12;
    s.stats.damage += dmg;
    if (kind === 'sword') s.stats.swordHits++; else s.stats.shurikenHits++;
    if (crit) s.stats.openHits++;
    emit(s, 'hit', { x, y, dmg, crit, kind });
    // 隙でないときに斬られたら、すぐに反撃へ（正面から斬り続けると危ない）
    if (!crit && e.state === 'stalk') e.think = Math.min(e.think, s.C.enemy.aggroThink);
  }

  function step(s, dt, input) {
    input = input || {};
    if (s.phase !== 'play') return;
    s.time += dt;

    if (input.select != null) selectClone(s, input.select);
    if (input.switchNext) {
      const n = nextAlive(s, s.active);
      if (n != null && n !== s.active) selectClone(s, n);
    }

    s.body.life -= dt;
    updateClones(s, dt, input);
    updateShots(s, dt);
    updateEnemy(s, dt);

    if (s.enemy.hp <= 0) {
      s.phase = 'won'; s.result = 'win';
      emit(s, 'win');
      return;
    }
    if (s.body.life <= 0) {
      s.body.life = 0;
      s.phase = 'lost'; s.result = 'body';
      // 術者が死ねば分身も消える
      for (const c of s.clones) if (c.alive) {
        c.alive = false; c.lostShuriken = c.shuriken; c.shuriken = 0; c.swing = null;
        emit(s, 'poof', { id: c.id, x: c.x, y: c.y, cause: 'body' });
      }
      emit(s, 'bodyDead');
      return;
    }
    if (!s.clones.some((c) => c.alive)) {
      s.phase = 'lost'; s.result = 'wipe';
      emit(s, 'wipe');
    }
  }

  function swingHits(s, c) {
    const K = s.C.katana, e = s.enemy;
    const d = dist(c, e);
    if (d - e.r > K.range) return false;
    if (d < e.r) return true;
    const half = (K.arcDeg / 2) * Math.PI / 180;
    const slack = Math.asin(Math.min(1, e.r / d));
    return Math.abs(angDiff(angTo(c, e), c.swing.dir)) <= half + slack;
  }

  function updateClones(s, dt, input) {
    const C = s.C, K = C.katana, SH = C.shuriken, cr = C.clone.radius, A = C.arena, e = s.enemy;
    for (const c of s.clones) {
      if (!c.alive) continue;
      c.throwCd = Math.max(0, c.throwCd - dt);
      c.buffer = Math.max(0, c.buffer - dt);
      const isActive = c.id === s.active;

      if (isActive) {
        if (input.aim) c.aim = Math.atan2(input.aim.y - c.y, input.aim.x - c.x);
        if (input.attack) c.buffer = K.buffer;
        if (!c.swing && c.buffer > 0) {
          c.swing = { t: 0, dir: c.aim, hit: false };
          c.buffer = 0;
          emit(s, 'swing', { id: c.id, x: c.x, y: c.y, dir: c.aim });
        }
        if (input.throw && !c.swing && c.throwCd <= 0) {
          if (c.shuriken > 0) {
            c.shuriken--;
            c.throwCd = SH.cooldown;
            s.shots.push({
              x: c.x + Math.cos(c.aim) * (cr + 4), y: c.y + Math.sin(c.aim) * (cr + 4),
              vx: Math.cos(c.aim) * SH.speed, vy: Math.sin(c.aim) * SH.speed,
              life: SH.life, owner: c.id, spin: 0,
            });
            emit(s, 'throw', { id: c.id, x: c.x, y: c.y, left: c.shuriken });
          } else {
            c.throwCd = 0.25;
            emit(s, 'empty', { id: c.id, x: c.x, y: c.y });
          }
        }
        let mx = (input.move && input.move.x) || 0, my = (input.move && input.move.y) || 0;
        const m = Math.hypot(mx, my);
        if (m > 0) {
          const sp = C.clone.speed * (c.swing ? K.moveMul : 1) / Math.max(1, m);
          c.x += mx * sp * dt; c.y += my * sp * dt;
        }
      }

      if (c.swing) {
        const sw = c.swing;
        sw.t += dt;
        if (!sw.hit && sw.t >= K.windup && sw.t <= K.windup + K.active + dt) {
          if (swingHits(s, c)) {
            sw.hit = true;
            hurtEnemy(s, e.open ? K.openDamage : K.damage,
              c.x + Math.cos(sw.dir) * K.range * 0.7, c.y + Math.sin(sw.dir) * K.range * 0.7, 'sword');
          }
        }
        if (sw.t >= K.windup + K.active + K.recover) c.swing = null;
      }

      // 敵の体に食い込まない（突進中は素通り＝当たる）
      if (e.state !== 'dash') {
        const d = dist(c, e), min = e.r + cr;
        if (d < min) {
          const a = d > 0.01 ? angTo(e, c) : 0;
          c.x = e.x + Math.cos(a) * min; c.y = e.y + Math.sin(a) * min;
        }
      }
      c.x = clamp(c.x, A.x0 + cr, A.x1 - cr);
      c.y = clamp(c.y, A.y0 + cr, A.y1 - cr);
    }
    // 分身同士は重ならない
    const al = s.clones.filter((c) => c.alive);
    for (let i = 0; i < al.length; i++) for (let j = i + 1; j < al.length; j++) {
      const a = al[i], b = al[j], d = dist(a, b), min = cr * 2;
      if (d < min && d > 0.001) {
        const push = (min - d) / 2, ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
        a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
      }
    }
  }

  function updateShots(s, dt) {
    const SH = s.C.shuriken, A = s.C.arena, e = s.enemy;
    for (const p of s.shots) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; p.spin += dt * 30;
      if (Math.hypot(p.x - e.x, p.y - e.y) < e.r + SH.radius) {
        p.dead = true;
        hurtEnemy(s, e.open ? SH.openDamage : SH.damage, p.x, p.y, 'shuriken');
      } else if (p.x < A.x0 || p.x > A.x1 || p.y < A.y0 || p.y > A.y1 || p.life <= 0) {
        p.dead = true;
        emit(s, 'shotMiss', { x: clamp(p.x, A.x0, A.x1), y: clamp(p.y, A.y0, A.y1) });
      }
    }
    s.shots = s.shots.filter((p) => !p.dead);
  }

  function dashLen(s, d) {
    const D = s.C.enemy.dash, e = s.enemy;
    const len = clamp(d + D.overshoot, D.minLen, D.maxLen);
    return Math.min(len, rayToWall(e.x, e.y, e.face, s.C.arena, e.r));
  }

  function toRecover(s, dur) {
    const e = s.enemy;
    e.state = 'recover'; e.t = 0; e.recoverDur = dur; e.open = true;
    emit(s, 'recover', { x: e.x, y: e.y, dur });
  }

  function updateEnemy(s, dt) {
    const C = s.C, E = C.enemy, e = s.enemy, cr = C.clone.radius, A = C.arena;
    e.flash = Math.max(0, e.flash - dt);
    e.t += dt;
    const tgt = e.target != null ? s.clones[e.target] : null;

    switch (e.state) {
      case 'stalk': {
        e.think -= dt; e.stalkTime += dt;
        const n = nearestClone(s, e);
        if (!n) break;
        e.target = n.id;
        const d = dist(e, n);
        e.face = angTo(e, n);
        if (d > e.r + cr + 30) {
          e.x += Math.cos(e.face) * E.speed * dt;
          e.y += Math.sin(e.face) * E.speed * dt;
        }
        if (e.think <= 0) {
          const near = s.clones.filter((c) => c.alive && dist(e, c) <= E.sweep.trigger).length;
          if (near >= E.sweep.crowd || d <= E.sweep.trigger) {
            e.state = 'sweepWind'; e.t = 0; e.atk = { kind: 'sweep' };
            emit(s, 'windup', { kind: 'sweep', target: n.id });
          } else if (d >= E.dash.minRange && (d <= E.dash.maxRange || e.stalkTime >= E.patience)) {
            e.state = 'dashWind'; e.t = 0;
            e.atk = { kind: 'dash', locked: false, len: dashLen(s, d), dir: e.face };
            emit(s, 'windup', { kind: 'dash', target: n.id });
          } else {
            e.think = 0.15;
          }
        }
        break;
      }
      case 'sweepWind': {
        if (tgt && tgt.alive) {
          e.face = angTo(e, tgt);
          if (dist(e, tgt) > e.r + cr + 6) {
            e.x += Math.cos(e.face) * E.sweep.creep * dt;
            e.y += Math.sin(e.face) * E.sweep.creep * dt;
          }
        }
        if (e.t >= E.sweep.windup) { e.state = 'sweep'; e.t = 0; emit(s, 'sweep', { x: e.x, y: e.y }); }
        break;
      }
      case 'sweep': {
        for (const c of s.clones) if (c.alive && dist(e, c) < E.sweep.radius + cr) killClone(s, c, 'sweep');
        if (e.t >= E.sweep.active) toRecover(s, E.sweep.recover);
        break;
      }
      case 'dashWind': {
        const a = e.atk;
        if (!a.locked) {
          if (tgt && tgt.alive) e.face = angTo(e, tgt);
          a.dir = e.face;
          a.len = dashLen(s, tgt ? dist(e, tgt) : 0);
          if (e.t >= E.dash.track) { a.locked = true; emit(s, 'lock', {}); }
        }
        if (e.t >= E.dash.windup) {
          e.state = 'dash'; e.t = 0; a.x0 = e.x; a.y0 = e.y; a.done = 0;
          emit(s, 'dash', { x: e.x, y: e.y, dir: a.dir });
        }
        break;
      }
      case 'dash': {
        const a = e.atk;
        const stepLen = Math.min(E.dash.speed * dt, a.len - a.done);
        const px = e.x, py = e.y;
        e.x += Math.cos(a.dir) * stepLen; e.y += Math.sin(a.dir) * stepLen;
        a.done += stepLen;
        for (const c of s.clones) {
          if (c.alive && segDist(c.x, c.y, px, py, e.x, e.y) < E.dash.halfWidth + cr) killClone(s, c, 'dash');
        }
        if (a.done >= a.len - 1e-6) { emit(s, 'dashEnd', { x: e.x, y: e.y }); toRecover(s, E.dash.recover); }
        break;
      }
      case 'recover': {
        if (e.t >= e.recoverDur) {
          e.state = 'stalk'; e.t = 0; e.open = false; e.atk = null; e.target = null;
          e.stalkTime = 0;
          e.think = E.thinkMin + s.rand() * (E.thinkMax - E.thinkMin);
          emit(s, 'ready', {});
        }
        break;
      }
    }
    e.x = clamp(e.x, A.x0 + e.r, A.x1 - e.r);
    e.y = clamp(e.y, A.y0 + e.r, A.y1 - e.r);
  }

  const api = { create, step, selectClone, nextAlive, nearestClone, segDist, dist, angTo, angDiff };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NinjaSim = api;
})(typeof window !== 'undefined' ? window : globalThis);

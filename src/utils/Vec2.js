/**
 * Vec2 — легковаги 2D вектор для геймплейних обчислень.
 * Всі методи повертають новий Vec2 (immutable), окрім mutating-варіантів з суфіксом `Self`.
 */
export class Vec2 {
  /**
   * @param {number} x
   * @param {number} y
   */
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  // ── Static factory ─────────────────────────
  static of(x, y)    { return new Vec2(x, y); }
  static zero()      { return new Vec2(0, 0); }
  static fromAngle(a){ return new Vec2(Math.cos(a), Math.sin(a)); }

  // ── Arithmetic ─────────────────────────────
  add(v)   { return new Vec2(this.x + v.x, this.y + v.y); }
  sub(v)   { return new Vec2(this.x - v.x, this.y - v.y); }
  mul(s)   { return new Vec2(this.x * s,   this.y * s);   }
  div(s)   { return s !== 0 ? new Vec2(this.x / s, this.y / s) : Vec2.zero(); }

  // ── Mutating (performance-critical paths) ──
  addSelf(v)  { this.x += v.x; this.y += v.y; return this; }
  subSelf(v)  { this.x -= v.x; this.y -= v.y; return this; }
  scaleSelf(s){ this.x *= s;   this.y *= s;   return this; }

  // ── Geometry ───────────────────────────────
  /** Довжина вектора. */
  get length()  { return Math.hypot(this.x, this.y); }
  /** Квадрат довжини (швидше без sqrt). */
  get length2() { return this.x * this.x + this.y * this.y; }

  /** Нормалізований вектор одиничної довжини. */
  normalize() {
    const len = this.length;
    return len > 0 ? this.div(len) : Vec2.zero();
  }

  /** Скалярний добуток. */
  dot(v)    { return this.x * v.x + this.y * v.y; }

  /** Перпендикулярний вектор (повернутий на 90°). */
  perp()    { return new Vec2(-this.y, this.x); }

  /** Кут вектора у радіанах. */
  angle()   { return Math.atan2(this.y, this.x); }

  /** Відстань до іншого вектора. */
  distTo(v) { return Math.hypot(v.x - this.x, v.y - this.y); }

  /** Квадрат відстані (без sqrt, для порівнянь). */
  dist2To(v){
    const dx = v.x - this.x, dy = v.y - this.y;
    return dx * dx + dy * dy;
  }

  /** Лінійна інтерполяція до іншого вектора. */
  lerp(v, t) {
    return new Vec2(
      this.x + (v.x - this.x) * t,
      this.y + (v.y - this.y) * t
    );
  }

  /** Клонування. */
  clone() { return new Vec2(this.x, this.y); }

  /** Деструктуризація для Canvas API. */
  toArray() { return [this.x, this.y]; }

  toString() { return `Vec2(${this.x.toFixed(2)}, ${this.y.toFixed(2)})`; }
}

// ─────────────────────────────────────────────
//  Math утиліти (без класу — просто функції)
// ─────────────────────────────────────────────

/** Clamp числа між min та max. */
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/** Лінійна інтерполяція між a та b. */
export const lerp  = (a, b, t) => a + (b - a) * t;

/** Випадкове ціле від min до max включно. */
export const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** Випадкове float від min до max. */
export const randFloat = (min, max) => Math.random() * (max - min) + min;

/** Градуси → радіани. */
export const deg2rad = (d) => d * (Math.PI / 180);

/** Радіани → градуси. */
export const rad2deg = (r) => r * (180 / Math.PI);

/** Нормалізувати кут у [-PI, PI]. */
export const normalizeAngle = (a) => {
  while (a >  Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

/**
 * Перевірка перетину двох прямокутників (AABB).
 * @param {{x,y,w,h}} a
 * @param {{x,y,w,h}} b
 */
export const rectOverlap = (a, b) =>
  a.x < b.x + b.w &&
  a.x + a.w > b.x &&
  a.y < b.y + b.h &&
  a.y + a.h > b.y;

/**
 * Відстань точки до прямокутника (0 якщо всередині).
 * @param {number} px @param {number} py
 * @param {{x,y,w,h}} rect
 */
export const pointRectDist = (px, py, rect) => {
  const dx = Math.max(rect.x - px, 0, px - (rect.x + rect.w));
  const dy = Math.max(rect.y - py, 0, py - (rect.y + rect.h));
  return Math.hypot(dx, dy);
};

/**
 * ParticleSystem — легка система частинок на Canvas.
 *
 * Ефекти:
 *   • Вибух (explosion)    — помаранчеві/червоні іскри
 *   • Золото (goldPop)     — золоті бризки при видобутку
 *   • Кров (hitSplash)     — червоні краплі при ударі
 *   • Будівництво (build)  — жовтий пил при завершенні
 */
export class ParticleSystem {
  constructor() {
    /** @type {Particle[]} */
    this._particles = [];
  }

  // ─────────────────────────────────────────────
  //  Ефекти (публічне API)
  // ─────────────────────────────────────────────

  /**
   * @param {number} x @param {number} y
   */
  explosion(x, y) {
    this._burst(x, y, {
      count:    16,
      colors:   ['#e74c3c', '#e67e22', '#f1c40f', '#fff'],
      speed:    [40, 120],
      life:     [0.4, 0.8],
      size:     [2, 5],
      gravity:  40,
      fade:     true,
    });
  }

  goldPop(x, y, amount) {
    this._burst(x, y, {
      count:  Math.min(amount, 8),
      colors: ['#f1c40f', '#f39c12', '#fff'],
      speed:  [20, 60],
      life:   [0.5, 1.0],
      size:   [2, 4],
      gravity:-20, // вгору
      fade:   true,
    });
  }

  hitSplash(x, y) {
    this._burst(x, y, {
      count:  6,
      colors: ['#c0392b', '#e74c3c', '#922b21'],
      speed:  [30, 80],
      life:   [0.3, 0.5],
      size:   [2, 4],
      gravity:30,
      fade:   true,
    });
  }

  buildComplete(x, y) {
    this._burst(x, y, {
      count:  12,
      colors: ['#f1c40f', '#2ecc71', '#fff'],
      speed:  [20, 50],
      life:   [0.6, 1.2],
      size:   [2, 5],
      gravity:-10,
      fade:   true,
    });
  }

  // ─────────────────────────────────────────────
  //  Update & Render
  // ─────────────────────────────────────────────

  /**
   * @param {number} dtSec
   */
  update(dtSec) {
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.x   += p.vx * dtSec;
      p.y   += p.vy * dtSec;
      p.vy  += p.gravity * dtSec;
      p.life -= dtSec;
      if (p.life <= 0) this._particles.splice(i, 1);
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cameraX
   * @param {number} cameraY
   */
  render(ctx, cameraX = 0, cameraY = 0) {
    ctx.save();
    ctx.translate(-cameraX, -cameraY);

    for (const p of this._particles) {
      const alpha = p.fade ? Math.max(0, p.life / p.maxLife) : 1;
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  get count() { return this._particles.length; }

  // ─────────────────────────────────────────────
  //  Внутрішній spawn
  // ─────────────────────────────────────────────

  _burst(x, y, opts) {
    const { count, colors, speed, life, size, gravity, fade } = opts;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd   = speed[0] + Math.random() * (speed[1] - speed[0]);
      const maxLife = life[0] + Math.random() * (life[1] - life[0]);
      this._particles.push({
        x, y,
        vx:      Math.cos(angle) * spd,
        vy:      Math.sin(angle) * spd,
        gravity: gravity ?? 0,
        color:   colors[Math.floor(Math.random() * colors.length)],
        size:    size[0]  + Math.random() * (size[1] - size[0]),
        life:    maxLife,
        maxLife,
        fade:    fade ?? true,
      });
    }
  }
}

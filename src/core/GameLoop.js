/**
 * GameLoop — серце рушія.
 *
 * Реалізує класичну модель з двома незалежними частотами:
 *   • FIXED UPDATE  (~10 тіків/сек) — детермінована логіка (економіка, бій, ШІ)
 *   • RENDER UPDATE (~60 fps)       — плавний рендер із інтерполяцією
 *
 * Це розділення гарантує:
 *   1. Ігрова логіка не залежить від FPS пристрою.
 *   2. Анімації завжди плавні.
 *   3. Однаковий результат бою на будь-якому телефоні.
 */

const MS_PER_TICK = 100; // 10 логічних тіків на секунду

export class GameLoop {
  /**
   * @param {{
   *   update: (dt: number, tick: number) => void,
   *   render: (alpha: number) => void,
   *   onFpsUpdate?: (fps: number) => void
   * }} callbacks
   */
  constructor({ update, render, onFpsUpdate }) {
    this._update     = update;
    this._render     = render;
    this._onFpsUpdate = onFpsUpdate ?? null;

    this._running    = false;
    this._rafId      = null;

    this._lastTime   = 0;
    this._accumulator = 0;
    this._tick       = 0;

    // FPS counter
    this._fpsFrames  = 0;
    this._fpsTimer   = 0;
    this._fps        = 0;

    this._loop = this._loop.bind(this);
  }

  /** Запустити цикл. */
  start() {
    if (this._running) return;
    this._running   = true;
    this._lastTime  = performance.now();
    this._rafId     = requestAnimationFrame(this._loop);
  }

  /** Зупинити цикл (пауза). */
  stop() {
    this._running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /** Поточний тік (лічильник логічних оновлень). */
  get tick() { return this._tick; }

  /** Поточний FPS (рендерних кадрів на секунду). */
  get fps()  { return this._fps; }

  // ─────────────────────────────────────────────
  //  Приватна частина
  // ─────────────────────────────────────────────

  /**
   * Основна функція циклу.
   * @param {DOMHighResTimeStamp} timestamp
   */
  _loop(timestamp) {
    if (!this._running) return;

    const deltaMs = Math.min(timestamp - this._lastTime, 250); // cap at 250ms (tab switch guard)
    this._lastTime = timestamp;

    // ── Fixed Update (логіка) ─────────────────
    this._accumulator += deltaMs;
    while (this._accumulator >= MS_PER_TICK) {
      this._update(MS_PER_TICK / 1000, this._tick); // dt у секундах
      this._tick++;
      this._accumulator -= MS_PER_TICK;
    }

    // alpha ∈ [0, 1] — скільки вже "пройшли" до наступного тіку
    const alpha = this._accumulator / MS_PER_TICK;

    // ── Render ────────────────────────────────
    this._render(alpha);

    // ── FPS counter ───────────────────────────
    this._fpsFrames++;
    this._fpsTimer += deltaMs;
    if (this._fpsTimer >= 1000) {
      this._fps      = this._fpsFrames;
      this._fpsFrames = 0;
      this._fpsTimer -= 1000;
      this._onFpsUpdate?.(this._fps);
    }

    this._rafId = requestAnimationFrame(this._loop);
  }
}

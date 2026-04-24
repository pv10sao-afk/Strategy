/**
 * MiniMap — мінімальна карта в правому куті HUD.
 *
 * Рендерить на окремому малому Canvas (наприклад 100×120px):
 *   • Тайли (спрощені кольори)
 *   • Будівлі гравця (сині крапки) та ворога (червоні)
 *   • Юніти (маленькі кружечки)
 *   • Viewport rectangle (видима частина камери)
 *
 * Підтримує тап — переміщення камери до точки на мінімапі.
 */
export class MiniMap {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number[][]}        tileGrid
   * @param {Object}            config
   * @param {import('../renderer/Renderer.js').Renderer} renderer
   */
  constructor(canvas, tileGrid, config, renderer) {
    this.canvas   = canvas;
    this.ctx      = canvas.getContext('2d');
    this.grid     = tileGrid;
    this.renderer = renderer;
    this.tileSize = config.map.tileSize;

    this.rows = tileGrid.length;
    this.cols = tileGrid[0]?.length ?? 24;

    // Масштаб: скільки пікселів мінімапи = 1 тайл карти
    this.scaleX = canvas.width  / this.cols;
    this.scaleY = canvas.height / this.rows;

    // Кольори тайлів (спрощено)
    this._tileColors = ['#4a7c59', '#2a6496', '#6e6e6e', '#c8b560', '#a0784a'];

    // Pre-рендер статичної карти
    this._staticCanvas = document.createElement('canvas');
    this._staticCanvas.width  = canvas.width;
    this._staticCanvas.height = canvas.height;
    this._prerenderStatic();

    // Тап по мінімапі → pan камера
    canvas.addEventListener('click',      (e) => this._onTap(e));
    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); this._onTap(e.touches[0]); }, { passive: false });
  }

  // ─────────────────────────────────────────────
  //  Оновлення (викликається з render)
  // ─────────────────────────────────────────────

  /**
   * @param {import('../state/GameState.js').GameState} state
   */
  render(state) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 1. Статична карта
    ctx.drawImage(this._staticCanvas, 0, 0);

    // 2. Будівлі
    this._drawBuildings(ctx, state.playerBuildings, '#4fc3f7');
    this._drawBuildings(ctx, state.enemyBuildings,  '#ef5350');

    // 3. Юніти
    this._drawUnits(ctx, state.playerUnits, '#69f0ae');
    this._drawUnits(ctx, state.enemyUnits,  '#ff5252');

    // 4. Viewport рамка
    this._drawViewport(ctx);

    // 5. Рамка мінімапи
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // ─────────────────────────────────────────────
  //  Приватні методи
  // ─────────────────────────────────────────────

  _prerenderStatic() {
    const ctx = this._staticCanvas.getContext('2d');
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const id    = this.grid[r][c];
        ctx.fillStyle = this._tileColors[id] ?? '#4a7c59';
        ctx.fillRect(
          c * this.scaleX, r * this.scaleY,
          Math.ceil(this.scaleX), Math.ceil(this.scaleY)
        );
      }
    }
  }

  _drawBuildings(ctx, buildings, color) {
    ctx.fillStyle = color;
    for (const [, b] of buildings) {
      if (b.isDestroyed) continue;
      const x = (b.tileX + b.def.size.w / 2) * this.scaleX;
      const y = (b.tileY + b.def.size.h / 2) * this.scaleY;
      const w = b.def.size.w * this.scaleX;
      const h = b.def.size.h * this.scaleY;
      ctx.fillRect(x - w / 2, y - h / 2, Math.max(w, 2), Math.max(h, 2));
    }
  }

  _drawUnits(ctx, units, color) {
    ctx.fillStyle = color;
    for (const [, u] of units) {
      if (u.isDead) continue;
      const x = (u.x / this.tileSize) * this.scaleX;
      const y = (u.y / this.tileSize) * this.scaleY;
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawViewport(ctx) {
    const cam   = this.renderer.camera;
    const vw    = this.renderer.entityCanvas.width;
    const vh    = this.renderer.entityCanvas.height;
    const fullW = this.cols * this.tileSize;
    const fullH = this.rows * this.tileSize;

    const rx = (cam.x / fullW) * this.canvas.width;
    const ry = (cam.y / fullH) * this.canvas.height;
    const rw = (vw   / fullW) * this.canvas.width;
    const rh = (vh   / fullH) * this.canvas.height;

    ctx.strokeStyle = 'rgba(255,255,0,0.7)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(rx, ry, rw, rh);
  }

  _onTap(event) {
    const rect  = this.canvas.getBoundingClientRect();
    const mx    = event.clientX - rect.left;
    const my    = event.clientY - rect.top;

    // Конвертуємо в тайли карти
    const tileX = mx / this.scaleX;
    const tileY = my / this.scaleY;

    // Центруємо камеру на цій точці
    const cam   = this.renderer.camera;
    const halfW = this.renderer.entityCanvas.width  / 2;
    const halfH = this.renderer.entityCanvas.height / 2;

    const targetX = tileX * this.tileSize - halfW;
    const targetY = tileY * this.tileSize - halfH;

    this.renderer.panCamera(targetX - cam.x, targetY - cam.y);
  }
}

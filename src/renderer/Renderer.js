/**
 * Renderer — малює всю гру на HTML5 Canvas.
 *
 * Два незалежних Canvas:
 *   • mapCanvas    — статична карта (тайли), перемальовується рідко
 *   • entityCanvas — динамічні об'єкти (будівлі, юніти, снаряди, UI)
 *
 * Підтримує:
 *   • Camera pan та scroll
 *   • Спрайти (або fallback placeholder-прямокутники)
 *   • HP-бари під об'єктами
 *   • Прогрес-бар будівництва
 *   • Анімація снарядів
 */
export class Renderer {
  /**
   * @param {HTMLCanvasElement} mapCanvas
   * @param {HTMLCanvasElement} entityCanvas
   * @param {import('../core/AssetLoader.js').AssetLoader} assets
   * @param {Object} config  - parsed config.json
   */
  constructor(mapCanvas, entityCanvas, assets, config) {
    this.mapCanvas    = mapCanvas;
    this.entityCanvas = entityCanvas;
    this.mCtx = mapCanvas.getContext('2d');
    this.eCtx = entityCanvas.getContext('2d');
    this.assets   = assets;
    this.tileSize = config.map.tileSize;
    this.config   = config;

    // Камера (зсув у пікселях)
    this.camera = { x: 0, y: 0 };
    this.zoom   = 1.0;

    // Тайлова карта
    /** @type {number[][]|null} */
    this._tileGrid = null;

    // Palette для fallback-рендеру
    this._palette = {
      grass: '#4a7c59', sand: '#c8b560', water: '#2a6496',
      rock:  '#6e6e6e', bridge: '#a0784a',
    };

    // Ghost-будівля (preview cursor в режимі build)
    this._ghostTile = null;   // {tx, ty, def}
    this._ghostDef  = null;
    this._buildingColors = {
      player: { economy: '#3da650', military: '#e07b39', defense: '#5b7fcd', core: '#9b59b6' },
      enemy:  { economy: '#c0392b', military: '#e74c3c', defense: '#8e44ad', core: '#8b0000' },
    };
  }

  // ─────────────────────────────────────────────
  //  Ініціалізація
  // ─────────────────────────────────────────────

  /**
   * Встановити ghost (preview) будівлі.
   * @param {{tx:number,ty:number}|null} tile
   * @param {Object|null} def
   */
  setGhost(tile, def) {
    this._ghostTile = tile;
    this._ghostDef  = def;
  }

  /**
   * @param {number[][]} tileGrid
   * @param {{ tileTypes: Object }} mapZones
   */
  setMap(tileGrid, mapZones) {
    this._tileGrid  = tileGrid;
    this._tileTypes = mapZones.tileTypes;
    
    // Передобчислити кеш tileId -> key для миттєвого рендерингу (оптимізація FPS)
    this._tileIdToKey = [];
    for (const [key, val] of Object.entries(this._tileTypes)) {
      this._tileIdToKey[val.id] = key;
    }
    
    this._renderStaticMap();
  }

  resize(w, h) {
    [this.mapCanvas, this.entityCanvas].forEach((c) => {
      c.width  = w;
      c.height = h;
    });
    if (this._tileGrid) this._renderStaticMap();
  }

  // ─────────────────────────────────────────────
  //  Публічний метод рендерингу (викликається з GameLoop)
  // ─────────────────────────────────────────────

  /**
   * @param {import('../state/GameState.js').GameState} state
   * @param {number} alpha             - інтерполяція 0..1
   * @param {Set<string>} selectedIds  - ID виділених юнітів
   */
  render(state, alpha, selectedIds = null) {
    const ctx = this.eCtx;
    ctx.clearRect(0, 0, this.entityCanvas.width, this.entityCanvas.height);

    ctx.save();
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    this._renderBuildings(ctx, state.playerBuildings, 'player');
    this._renderBuildings(ctx, state.enemyBuildings,  'enemy');
    this._renderUnits(ctx, state.playerUnits, 'player', alpha, selectedIds);
    this._renderUnits(ctx, state.enemyUnits,  'enemy',  alpha, null);
    this._renderProjectiles(ctx, state.projectiles);
    this._renderGhost(ctx);

    ctx.restore();
  }

  // ─────────────────────────────────────────────
  //  Статична карта (тайли)
  // ─────────────────────────────────────────────

  _renderStaticMap() {
    const ctx  = this.mCtx;
    const grid = this._tileGrid;
    const ts   = this.tileSize;

    // Розміри екрану у світових координатах
    const viewW = this.mapCanvas.width / this.zoom;
    const viewH = this.mapCanvas.height / this.zoom;

    // Визначати видиму область відносно камери (тільки видимі тайли)
    const startCol = Math.max(0, Math.floor(this.camera.x / ts) - 1);
    const startRow = Math.max(0, Math.floor(this.camera.y / ts) - 1);
    const endCol   = Math.min(grid[0].length - 1, Math.ceil((this.camera.x + viewW)  / ts) + 1);
    const endRow   = Math.min(grid.length    - 1, Math.ceil((this.camera.y + viewH) / ts) + 1);

    ctx.clearRect(0, 0, this.mapCanvas.width, this.mapCanvas.height);

    ctx.save();
    ctx.scale(this.zoom, this.zoom);
    
    // Зсув відносно камери
    const offX = -this.camera.x;
    const offY = -this.camera.y;

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const tileId = grid[row]?.[col] ?? 0;
        const key    = this._tileIdToKey[tileId] ?? 'grass';

        const x = col * ts + offX;
        const y = row * ts + offY;

        // Спрайт або fallback
        const img = this.assets.getImage(`tile_${key}`);
        if (img) {
          ctx.drawImage(img, x, y, ts, ts);
        } else {
          ctx.fillStyle = this._palette[key] ?? '#4a7c59';
          ctx.fillRect(x, y, ts, ts);

          // Міст — намалювати зверху
          if (tileId === 4) {
            ctx.fillStyle = '#a0784a';
            ctx.fillRect(x + 3, y, ts - 6, ts);
            ctx.fillStyle = '#8b6535';
            ctx.fillRect(x + 3, y + 4, ts - 6, 4);
            ctx.fillRect(x + 3, y + ts - 8, ts - 6, 4);
          }

          // Сітка (тільки для grass)
          if (tileId === 0) {
            ctx.strokeStyle = 'rgba(0,0,0,0.06)';
            ctx.lineWidth   = 0.5;
            ctx.strokeRect(x, y, ts, ts);
          }
        }
      }
    }
    
    ctx.restore();
  }

  /** Перемалювати статичну карту з поточною камерою. */
  _redrawMap() {
    this._renderStaticMap();
  }

  // ─────────────────────────────────────────────
  //  Будівлі
  // ─────────────────────────────────────────────

  _renderBuildings(ctx, buildings, team) {
    const ts = this.tileSize;

    for (const [, b] of buildings) {
      if (b.isDestroyed) continue;

      const px = b.tileX * ts;
      const py = b.tileY * ts;
      const pw = b.def.size.w * ts;
      const ph = b.def.size.h * ts;

      const img = this.assets.getImage(b.def.id);

      if (img) {
        ctx.save();
        if (b.isBuilding) ctx.globalAlpha = 0.55;
        ctx.drawImage(img, px, py, pw, ph);
        ctx.restore();
      } else {
        // Fallback
        const cat   = b.def.category ?? 'core';
        const color = this._buildingColors[team]?.[cat] ?? '#888';
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(px + 2, py + 2, pw - 4, ph - 4, 4);
        ctx.fill();

        // Назва
        ctx.fillStyle = '#fff';
        ctx.font      = `bold ${Math.min(10, ts * 0.35)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(b.def.name, px + pw / 2, py + ph / 2 + 4);
      }

      // HP bar
      this._drawHpBar(ctx, px, py - 8, pw, b.hp, b.maxHp);

      // Прогрес будівництва
      if (b.isBuilding) {
        this._drawProgressBar(ctx, px, py + ph, pw, b.buildProgress / 100, '#f1c40f');
      }

      // Прогрес тренування
      if (b.trainingQueue.length > 0) {
        const q       = b.trainingQueue[0];
        const percent = q.progress / q.totalSec;
        this._drawProgressBar(ctx, px, py + ph + 6, pw, percent, '#3498db');
      }
    }
  }

  // ─────────────────────────────────────────────
  //  Юніти
  // ─────────────────────────────────────────────

  _renderUnits(ctx, units, team, alpha, selectedIds = null) {
    const ts   = this.tileSize;
    const r    = ts * 0.4;
    const now  = performance.now();

    for (const [id, u] of units) {
      if (u.isDead) continue;

      const pos      = u.renderPos(alpha);
      const isSelected = selectedIds?.has(id) ?? false;

      // ── Кільце виділення (перед юнітом) ───────────
      if (isSelected) {
        const pulse  = 0.5 + 0.5 * Math.sin(now * 0.005);
        const ringR  = r + 4 + pulse * 3;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(241,196,15,${0.5 + pulse * 0.4})`;
        ctx.lineWidth   = 2.5;
        ctx.stroke();
        // Внутрішній fill
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(241,196,15,${0.08 + pulse * 0.06})`;
        ctx.fill();
      }

      // ── Тінь під юнітом ───────────────────────────
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y + r * 0.9, r * 0.7, r * 0.25, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fill();

      // ── Спрайт або fallback ───────────────────────
      const img = this.assets.getImage(u.def.id);
      if (img) {
        ctx.drawImage(img, pos.x - r, pos.y - r, r * 2, r * 2);
      } else {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.fillStyle = team === 'player' ? '#2ecc71' : '#e74c3c';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 1.5;
        ctx.stroke();

        ctx.fillStyle    = '#fff';
        ctx.font         = `bold ${r * 0.75}px sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          { melee:'⚔', ranged:'🏹', siege:'💣' }[u.def.category] ?? '?',
          pos.x, pos.y
        );
        ctx.textBaseline = 'alphabetic';
      }

      // ── HP bar ────────────────────────────────────
      this._drawHpBar(ctx, pos.x - r, pos.y - r - 8, r * 2, u.hp, u.maxHp);

      // ── Стрілка руху (якщо moving) ────────────────
      if (u.isMoving && u.path?.length > 0) {
        const dest = u.path[u.path.length - 1];
        ctx.beginPath();
        ctx.setLineDash([3, 3]);
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(dest.x, dest.y);
        ctx.strokeStyle = team === 'player' ? 'rgba(46,204,113,0.4)' : 'rgba(231,76,60,0.3)';
        ctx.lineWidth   = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // ─────────────────────────────────────────────
  //  Снаряди
  // ─────────────────────────────────────────────

  _renderProjectiles(ctx, projectiles) {
    for (const p of projectiles) {
      const img = this.assets.getImage(`proj_${p.sprite}`);
      if (img) {
        ctx.drawImage(img, p.x - 6, p.y - 6, 12, 12);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = p.sprite === 'arrow' ? '#f39c12' :
                        p.sprite === 'cannonball' ? '#2c3e50' : '#e74c3c';
        ctx.fill();
      }
    }
  }

  // ─────────────────────────────────────────────
  //  Спільні UI-компоненти на Canvas
  // ─────────────────────────────────────────────

  _drawHpBar(ctx, x, y, width, hp, maxHp) {
    if (hp >= maxHp) return;
    const ratio = hp / maxHp;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x, y, width, 4);
    ctx.fillStyle = ratio > 0.5 ? '#2ecc71' : ratio > 0.25 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(x, y, width * ratio, 4);
  }

  _drawProgressBar(ctx, x, y, width, ratio, color) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x, y, width, 4);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width * ratio, 4);
  }

  // ─────────────────────────────────────────────
  //  Ghost будівля (preview)
  // ─────────────────────────────────────────────

  _renderGhost(ctx) {
    if (!this._ghostTile || !this._ghostDef) return;
    const ts  = this.tileSize;
    const def = this._ghostDef;
    const { tx, ty } = this._ghostTile;
    const px = tx * ts, py = ty * ts;
    const pw = def.size.w * ts, ph = def.size.h * ts;
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);

    ctx.save();
    ctx.globalAlpha = 0.35 + pulse * 0.2;
    ctx.fillStyle   = '#2ecc71';
    ctx.beginPath();
    ctx.roundRect(px + 2, py + 2, pw - 4, ph - 4, 4);
    ctx.fill();

    ctx.globalAlpha = 0.7 + pulse * 0.25;
    ctx.strokeStyle = '#2ecc71';
    ctx.lineWidth   = 2;
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.fillStyle   = '#fff';
    ctx.font        = `bold ${Math.min(12, ts * 0.35)}px sans-serif`;
    ctx.textAlign   = 'center';
    ctx.fillText(def.name, px + pw / 2, py + ph / 2 + 4);
    ctx.restore();
  }

  /** Встановити прозорий макет будівлі для підтвердження будівництва. */
  setBuildPreview(def, tile) {
    this._ghostDef  = def;
    this._ghostTile = tile;
  }

  // ─────────────────────────────────────────────
  //  Камера та Зум
  // ─────────────────────────────────────────────

  setZoom(z, screenCenter) {
    const oldZoom = this.zoom;
    const newZoom = Math.max(0.4, Math.min(z, 2.5));
    if (oldZoom === newZoom) return;

    // Зберігаємо світові координати під екраном незмінними (center points)
    const svX = screenCenter?.x ?? (this.entityCanvas.width / 2);
    const svY = screenCenter?.y ?? (this.entityCanvas.height / 2);
    const worldX = (svX / oldZoom) + this.camera.x;
    const worldY = (svY / oldZoom) + this.camera.y;

    this.zoom = newZoom;
    this.camera.x = worldX - (svX / newZoom);
    this.camera.y = worldY - (svY / newZoom);

    // panCamera(0,0) застосовує затискання (clamp) меж карти
    this.panCamera(0, 0);
  }

  panCamera(dx, dy) {
    const mapW = (this._tileGrid?.[0]?.length ?? 24) * this.tileSize;
    const mapH = (this._tileGrid?.length    ?? 40) * this.tileSize;
    
    // Viewport size uin world units
    const viewW = this.entityCanvas.width / this.zoom;
    const viewH = this.entityCanvas.height / this.zoom;

    this.camera.x = Math.max(0, Math.min(this.camera.x + dx, Math.max(0, mapW - viewW)));
    this.camera.y = Math.max(0, Math.min(this.camera.y + dy, Math.max(0, mapH - viewH)));
    this._redrawMap();
  }

  /** Конвертація піксель екрана → тайл карти. */
  screenToTile(screenX, screenY) {
    const worldX = (screenX / this.zoom) + this.camera.x;
    const worldY = (screenY / this.zoom) + this.camera.y;
    return {
      x: Math.floor(worldX / this.tileSize),
      y: Math.floor(worldY / this.tileSize),
    };
  }

  /** Конвертація тайлу → піксель центру на екрані. */
  tileToScreen(tileX, tileY) {
    return {
      x: (tileX * this.tileSize - this.camera.x + this.tileSize / 2) * this.zoom,
      y: (tileY * this.tileSize - this.camera.y + this.tileSize / 2) * this.zoom,
    };
  }
}

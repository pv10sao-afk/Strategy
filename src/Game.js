import { bus }           from './core/EventBus.js';
import { AssetLoader }   from './core/AssetLoader.js';
import { GameLoop }      from './core/GameLoop.js';
import { GameState }     from './state/GameState.js';
import { Building }      from './entities/Building.js';
import { EconomySystem } from './economy/EconomySystem.js';
import { CombatSystem }  from './combat/CombatSystem.js';
import { Pathfinder }    from './pathfinding/Pathfinder.js';
import { Renderer }      from './renderer/Renderer.js';
import { AIController }  from './ai/AIController.js';
import { UIManager }     from './ui/UIManager.js';

/**
 * Game — головний оркестратор.
 *
 * Завантажує конфіги → ініціалізує системи → запускає GameLoop.
 * Це єдине місце де усі системи знають одна про одну.
 * Всі інші модулі спілкуються через EventBus.
 */
export class Game {
  constructor() {
    this.assets  = new AssetLoader();
    this.loop    = null;
    this._started = false;

    // Системи (ініціалізуються після завантаження)
    this.state   = null;
    this.economy = null;
    this.combat  = null;
    this.ai      = null;
    this.renderer= null;
    this.ui      = null;
  }

  // ─────────────────────────────────────────────
  //  Запуск
  // ─────────────────────────────────────────────

  async start(options = {}) {
    if (this._started) return;
    this._started = true;

    this._showLoadingScreen(true);
    this._setLoadingText('Завантаження ресурсів...');

    try {
      this.instantBuild = options.instantBuild ?? true;
      // 1. Завантаження
      await this._loadAssets();
      this._applyStartOptions(options);
      this._setLoadingText('Ініціалізація систем...');

      // 2. Системи
      this._initSystems();
      this._setLoadingText('Генерація карти...');

      // 3. Початковий стан
      this._setupInitialState();
      this._setLoadingText('Запуск...');

      // 4. GameLoop
      this._startLoop();

      this._showLoadingScreen(false);
    } catch (err) {
      this._started = false;
      console.error('[Game] Fatal error during startup:', err);
      this._showCrashScreen(err);
    }
  }

  _applyStartOptions(options) {
    const difficulty = options?.difficulty;
    if (!difficulty || !this.config?.ai) return;

    if (['easy', 'medium', 'hard'].includes(difficulty)) {
      this.config.ai.difficulty = difficulty;
    }
  }

  _setLoadingText(msg) {
    const el = document.querySelector('.loading-sub');
    if (el) el.textContent = msg;
  }

  _showCrashScreen(err) {
    const sub = document.querySelector('.loading-sub');
    const bar = document.getElementById('load-bar-fill');
    if (sub) {
      sub.style.color   = '#e74c3c';
      sub.style.fontSize = '12px';
      sub.style.maxWidth = '90vw';
      sub.style.whiteSpace = 'pre-wrap';
      sub.style.textAlign  = 'left';
      sub.textContent  = `❌ ПОМИЛКА:\n${err.message}\n\n${err.stack ?? ''}`;
    }
    if (bar) {
      bar.style.background = '#e74c3c';
      bar.style.width = '100%';
    }
  }

  // ─────────────────────────────────────────────
  //  Завантаження
  // ─────────────────────────────────────────────

  async _loadAssets() {
    const bar = document.getElementById('load-bar-fill');

    this.assets.onProgress((p) => {
      if (bar) bar.style.width = `${Math.round(p * 100)}%`;
    });

    await this.assets.loadAll({
      json: [
        { key: 'config',   src: 'data/config.json'    },
        { key: 'entities', src: 'data/entities.json'  },
        { key: 'mapZones', src: 'data/map_zones.json' },
      ],
      images: [
        // Тайли
        { key: 'tile_grass',  src: 'assets/sprites/tiles/grass.png'  },
        { key: 'tile_water',  src: 'assets/sprites/tiles/water.png'  },
        { key: 'tile_rock',   src: 'assets/sprites/tiles/rock.png'   },
        { key: 'tile_sand',   src: 'assets/sprites/tiles/sand.png'   },
        { key: 'tile_bridge', src: 'assets/sprites/tiles/bridge.png' },
        // Будівлі
        { key: 'wall',              src: 'assets/sprites/buildings/wall.png'              },
        { key: 'reinforced_wall',   src: 'assets/sprites/buildings/reinforced_wall.png'   },
        { key: 'gold_mine',         src: 'assets/sprites/buildings/gold_mine.png'         },
        { key: 'treasury',          src: 'assets/sprites/buildings/treasury.png'          },
        { key: 'barracks',          src: 'assets/sprites/buildings/barracks.png'          },
        { key: 'tower',             src: 'assets/sprites/buildings/tower.png'             },
        { key: 'headquarters',      src: 'assets/sprites/buildings/headquarters.png'      },
        // Юніти
        { key: 'warrior',  src: 'assets/sprites/units/warrior.png'  },
        { key: 'archer',   src: 'assets/sprites/units/archer.png'   },
        { key: 'knight',   src: 'assets/sprites/units/knight.png'   },
        { key: 'catapult', src: 'assets/sprites/units/catapult.png' },
        // Снаряди
        { key: 'proj_arrow',      src: 'assets/sprites/projectiles/arrow.png'      },
        { key: 'proj_cannonball', src: 'assets/sprites/projectiles/cannonball.png' },
        { key: 'proj_boulder',    src: 'assets/sprites/projectiles/boulder.png'    },
      ],
    });

    this.config     = this.assets.getData('config');
    this.entities   = this.assets.getData('entities');
    this.mapZonesDef= this.assets.getData('mapZones');
  }

  // ─────────────────────────────────────────────
  //  Ініціалізація систем
  // ─────────────────────────────────────────────

  _initSystems() {
    const cfg   = this.config;
    const ents  = this.entities;
    const ts    = cfg.map.tileSize;
    const mapCanvas    = document.getElementById('map-canvas');
    const entityCanvas = document.getElementById('entity-canvas');

    // Глобальний доступ до класу Building (обходимо циклічну залежність)
    globalThis.__BUILDING_CLASS__ = Building;
    globalThis.__bus = bus;

    // Стан
    this.state = new GameState(cfg);

    // Генерація тайлової карти (проста процедурна)
    this.tileGrid = this._generateMap(cfg);

    // Pathfinder
    const collisionGrid = this._buildCollisionGrid(cfg);
    this.pathfinder = new Pathfinder(collisionGrid, ts, false);

    // Рендерер
    this.renderer = new Renderer(mapCanvas, entityCanvas, this.assets, cfg);
    this.renderer.setMap(this.tileGrid, this.mapZonesDef);

    // Системи логіки
    this.economy = new EconomySystem(this.state, ents, ts);
    this.combat  = new CombatSystem(this.state, this.pathfinder, ents, cfg);
    this.ai      = new AIController(this.state, ents, cfg);

    // UI (після стану та рендерера)
    this.ui = new UIManager(ents, this.state, this.renderer, { instantBuild: this.instantBuild });
    globalThis.__uiManager = this.ui;

    // ШІ будівля через EventBus
    bus.on('cmd:aiPlaceBuilding', ({ defId, tileX, tileY }) => {
      const def = ents.buildings[defId];
      if (!def) return;
      // Перевірка колізії і для ворога
      if (!this.state.canPlace(tileX, tileY, def.size.w, def.size.h)) return;
      const b = new Building(def, tileX, tileY, 'enemy');
      this.state.addBuilding(b, 'enemy');
    });

    // Наказ руху юнітам (CMD від UIManager)
    bus.on('cmd:moveOrder', ({ tileX, tileY, unitIds }) => {
      // Ідемо до CombatSystem/Unit через шину подій
      bus.emit('combat:moveOrder', { tileX, tileY, unitIds });
    });

    // Ghost preview: канвас touchmove/mousemove — оновлюємо ghost
    const updateGhost  = (screenX, screenY) => {
      const defId = this.ui?.buildDefId;
      if (!defId || this.ui?.inputMode !== 'build') {
        this.renderer.setGhost(null, null);
        return;
      }
      const rect  = entityCanvas.getBoundingClientRect();
      const tile  = this.renderer.screenToTile(screenX - rect.left, screenY - rect.top);
      const def   = this.entities.buildings[defId];
      this.renderer.setGhost({ tx: tile.x, ty: tile.y }, def);
    };

    entityCanvas?.addEventListener('touchmove', e => {
      const t = e.touches[0];
      updateGhost(t.clientX, t.clientY);
    }, { passive: true });
    entityCanvas?.addEventListener('mousemove', e => updateGhost(e.clientX, e.clientY));
    entityCanvas?.addEventListener('mouseleave',  () => this.renderer.setGhost(null, null));

    // Resize
    window.addEventListener('resize', () => this._onResize());
    this._onResize();
  }

  // ─────────────────────────────────────────────
  //  Початковий стан
  // ─────────────────────────────────────────────

  _setupInitialState() {
    const ents = this.entities;
    const cfg  = this.config;
    const mapH = cfg.map.defaultMapHeight;
    const mapW = cfg.map.defaultMapWidth;

    // Штаб гравця (посередині нижньої зони)
    const pHQ = new Building(ents.buildings.headquarters,
      Math.floor(mapW / 2) - 1,
      mapH - 5, 'player');
    pHQ.status = 'ready';
    this.state.addBuilding(pHQ, 'player');

    // Штаб ворога (посередині верхньої зони)
    const eHQ = new Building(ents.buildings.headquarters,
      Math.floor(mapW / 2) - 1,
      2, 'enemy');
    eHQ.status = 'ready';
    this.state.addBuilding(eHQ, 'enemy');

    // Стартова шахта гравця
    const pMine = new Building(ents.buildings.gold_mine,
      Math.floor(mapW / 2) - 4,
      mapH - 5, 'player');
    pMine.status = 'ready';
    this.state.addBuilding(pMine, 'player');

    this.state.setPhase('playing');
  }

  // ─────────────────────────────────────────────
  //  GameLoop
  // ─────────────────────────────────────────────

  _startLoop() {
    this.loop = new GameLoop({
      update: (dt, tick) => {
        if (this.state.phase !== 'playing') return;
        this.state.tick = tick;
        this.economy.update(dt);
        this.combat.update(dt);
        this.ai.update(dt);
      },
      render: (alpha) => {
        // Передаємо виділені ID юнітів в рендерер
        const sel = this.ui?.selectedUnitIds ?? null;
        this.renderer.render(this.state, alpha, sel);
      },
      onFpsUpdate: (fps) => {
        this.ui.updateFps(fps);
      },
    });

    this.loop.start();
  }

  // ─────────────────────────────────────────────
  //  Генерація карти
  // ─────────────────────────────────────────────

  _generateMap(cfg) {
    const rows = cfg.map.defaultMapHeight;
    const cols = cfg.map.defaultMapWidth;
    // 0=grass, 1=water, 2=rock, 3=sand, 4=bridge
    const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

    const rng  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const set  = (r, c, t) => { if (r >= 0 && r < rows && c >= 0 && c < cols) grid[r][c] = t; };
    const get  = (r, c)    => (r >= 0 && r < rows && c >= 0 && c < cols) ? grid[r][c] : -1;

    // ── 1. Межі — вода по боках ──────────────────
    for (let r = 0; r < rows; r++) {
      grid[r][0] = 1;
      grid[r][1] = 1;
      grid[r][cols - 1] = 1;
      grid[r][cols - 2] = 1;
    }
    for (let c = 0; c < cols; c++) {
      grid[0][c] = 1;
      grid[rows - 1][c] = 1;
    }

    // ── 2. Ріка посередині (нейтральна зона) ────
    const riverRow = Math.floor(rows / 2);
    let   riverC   = 2;
    // Звивиста ріка на 2 широки через всю карту
    for (let c = 2; c < cols - 2; c++) {
      if (Math.random() < 0.3) riverC += rng(-1, 1);
      riverC = Math.max(2, Math.min(cols - 3, riverC));
      const half = Math.random() < 0.5 ? 2 : 1;
      for (let rr = riverRow - half; rr <= riverRow + half; rr++) {
        set(rr, c, 1); // water
      }
    }
    // Місток через ріку (посередина)
    const bridgeCol = Math.floor(cols / 2);
    for (let rr = riverRow - 2; rr <= riverRow + 2; rr++) {
      set(rr, bridgeCol,     4); // bridge
      set(rr, bridgeCol - 1, 4);
    }

    // ── 3. Скелясті кластери в нейтральній зоні ─
    const neutralStart = cfg.map.zones.neutral.startRow;
    const neutralEnd   = cfg.map.zones.neutral.endRow;
    for (let i = 0; i < 6; i++) {
      const cr = rng(neutralStart + 1, neutralEnd - 1);
      const cc = rng(3, cols - 4);
      const sz = rng(1, 3);
      for (let dr = -sz; dr <= sz; dr++) {
        for (let dc = -sz; dc <= sz; dc++) {
          if (Math.random() < 0.65 && Math.abs(dr) + Math.abs(dc) <= sz + 1) {
            set(cr + dr, cc + dc, 2); // rock
          }
        }
      }
    }

    // ── 4. Піщані плями (зона гравця та ворога) ─
    const zones = [
      { start: cfg.map.zones.player.startRow, end: cfg.map.zones.player.endRow },
      { start: cfg.map.zones.enemy.startRow,  end: cfg.map.zones.enemy.endRow  },
    ];
    for (const z of zones) {
      for (let i = 0; i < 3; i++) {
        const cr = rng(z.start + 1, z.end - 2);
        const cc = rng(3, cols - 4);
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            if (Math.random() < 0.55 && get(cr + dr, cc + dc) === 0) {
              set(cr + dr, cc + dc, 3); // sand
            }
          }
        }
      }
    }

    // ── 5. Лісові плями (скеля) по всій карті ──
    for (let i = 0; i < 8; i++) {
      const cr = rng(2, rows - 3);
      const cc = rng(3, cols - 4);
      if (Math.abs(cr - riverRow) < 3) continue; // не перекривати ріку
      if (cr > cfg.map.zones.player.startRow + 2 && cr < cfg.map.zones.player.endRow - 2) continue; // не в базі
      if (cr < cfg.map.zones.enemy.endRow - 2 && cr > cfg.map.zones.enemy.startRow + 2) continue;
      for (let dc = -1; dc <= 1; dc++) {
        if (Math.random() < 0.5 && get(cr, cc + dc) === 0) {
          set(cr, cc + dc, 2); // rock/forest
        }
      }
    }

    // ── 6. Очистити зони основних баз (повинні бути зелені) ─
    const clearZone = (startRow, endRow, margin = 2) => {
      for (let r = startRow + margin; r < endRow - margin; r++) {
        for (let c = 3; c < cols - 3; c++) {
          if (grid[r][c] === 2 || grid[r][c] === 1) grid[r][c] = 0;
        }
      }
    };
    clearZone(cfg.map.zones.player.startRow, cfg.map.zones.player.endRow);
    clearZone(cfg.map.zones.enemy.startRow,  cfg.map.zones.enemy.endRow);

    return grid;
  }

  /**
   * Collision grid: 0=walkable, 1=blocked (вода, скелі, + будівлі).
   * Будівлі додаються/видаляються через EventBus у реальному часі.
   */
  _buildCollisionGrid(cfg) {
    const grid = this.tileGrid.map((row) =>
      row.map((t) => (this._isTileWalkable(t) ? 0 : 1))
    );

    bus.on('building:added', ({ building }) => {
      for (let dy = 0; dy < building.def.size.h; dy++) {
        for (let dx = 0; dx < building.def.size.w; dx++) {
          const row = building.tileY + dy;
          const col = building.tileX + dx;
          if (grid[row]) grid[row][col] = 1;
        }
      }
      this.pathfinder.grid = grid;
    });

    bus.on('building:removed', ({ id }) => {
      // Знайти будівлю... вже видалена зі state, тому просто перебудовуємо
      this._rebuildCollision(grid, cfg);
      this.pathfinder.grid = grid;
    });

    return grid;
  }

  _rebuildCollision(grid, cfg) {
    // Reset до базового тайлового стану
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        grid[r][c] = this._isTileWalkable(this.tileGrid[r][c]) ? 0 : 1;
      }
    }
    // Накласти поточні будівлі
    const addBuildings = (map) => {
      for (const [, b] of map) {
        if (b.isDestroyed) continue;
        for (let dy = 0; dy < b.def.size.h; dy++) {
          for (let dx = 0; dx < b.def.size.w; dx++) {
            const row = b.tileY + dy, col = b.tileX + dx;
            if (grid[row]) grid[row][col] = 1;
          }
        }
      }
    };
    addBuildings(this.state.playerBuildings);
    addBuildings(this.state.enemyBuildings);
  }

  _isTileWalkable(tileId) {
    const tileTypes = this.mapZonesDef?.tileTypes;
    if (!tileTypes) return tileId === 0 || tileId === 3 || tileId === 4;

    const tile = Object.values(tileTypes).find((entry) => entry.id === tileId);
    return tile?.passable ?? false;
  }

  // ─────────────────────────────────────────────
  //  Resize
  // ─────────────────────────────────────────────

  _onResize() {
    const hudH   = this.config?.ui?.hudHeightPx   ?? 60;
    // Read actual panel height from CSS variable to accommodate mobile changes
    const cssPanelH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panel-height')) || 0;
    const panelH = cssPanelH > 0 ? cssPanelH : (this.config?.ui?.panelHeightPx ?? 180);
    const modeBarH = document.getElementById('mode-bar')?.offsetHeight ?? 32;
    const w = window.innerWidth;
    const h = window.innerHeight - hudH - panelH - modeBarH;
    this.renderer?.resize(w, Math.max(100, h));
  }

  // ─────────────────────────────────────────────
  //  Завантажувальний екран
  // ─────────────────────────────────────────────

  _showLoadingScreen(show) {
    const el = document.getElementById('loading-screen');
    if (!el) return;
    el.style.display = show ? 'flex' : 'none';
  }
}

import { bus } from '../core/EventBus.js';

/**
 * GameState — єдине джерело правди про стан гри.
 *
 * Зберігає:
 *   • ресурси (золото, ліміт сховища)
 *   • всі будівлі та юніти гравця / ворога
 *   • стан гри (playing | paused | won | lost)
 *
 * НІКОЛИ не рендерить і не оновлює логіку — лише зберігає та повідомляє.
 * Усі зміни виплескуються через EventBus.
 */
export class GameState {
  /**
   * @param {Object} config  - завантажений data/config.json
   */
  constructor(config) {
    const eco = config.economy;

    // ── Ресурси ───────────────────────────────
    this.gold        = eco.startingGold;
    this.storageCap  = eco.baseStorageCap;
    this.armySize    = 0;
    this.maxArmySize = eco.maxArmySize;

    // ── Будівлі ───────────────────────────────
    /** @type {Map<string, import('../entities/Building.js').Building>} */
    this.playerBuildings = new Map();
    /** @type {Map<string, import('../entities/Building.js').Building>} */
    this.enemyBuildings  = new Map();

    // ── Юніти ─────────────────────────────────
    /** @type {Map<string, import('../entities/Unit.js').Unit>} */
    this.playerUnits = new Map();
    /** @type {Map<string, import('../entities/Unit.js').Unit>} */
    this.enemyUnits  = new Map();

    // ── Снаряди ───────────────────────────────
    /** @type {Set<Object>} */
    this.projectiles = new Set();

    // ── Зайняті тайли (колізія будівель) ──────
    /** @type {Set<string>} - ключ: "x,y" */
    this.occupiedTiles = new Set();

    // ── Зона гравця (для валідації будівництва) ─
    this.playerZone = config.map.zones.player;
    this.mapCols    = config.map.defaultMapWidth;
    this.mapRows    = config.map.defaultMapHeight;

    // ── Стан гри ──────────────────────────────
    /** @type {'loading'|'playing'|'paused'|'won'|'lost'} */
    this.phase = 'loading';

    // ── Тік ───────────────────────────────────
    this.tick = 0;
  }

  // ─────────────────────────────────────────────
  //  Ресурси
  // ─────────────────────────────────────────────

  /**
   * Додати золото (видобуток, нагорода).
   * @param {number} amount
   */
  addGold(amount) {
    const prev  = this.gold;
    this.gold   = Math.min(this.gold + amount, this.storageCap);
    const delta = this.gold - prev;
    if (delta > 0) {
      bus.emit('gold:changed', { gold: this.gold, cap: this.storageCap, delta });
    }
  }

  /**
   * Витратити золото. Повертає false якщо недостатньо.
   * @param {number} amount
   * @returns {boolean}
   */
  spendGold(amount) {
    if (this.gold < amount) return false;
    this.gold -= amount;
    bus.emit('gold:changed', { gold: this.gold, cap: this.storageCap, delta: -amount });
    return true;
  }

  /**
   * Збільшити ліміт сховища (при будівництві скарбниць).
   * @param {number} amount
   */
  addStorageCap(amount) {
    this.storageCap += amount;
    bus.emit('storage:changed', { storageCap: this.storageCap });
  }

  // ─────────────────────────────────────────────
  //  Колізія тайлів
  // ─────────────────────────────────────────────

  /**
   * Перевірити чи можна поставити будівлю на вказані тайли.
   * @param {number} tileX @param {number} tileY
   * @param {number} w @param {number} h
   * @returns {boolean}
   */
  canPlace(tileX, tileY, w, h) {
    // Перевірка меж карти
    if (tileX < 1 || tileY < 1 || tileX + w > this.mapCols - 1 || tileY + h > this.mapRows - 1) return false;
    // Перевірка зайнятих тайлів
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (this.occupiedTiles.has(`${tileX + dx},${tileY + dy}`)) return false;
      }
    }
    return true;
  }

  /**
   * Відмітити тайли будівлі як зайняті.
   */
  markOccupied(building) {
    for (let dy = 0; dy < building.def.size.h; dy++) {
      for (let dx = 0; dx < building.def.size.w; dx++) {
        this.occupiedTiles.add(`${building.tileX + dx},${building.tileY + dy}`);
      }
    }
  }

  /**
   * Звільнити тайли будівлі.
   */
  unmarkOccupied(building) {
    for (let dy = 0; dy < building.def.size.h; dy++) {
      for (let dx = 0; dx < building.def.size.w; dx++) {
        this.occupiedTiles.delete(`${building.tileX + dx},${building.tileY + dy}`);
      }
    }
  }

  // ─────────────────────────────────────────────
  //  Будівлі
  // ─────────────────────────────────────────────

  /**
   * @param {import('../entities/Building.js').Building} building
   * @param {'player'|'enemy'} team
   */
  addBuilding(building, team = 'player') {
    const map = team === 'player' ? this.playerBuildings : this.enemyBuildings;
    map.set(building.id, building);
    this.markOccupied(building);

    if (team === 'player' && building.def.storage) {
      this.addStorageCap(building.def.storage.capacity);
    }

    bus.emit('building:added', { building, team });
  }

  /**
   * @param {string} id
   * @param {'player'|'enemy'} team
   */
  removeBuilding(id, team = 'player') {
    const map      = team === 'player' ? this.playerBuildings : this.enemyBuildings;
    const building = map.get(id);
    if (!building) return;

    this.unmarkOccupied(building);

    if (team === 'player' && building.def.storage) {
      this.storageCap = Math.max(0, this.storageCap - building.def.storage.capacity);
      this.gold = Math.min(this.gold, this.storageCap);
      bus.emit('storage:changed', { storageCap: this.storageCap });
      bus.emit('gold:changed', { gold: this.gold, cap: this.storageCap, delta: 0 });
    }

    map.delete(id);
    bus.emit('building:removed', { id, team });

    this._checkVictory(team);
  }

  // ─────────────────────────────────────────────
  //  Юніти
  // ─────────────────────────────────────────────

  /**
   * @param {import('../entities/Unit.js').Unit} unit
   * @param {'player'|'enemy'} team
   */
  addUnit(unit, team = 'player') {
    const map = team === 'player' ? this.playerUnits : this.enemyUnits;
    map.set(unit.id, unit);
    if (team === 'player') this.armySize++;
    bus.emit('unit:spawned', { unit, team });
  }

  /**
   * @param {string} id
   * @param {'player'|'enemy'} team
   */
  removeUnit(id, team = 'player') {
    const map = team === 'player' ? this.playerUnits : this.enemyUnits;
    if (map.delete(id)) {
      if (team === 'player') this.armySize = Math.max(0, this.armySize - 1);
      bus.emit('unit:died', { id, team });
    }
  }

  // ─────────────────────────────────────────────
  //  Снаряди
  // ─────────────────────────────────────────────

  addProjectile(proj) { this.projectiles.add(proj); }
  removeProjectile(proj) { this.projectiles.delete(proj); }

  // ─────────────────────────────────────────────
  //  Фаза гри
  // ─────────────────────────────────────────────

  setPhase(phase) {
    this.phase = phase;
    bus.emit('game:phaseChanged', { phase });
  }

  // ─────────────────────────────────────────────
  //  Перевірка умов перемоги
  // ─────────────────────────────────────────────

  _checkVictory(destroyedTeam) {
    const isHQAlive = (buildings) =>
      [...buildings.values()].some((b) => b.def.id === 'headquarters');

    if (destroyedTeam === 'player' && !isHQAlive(this.playerBuildings)) {
      this.setPhase('lost');
    } else if (destroyedTeam === 'enemy' && !isHQAlive(this.enemyBuildings)) {
      this.setPhase('won');
    }
  }

  // ─────────────────────────────────────────────
  //  Серіалізація (для автозбереження)
  // ─────────────────────────────────────────────

  serialize() {
    return {
      gold:       this.gold,
      storageCap: this.storageCap,
      armySize:   this.armySize,
      tick:       this.tick,
      phase:      this.phase,
      playerBuildings: [...this.playerBuildings.values()].map((b) => b.serialize()),
      enemyBuildings:  [...this.enemyBuildings.values()].map((b) => b.serialize()),
      playerUnits: [...this.playerUnits.values()].map((u) => u.serialize()),
      enemyUnits:  [...this.enemyUnits.values()].map((u) => u.serialize()),
    };
  }
}

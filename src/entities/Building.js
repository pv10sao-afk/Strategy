import { bus } from '../core/EventBus.js';

/**
 * Building — екземпляр будівлі на карті.
 * Вся конфігурація береться з entities.json через `def`.
 * Клас відповідає лише за стан конкретного екземпляру.
 */
export class Building {
  /**
   * @param {Object} def       - запис з entities.json (buildings[id])
   * @param {number} tileX     - позиція на карті (тайли)
   * @param {number} tileY
   * @param {'player'|'enemy'} team
   */
  constructor(def, tileX, tileY, team) {
    this.id    = `${def.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.def   = def;
    this.team  = team;

    // Позиція
    this.tileX = tileX;
    this.tileY = tileY;

    // Здоров'я
    this.hp    = def.maxHp;
    this.maxHp = def.maxHp;

    // Будівництво
    /** @type {'building'|'ready'|'destroyed'} */
    this.status        = 'building';
    this.buildProgress = 0;      // 0..100
    this.buildTimeSec  = def.buildTime;

    // Виробництво (для шахт, скарбниць тощо)
    this._productionTimer = 0;

    // Бойовий таймер (для веж)
    this._attackTimer = 0;

    // Черга тренування (для казарм)
    /** @type {Array<{unitId: string, progress: number, totalSec: number}>} */
    this.trainingQueue = [];
  }

  // ─────────────────────────────────────────────
  //  Пошкодження
  // ─────────────────────────────────────────────

  /**
   * @param {number} dmg
   * @returns {boolean} чи знищена будівля
   */
  takeDamage(dmg) {
    this.hp = Math.max(0, this.hp - dmg);
    bus.emit('building:damaged', { id: this.id, hp: this.hp, maxHp: this.maxHp });
    if (this.hp <= 0) {
      this.status = 'destroyed';
      bus.emit('building:destroyed', { id: this.id, team: this.team });
      return true;
    }
    return false;
  }

  // ─────────────────────────────────────────────
  //  Будівництво
  // ─────────────────────────────────────────────

  /**
   * Оновити прогрес будівництва.
   * @param {number} dtSec
   * @returns {boolean} true — якщо щойно завершено
   */
  updateConstruction(dtSec) {
    if (this.status !== 'building') return false;

    const elapsed = dtSec / this.buildTimeSec * 100;
    this.buildProgress = Math.min(100, this.buildProgress + elapsed);

    if (this.buildProgress >= 100) {
      this.status = 'ready';
      bus.emit('building:ready', { id: this.id, defId: this.def.id, team: this.team });
      return true;
    }
    return false;
  }

  // ─────────────────────────────────────────────
  //  Виробництво ресурсів
  // ─────────────────────────────────────────────

  /**
   * Повертає кількість ресурсу якщо настав час виробництва.
   * @param {number} dtSec
   * @returns {number}
   */
  tickProduction(dtSec) {
    if (this.status !== 'ready') return 0;
    const prod = this.def.production;
    if (!prod) return 0;

    this._productionTimer += dtSec;
    if (this._productionTimer >= prod.intervalSec) {
      this._productionTimer -= prod.intervalSec;
      return prod.amount;
    }
    return 0;
  }

  // ─────────────────────────────────────────────
  //  Тренування юнітів
  // ─────────────────────────────────────────────

  /**
   * Поставити юніта в чергу навчання.
   * @param {string} unitId
   * @param {number} trainTimeSec
   */
  enqueueUnit(unitId, trainTimeSec) {
    this.trainingQueue.push({ unitId, progress: 0, totalSec: trainTimeSec });
  }

  /**
   * @param {number} dtSec
   * @returns {string|null} unitId — якщо юніт готовий
   */
  tickTraining(dtSec) {
    if (this.status !== 'ready' || this.trainingQueue.length === 0) return null;

    const first = this.trainingQueue[0];
    first.progress += dtSec;

    bus.emit('training:progress', {
      buildingId: this.id,
      unitId:  first.unitId,
      percent: (first.progress / first.totalSec) * 100,
    });

    if (first.progress >= first.totalSec) {
      this.trainingQueue.shift();
      return first.unitId;
    }
    return null;
  }

  // ─────────────────────────────────────────────
  //  Утиліти
  // ─────────────────────────────────────────────

  get isReady()     { return this.status === 'ready';     }
  get isBuilding()  { return this.status === 'building';  }
  get isDestroyed() { return this.status === 'destroyed'; }

  /** Центр будівлі у тайлах. */
  get centerTile() {
    return {
      x: this.tileX + this.def.size.w / 2,
      y: this.tileY + this.def.size.h / 2,
    };
  }

  serialize() {
    return {
      id:            this.id,
      defId:         this.def.id,
      tileX:         this.tileX,
      tileY:         this.tileY,
      team:          this.team,
      hp:            this.hp,
      status:        this.status,
      buildProgress: this.buildProgress,
      trainingQueue: this.trainingQueue,
    };
  }
}

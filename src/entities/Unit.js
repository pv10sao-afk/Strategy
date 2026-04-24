import { bus } from '../core/EventBus.js';

/**
 * Unit — бойовий юніт на карті.
 * FSM (Finite State Machine) з 5 станами:
 *   idle → moving → attacking → dead
 *                ↘ returning (якщо ціль мертва)
 */
export class Unit {
  /**
   * @param {Object} def         - запис з entities.json (units[id])
   * @param {number} x           - позиція у пікселях
   * @param {number} y
   * @param {'player'|'enemy'} team
   */
  constructor(def, x, y, team) {
    this.id   = `unit_${def.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.def  = def;
    this.team = team;

    // Позиція (пікселі для плавного руху)
    this.x = x;
    this.y = y;

    // Для інтерполяції рендера
    this.prevX = x;
    this.prevY = y;

    // Здоров'я
    this.hp    = def.maxHp;
    this.maxHp = def.maxHp;

    // FSM
    /** @type {'idle'|'moving'|'attacking'|'returning'|'dead'} */
    this.state = 'idle';

    // Шлях (масив {x, y} у пікселях)
    /** @type {Array<{x:number, y:number}>} */
    this.path = [];
    this._pathIndex = 0;

    // Ціль атаки
    /** @type {string|null} */
    this.targetId   = null;
    this.targetTeam = null;
    this.moveTarget = null;

    // Таймер атаки
    this._attackTimer = 0;

    // Флаг "відправлено у атаку гравцем"
    this.isOrdered = false;
  }

  // ─────────────────────────────────────────────
  //  Пошкодження
  // ─────────────────────────────────────────────

  /**
   * @param {number} dmg
   * @param {'physical'|'magic'|'siege'} dmgType
   * @returns {boolean} true якщо юніт загинув
   */
  takeDamage(dmg, dmgType = 'physical') {
    let effective = dmg;

    // Броня
    const armor = this.def.armor;
    if (armor) {
      const resist = dmgType === 'magic'
        ? armor.magicResist ?? 0
        : armor.physicalResist ?? 0;
      effective = Math.round(dmg * (1 - resist));
    }

    this.hp = Math.max(0, this.hp - effective);
    bus.emit('unit:damaged', { id: this.id, hp: this.hp, maxHp: this.maxHp, team: this.team });

    if (this.hp <= 0) {
      this._die();
      return true;
    }
    return false;
  }

  _die() {
    this.state = 'dead';
    bus.emit('unit:died', { id: this.id, team: this.team });
  }

  // ─────────────────────────────────────────────
  //  Рух
  // ─────────────────────────────────────────────

  /**
   * Задати шлях та перейти у стан moving.
   * @param {Array<{x:number, y:number}>} path
   */
  setPath(path, moveTarget = null) {
    this.path       = path;
    this._pathIndex = 0;
    this.moveTarget = moveTarget;
    this.state      = 'moving';
  }

  /**
   * Оновити позицію вздовж шляху.
   * @param {number} dtSec
   * @param {number} tileSize   - пікселів на тайл
   * @returns {boolean} true якщо досяг кінця шляху
   */
  move(dtSec, tileSize) {
    if (this.state !== 'moving' || this._pathIndex >= this.path.length) return true;

    this.prevX = this.x;
    this.prevY = this.y;

    const target  = this.path[this._pathIndex];
    const speed   = this.def.speed * tileSize; // пікс/сек
    const dx      = target.x - this.x;
    const dy      = target.y - this.y;
    const dist    = Math.hypot(dx, dy);
    const step    = speed * dtSec;

    if (step >= dist) {
      this.x = target.x;
      this.y = target.y;
      this._pathIndex++;
      if (this._pathIndex >= this.path.length) {
        return true; // досягнув фінальної точки
      }
    } else {
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
    }

    return false;
  }

  // ─────────────────────────────────────────────
  //  Атака
  // ─────────────────────────────────────────────

  /**
   * @param {number} dtSec
   * @returns {boolean} true якщо атакував цього тіку
   */
  tickAttack(dtSec) {
    if (this.state !== 'attacking') return false;
    this._attackTimer += dtSec * 1000; // ms
    if (this._attackTimer >= this.def.combat.attackSpeedMs) {
      this._attackTimer -= this.def.combat.attackSpeedMs;
      return true; // час наносити удар
    }
    return false;
  }

  /**
   * Перевірити чи ціль в радіусі атаки.
   * @param {{x:number, y:number}} targetPos
   * @param {number} tileSize
   */
  isInRange(targetPos, tileSize) {
    const rangePx = this.def.combat.attackRangeTiles * tileSize;
    return Math.hypot(targetPos.x - this.x, targetPos.y - this.y) <= rangePx;
  }

  /**
   * Розрахувати пошкодження з урахуванням бонусів.
   * @param {string} targetType 'unit'|'building'
   */
  calcDamage(targetType) {
    let dmg = this.def.combat.attackDamage;
    if (targetType === 'building' && this.def.combat.bonusVsBuildings) {
      dmg *= this.def.combat.bonusVsBuildings;
    }
    return Math.round(dmg);
  }

  // ─────────────────────────────────────────────
  //  Утиліти
  // ─────────────────────────────────────────────

  get isDead()      { return this.state === 'dead';      }
  get isMoving()    { return this.state === 'moving';    }
  get isAttacking() { return this.state === 'attacking'; }

  /** Позиція для рендера з інтерполяцією. */
  renderPos(alpha) {
    if (!this.isMoving) {
      return { x: this.x, y: this.y };
    }
    return {
      x: this.prevX + (this.x - this.prevX) * alpha,
      y: this.prevY + (this.y - this.prevY) * alpha,
    };
  }

  serialize() {
    return {
      id:       this.id,
      defId:    this.def.id,
      x:        this.x,
      y:        this.y,
      hp:       this.hp,
      state:    this.state,
      team:     this.team,
      targetId: this.targetId,
    };
  }
}

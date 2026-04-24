import { bus } from '../core/EventBus.js';

/**
 * EconomySystem — керує видобутком ресурсів та будівництвом.
 *
 * Відповідальність:
 *   • Тікати виробництво кожної готової будівлі
 *   • Додавати золото до GameState
 *   • Просувати чергу будівництва
 *   • Просувати чергу тренування юнітів
 *   • Спавнити нові будівлі (за командою від UIManager)
 */
export class EconomySystem {
  /**
   * @param {import('../state/GameState.js').GameState} state
   * @param {Object} entitiesDef  - parsed entities.json
   * @param {number} tileSize
   */
  constructor(state, entitiesDef, tileSize) {
    this.state       = state;
    this.defs        = entitiesDef;
    this.tileSize    = tileSize;

    // Слухаємо запити від UI
    bus.on('cmd:buildBuilding',  this._onBuildBuilding.bind(this));
    bus.on('cmd:trainUnit',      this._onTrainUnit.bind(this));
    bus.on('cmd:upgradeBuilding',this._onUpgradeBuilding.bind(this));
    bus.on('cmd:demolishBuilding', this._onDemolishBuilding.bind(this));
  }

  // ─────────────────────────────────────────────
  //  Головне оновлення (викликається з GameLoop)
  // ─────────────────────────────────────────────

  /**
   * @param {number} dtSec  - час з останнього тіку в секундах
   */
  update(dtSec) {
    this._updatePlayerBuildings(dtSec);
    this._updateEnemyBuildings(dtSec);
  }

  // ─────────────────────────────────────────────
  //  Оновлення будівель гравця
  // ─────────────────────────────────────────────

  _updatePlayerBuildings(dtSec) {
    for (const [id, building] of this.state.playerBuildings) {
      if (building.isDestroyed) continue;

      // Будівництво
      if (building.isBuilding) {
        building.updateConstruction(dtSec);
        continue; // будується — не виробляє
      }

      // Виробництво золота
      const prod = building.tickProduction(dtSec);
      if (prod > 0) {
        this.state.addGold(prod);
        bus.emit('fx:goldPop', {
          x: building.tileX * this.tileSize,
          y: building.tileY * this.tileSize,
          amount: prod,
        });
      }

      // Тренування юнітів
      const readyUnitId = building.tickTraining(dtSec);
      if (readyUnitId) {
        // Спавн одразу під казармою, але не виходимо за межі зони гравця (щоб не потрапити у воду)
        // Гарантовано чиста зона (margin = 2) закінчується на endRow - 3
        const safeMaxRow = (this.state.playerZone?.endRow ?? 40) - 3;
        const spawnX = building.tileX + Math.floor(building.def.size.w / 2);
        const spawnY = Math.min(safeMaxRow, building.tileY + building.def.size.h);
        bus.emit('cmd:spawnUnit', {
          unitDefId: readyUnitId,
          tileX:    spawnX,
          tileY:    spawnY,
          team:     'player',
        });
      }
    }
  }

  _updateEnemyBuildings(dtSec) {
    for (const [id, building] of this.state.enemyBuildings) {
      if (building.isDestroyed) continue;
      if (building.isBuilding) {
        building.updateConstruction(dtSec);
      }
    }
  }

  // ─────────────────────────────────────────────
  //  Команди від UI
  // ─────────────────────────────────────────────

  /**
   * @param {{ defId: string, tileX: number, tileY: number }} payload
   */
  _onBuildBuilding({ defId, tileX, tileY }) {
    const def = this.defs.buildings[defId];
    if (!def) {
      console.warn(`[Economy] Unknown building defId: ${defId}`);
      return;
    }

    // Валідація зони гравця (будуємо тільки у своїй зоні)
    const zone = this.state.playerZone;
    if (zone) {
      const maxRow = tileY + def.size.h - 1;
      const minRow = tileY;
      if (minRow < zone.startRow || maxRow > zone.endRow) {
        bus.emit('ui:notification', { text: 'Будувати можна лише у своїй зоні!', type: 'warning' });
        return;
      }
    }

    // Перевірка колізії з іншими будівлями
    if (!this.state.canPlace(tileX, tileY, def.size.w, def.size.h)) {
      bus.emit('ui:notification', { text: 'Місце зайняте!', type: 'error' });
      return;
    }

    const cost = def.cost.gold ?? 0;
    if (!this.state.spendGold(cost)) {
      bus.emit('ui:notification', { text: 'Недостатньо золота!', type: 'error' });
      return;
    }

    const { Building } = this._getClasses();
    const b = new Building(def, tileX, tileY, 'player');
    this.state.addBuilding(b, 'player');

    bus.emit('ui:notification', { text: `Будівництво: ${def.name}`, type: 'info' });
  }

  /**
   * @param {{ unitDefId: string, buildingId: string }} payload
   */
  _onTrainUnit({ unitDefId, buildingId }) {
    const unitDef = this.defs.units[unitDefId];
    if (!unitDef) return;

    if (this.state.armySize >= this.state.maxArmySize) {
      bus.emit('ui:notification', { text: 'Армія повна!', type: 'warning' });
      return;
    }

    const cost = unitDef.cost.gold ?? 0;
    if (!this.state.spendGold(cost)) {
      bus.emit('ui:notification', { text: 'Недостатньо золота!', type: 'error' });
      return;
    }

    const building = this.state.playerBuildings.get(buildingId);
    if (!building?.isReady) {
      this.state.spendGold(-cost); // повернути золото
      return;
    }

    building.enqueueUnit(unitDefId, unitDef.trainTimeSec);
    bus.emit('ui:notification', { text: `Тренування: ${unitDef.name}`, type: 'info' });
  }

  /**
   * @param {{ buildingId: string }} payload
   */
  _onUpgradeBuilding({ buildingId }) {
    const building = this.state.playerBuildings.get(buildingId);
    if (!building?.isReady) return;

    const upgradeId = building.def.upgrades?.[0];
    if (!upgradeId) {
      bus.emit('ui:notification', { text: 'Немає покращень', type: 'info' });
      return;
    }

    const upgradeDef = this.defs.buildings[upgradeId];
    if (!upgradeDef) return;

    if (!this.state.spendGold(upgradeDef.cost.gold)) {
      bus.emit('ui:notification', { text: 'Недостатньо золота!', type: 'error' });
      return;
    }

    // Замінити будівлю на покращену версію
    this.state.removeBuilding(buildingId, 'player');
    const { Building } = this._getClasses();
    const upgraded = new Building(upgradeDef, building.tileX, building.tileY, 'player');
    upgraded.status        = 'building'; // треба перебудувати
    upgraded.buildProgress = 0;
    this.state.addBuilding(upgraded, 'player');

    bus.emit('ui:notification', { text: `Покращення до: ${upgradeDef.name}`, type: 'success' });
  }

  /**
   * @param {{ buildingId: string }} payload
   */
  _onDemolishBuilding({ buildingId }) {
    const building = this.state.playerBuildings.get(buildingId);
    if (!building) return;

    if (building.def.id === 'headquarters') {
      bus.emit('ui:notification', { text: 'Штаб не можна знести', type: 'warning' });
      return;
    }

    const refundBase = building.def.cost?.gold ?? 0;
    const refundRatio = building.isReady ? 0.35 : 0.2;
    const refund = Math.max(0, Math.round(refundBase * refundRatio));

    this.state.removeBuilding(buildingId, 'player');
    if (refund > 0) this.state.addGold(refund);

    bus.emit('ui:notification', {
      text: refund > 0
        ? `Споруду знесено. Повернуто ${refund} золота`
        : 'Споруду знесено',
      type: 'warning',
    });
  }

  // Lazy import щоб уникнути циклічних залежностей
  _getClasses() {
    return {
      Building: globalThis.__BUILDING_CLASS__,
    };
  }
}

import { bus } from '../core/EventBus.js';

/**
 * AIController — rule-based ШІ для ворожої сторони.
 *
 * Тепер ШІ:
 *   • оцінює поточний стан карти, а не веде крихкі лічильники
 *   • шукає осмислені місця під будівлі
 *   • вміє зносити свої пошкоджені / зайві споруди
 *   • підбирає хвилі атаки та склад армії залежно від ситуації
 */
export class AIController {
  /**
   * @param {import('../state/GameState.js').GameState} state
   * @param {Object} entitiesDef
   * @param {Object} config
   */
  constructor(state, entitiesDef, config) {
    this.state = state;
    this.defs  = entitiesDef;
    this.cfg   = config;

    this.baseStorageCap = config.economy.baseStorageCap;
    this.gold           = config.economy.startingGold;
    this.storageCap     = this.baseStorageCap;

    this._decisionTimer    = 0;
    this._waveTimer        = 0;
    this._decisionInterval = this._difficultyFactor() * config.ai.decisionIntervalSec;
    this._waveInterval     = this._getWaveInterval();

    const zones = config.map.zones;
    this._zone = zones.enemy;

    /** @type {'balanced'|'rush'|'siege'|'harass'} */
    this.currentStrategy = 'balanced';
  }

  update(dtSec) {
    this._recalculateStorage();
    this._updateEconomy(dtSec);

    this._decisionTimer += dtSec;
    if (this._decisionTimer >= this._decisionInterval) {
      this._decisionTimer -= this._decisionInterval;
      this._makeDecision();
    }

    this._waveTimer += dtSec;
    if (this._shouldLaunchWave()) {
      this._waveTimer = 0;
      this._sendWave();
    }
  }

  // ─────────────────────────────────────────────
  //  Економіка ШІ
  // ─────────────────────────────────────────────

  _updateEconomy(dtSec) {
    for (const [, b] of this.state.enemyBuildings) {
      if (!b.isReady || b.isDestroyed) continue;

      if (b.def.production) {
        b._productionTimer += dtSec;
        if (b._productionTimer >= b.def.production.intervalSec) {
          b._productionTimer -= b.def.production.intervalSec;
          this.gold = Math.min(this.gold + b.def.production.amount, this.storageCap);
        }
      }

      const readyUnit = b.tickTraining(dtSec);
      if (readyUnit) {
        bus.emit('cmd:spawnUnit', {
          unitDefId: readyUnit,
          tileX: b.tileX + Math.floor(b.def.size.w / 2),
          tileY: b.tileY + b.def.size.h,
          team: 'enemy',
        });
      }
    }
  }

  _recalculateStorage() {
    let storage = this.baseStorageCap;
    for (const [, b] of this.state.enemyBuildings) {
      if (b.isReady && !b.isDestroyed && b.def.storage) {
        storage += b.def.storage.capacity;
      }
    }
    this.storageCap = storage;
    this.gold = Math.min(this.gold, this.storageCap);
  }

  // ─────────────────────────────────────────────
  //  Рішення
  // ─────────────────────────────────────────────

  _makeDecision() {
    if (this.state.phase !== 'playing') return;

    if (this._cleanupWeakBuildings()) return;

    this._updateStrategy();

    const desired = this._getDesiredCounts();
    const buildQueue = [
      [{ build: 'gold_mine', countAs: ['gold_mine', 'gold_mine_lvl2'] }, desired.goldMines],
      [{ build: 'treasury', countAs: ['treasury', 'treasury_lvl2'] }, desired.treasuries],
      [{ build: desired.hasBarracksLvl2 ? 'barracks_lvl2' : 'barracks', countAs: ['barracks', 'barracks_lvl2'] }, desired.barracks],
      [{ build: desired.hasCannonTowers ? 'cannon_tower' : 'tower', countAs: ['tower', 'cannon_tower'] }, desired.towers],
      [{ build: desired.hasReinforcedWalls ? 'reinforced_wall' : 'wall', countAs: ['wall', 'reinforced_wall'] }, desired.walls],
    ];

    for (const [entry, wanted] of buildQueue) {
      if (this._countBuildings(entry.countAs) >= wanted) continue;
      if (!this._canBuild(entry.build)) continue;
      if (this._build(entry.build)) return;
    }

    this._trainUnits();
  }

  _getDesiredCounts() {
    const playerBuildings = this.state.playerBuildings.size;
    const playerArmy      = this.state.playerUnits.size;
    const enemyArmy       = this.state.enemyUnits.size;
    const hardMode        = this.cfg.ai.difficulty === 'hard';

    return {
      goldMines: Math.min(5, playerBuildings >= 6 ? 4 : 3),
      treasuries: playerBuildings >= 7 || hardMode ? 2 : 1,
      barracks: this.currentStrategy === 'defensive' ? 2 : (playerArmy >= 5 || hardMode ? 2 : 1),
      towers: this.currentStrategy === 'defensive' ? 4 : (playerArmy >= 6 ? 3 : 2),
      walls: this.currentStrategy === 'defensive' ? 8 : Math.min(6, 2 + Math.floor(playerArmy / 3)),
      hasBarracksLvl2: playerBuildings >= 6 || enemyArmy >= 5 || this.currentStrategy === 'siege',
      hasCannonTowers: playerArmy >= 8 || hardMode || this.currentStrategy === 'defensive',
      hasReinforcedWalls: playerArmy >= 7 || this.currentStrategy === 'defensive',
    };
  }

  _updateStrategy() {
    // Оцінка бази гравця
    const pBuildings = [...this.state.playerBuildings.values()].filter(b => !b.isDestroyed);
    const pArmyCount = this.state.playerUnits.size;
    const eArmyCount = this.state.enemyUnits.size;

    let towers = 0;
    let walls = 0;
    let economy = 0;
    let military = 0;

    for (const b of pBuildings) {
      if (b.def.category === 'defense') {
        if (b.def.id.includes('wall')) walls++;
        else towers++;
      }
      if (b.def.category === 'economy' && b.def.id !== 'headquarters') economy++;
      if (b.def.category === 'military') military++;
    }

    let pRanged = 0;
    let pMelee = 0;
    for (const [, u] of this.state.playerUnits) {
      if (u.def.category === 'ranged') pRanged++;
      else pMelee++;
    }
    this.playerStats = { towers, walls, economy, military, pRanged, pMelee };

    if (towers >= 2 || walls >= 3) {
      this.currentStrategy = 'siege';
    } else if (economy >= 3 && military < 2) {
      this.currentStrategy = 'harass';
    } else if (military >= 2 && pArmyCount > eArmyCount) {
      this.currentStrategy = 'defensive';
    } else if (pArmyCount <= 3 && pBuildings.length <= 4) {
      this.currentStrategy = 'rush';
    } else {
      this.currentStrategy = 'balanced';
    }

    // Для легкого рівня складності граємо простіше
    if (this.cfg.ai.difficulty === 'easy' && this.currentStrategy !== 'rush') {
      this.currentStrategy = 'balanced';
    }
  }

  _canBuild(defId) {
    const def = this.defs.buildings[defId];
    if (!def) return false;

    const requires = def.unlockRequires;
    if (requires && this._countBuildings(requires) === 0) return false;

    return this.gold >= (def.cost?.gold ?? 0);
  }

  _build(defId) {
    const def = this.defs.buildings[defId];
    if (!def) return false;

    const spot = this._findBuildSpot(def);
    if (!spot) {
      return this._demolishForSpace(def);
    }

    this.gold -= def.cost.gold ?? 0;
    bus.emit('cmd:aiPlaceBuilding', { defId, tileX: spot.tileX, tileY: spot.tileY });
    return true;
  }

  _findBuildSpot(def) {
    const candidates = [];
    const hq = this._getEnemyHQ();
    const centerX = hq ? hq.tileX + hq.def.size.w / 2 : this.state.mapCols / 2;
    const bridgeY = Math.floor((this.cfg.map.zones.neutral.startRow + this.cfg.map.zones.neutral.endRow) / 2);

    for (let tileY = this._zone.startRow + 1; tileY <= this._zone.endRow - def.size.h; tileY++) {
      for (let tileX = 2; tileX <= this.state.mapCols - def.size.w - 2; tileX++) {
        if (!this.state.canPlace(tileX, tileY, def.size.w, def.size.h)) continue;

        const centerTileX = tileX + def.size.w / 2;
        const centerTileY = tileY + def.size.h / 2;
        const distToHQ = Math.abs(centerTileX - centerX) + Math.abs(centerTileY - (hq?.tileY ?? 3));
        const distToFront = Math.abs(centerTileY - (this._zone.endRow - 1));
        const distToBridge = Math.abs(centerTileY - bridgeY) + Math.abs(centerTileX - this.state.mapCols / 2);

        let score = 0;
        switch (def.category) {
          case 'economy':
            score = 100 - distToHQ * 4 - distToFront * 3;
            break;
          case 'military':
            score = 100 - distToFront * 5 - distToHQ * 2;
            break;
          case 'defense':
            score = 120 - distToBridge * 6 - distToHQ;
            if (def.id.includes('wall')) score += 12;
            break;
          default:
            score = 50 - distToHQ;
        }

        candidates.push({ tileX, tileY, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] ?? null;
  }

  _demolishForSpace(def) {
    const fallback = [...this.state.enemyBuildings.values()]
      .filter((b) =>
        !b.isDestroyed &&
        b.isReady &&
        b.def.id !== 'headquarters' &&
        (b.def.id === 'wall' || b.def.id === 'reinforced_wall' || b.hp / b.maxHp < 0.35)
      )
      .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];

    if (!fallback) return false;
    this.state.removeBuilding(fallback.id, 'enemy');
    return true;
  }

  _cleanupWeakBuildings() {
    const weak = [...this.state.enemyBuildings.values()]
      .filter((b) =>
        !b.isDestroyed &&
        b.isReady &&
        b.def.id !== 'headquarters' &&
        b.trainingQueue.length === 0 &&
        (
          b.hp / b.maxHp < 0.22 ||
          (this._isWall(b) && this._countBuildings(['wall', 'reinforced_wall']) > 5 && b.hp / b.maxHp < 0.6)
        )
      )
      .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];

    if (!weak) return false;
    this.state.removeBuilding(weak.id, 'enemy');
    return true;
  }

  // ─────────────────────────────────────────────
  //  Армія та хвилі
  // ─────────────────────────────────────────────

  _trainUnits() {
    const barracks = [...this.state.enemyBuildings.values()]
      .filter((b) =>
        !b.isDestroyed &&
        b.isReady &&
        (b.def.id === 'barracks' || b.def.id === 'barracks_lvl2') &&
        b.trainingQueue.length < this._maxQueuePerBarracks()
      )
      .sort((a, b) => a.trainingQueue.length - b.trainingQueue.length);

    for (const barracksBuilding of barracks) {
      const unitId = this._chooseBestUnit(barracksBuilding);
      if (!unitId) continue;
      const unitDef = this.defs.units[unitId];
      if (!unitDef || this.gold < unitDef.cost.gold) continue;

      this.gold -= unitDef.cost.gold;
      barracksBuilding.enqueueUnit(unitId, unitDef.trainTimeSec);
    }
  }

  _chooseBestUnit(barracksBuilding) {
    const playerArmy = this.state.playerUnits.size;
    const enemyArmy  = this.state.enemyUnits.size;
    const canSiege   = barracksBuilding.def.id === 'barracks_lvl2';
    const stats      = this.playerStats || { pRanged: 0, pMelee: 0 };

    // Контр-юніти на основі армії гравця
    if (stats.pRanged > stats.pMelee && this.gold >= this.defs.units.knight.cost.gold) {
      if (Math.random() < 0.6) return 'knight'; // Танкуємо лучників
    }
    if (stats.pMelee > stats.pRanged + 2) {
      if (Math.random() < 0.6) return 'archer'; // Кайтимо мілішників
    }

    // Вплив поточної стратегії на тренування
    if (this.currentStrategy === 'siege' && canSiege && this.gold >= this.defs.units.catapult.cost.gold) {
      if (Math.random() < 0.7) return 'catapult';
    }
    
    if (this.currentStrategy === 'harass' && this.gold >= this.defs.units.knight.cost.gold) {
      return 'knight';
    }

    if (this.currentStrategy === 'rush') {
      return 'warrior'; // Дешевий зерг-раш
    }
    
    if (this.currentStrategy === 'defensive') {
      return Math.random() < 0.7 ? 'archer' : 'knight'; // Захищаємось за стінами
    }

    // Збалансований підхід
    if (playerArmy > enemyArmy + 2 && this.gold >= this.defs.units.knight.cost.gold) {
      return 'knight';
    }
    if (enemyArmy <= playerArmy) {
      return Math.random() < 0.55 ? 'archer' : 'warrior';
    }
    return Math.random() < 0.6 ? 'warrior' : 'archer';
  }

  _shouldLaunchWave() {
    const units = [...this.state.enemyUnits.values()].filter((u) => !u.isDead);
    const threshold = this._attackThreshold();

    if (units.length >= threshold && this._waveTimer >= this._waveInterval * 0.55) return true;
    if (this._waveTimer >= this._waveInterval && units.length >= Math.max(2, threshold - 1)) return true;
    return false;
  }

  _sendWave() {
    const units = [...this.state.enemyUnits.values()].filter((u) => !u.isDead);
    if (units.length === 0) return;

    // Визначити ціль на основі стратегії
    let target = null;
    const pBuildings = [...this.state.playerBuildings.values()].filter(b => !b.isDestroyed);
    
    if (this.currentStrategy === 'siege') {
      target = pBuildings.find(b => b.def.category === 'defense');
    } else if (this.currentStrategy === 'harass') {
      target = pBuildings.find(b => b.def.category === 'economy');
    }

    // Fallback якщо ціль стратегії зникла
    if (!target) {
      target = pBuildings.find(b => b.def.id === 'headquarters');
    }

    if (!target) return;

    const attackCount = Math.min(units.length, Math.max(this._attackThreshold(), Math.ceil(units.length * 0.8)));
    const tagLines = {
      'siege': 'Облога',
      'harass': 'Рейд на економіку',
      'rush': 'Швидка атака',
      'balanced': 'Атака'
    };

    for (const u of units.slice(0, attackCount)) {
      u.targetId   = target.id;
      u.targetTeam = 'player';
      u.moveTarget = null;
      u.setPath([]);
    }

    bus.emit('ai:waveStarted', { unitCount: attackCount, type: tagLines[this.currentStrategy] });
  }

  _attackThreshold() {
    const d = this.cfg.ai.difficulty;
    return d === 'easy' ? 3 : d === 'hard' ? 6 : 4;
  }

  _maxQueuePerBarracks() {
    const d = this.cfg.ai.difficulty;
    return d === 'hard' ? 4 : 3;
  }

  _getWaveInterval() {
    const d = this.cfg.ai.difficulty;
    return d === 'easy' ? 70 : d === 'hard' ? 40 : 55;
  }

  // ─────────────────────────────────────────────
  //  Утиліти
  // ─────────────────────────────────────────────

  _countBuildings(defIds) {
    const ids = Array.isArray(defIds) ? defIds : [defIds];
    return [...this.state.enemyBuildings.values()].filter(
      (b) => !b.isDestroyed && b.isReady && ids.includes(b.def.id)
    ).length;
  }

  _getEnemyHQ() {
    return [...this.state.enemyBuildings.values()].find((b) => b.def.id === 'headquarters') ?? null;
  }

  _isWall(building) {
    return building.def.id === 'wall' || building.def.id === 'reinforced_wall';
  }

  _difficultyFactor() {
    const d = this.cfg.ai.difficulty;
    return d === 'easy' ? 1.7 : d === 'hard' ? 0.7 : 1;
  }
}

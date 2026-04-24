import { bus } from '../core/EventBus.js';
import { Unit } from '../entities/Unit.js';

/**
 * CombatSystem — вся бойова логіка гри.
 *
 * Відповідальність:
 *   • Знаходити цілі для юнітів (aggro)
 *   • Керувати FSM юнітів (idle → moving → attacking)
 *   • Застосовувати пошкодження до юнітів та будівель
 *   • Рухати снаряди (дальній бій)
 *   • Спавнити юнітів при команді
 */
export class CombatSystem {
  /**
   * @param {import('../state/GameState.js').GameState} state
   * @param {import('../pathfinding/Pathfinder.js').Pathfinder} pathfinder
   * @param {Object} entitiesDef
   * @param {Object} gameConfig
   */
  constructor(state, pathfinder, entitiesDef, gameConfig) {
    this.state      = state;
    this.pathfinder = pathfinder;
    this.defs       = entitiesDef;
    this.cfg        = gameConfig;

    this.tileSize   = gameConfig.map.tileSize;
    this.aggroRange = gameConfig.combat.unitAggroRangeTiles * this.tileSize;
    this.projSpeed  = gameConfig.combat.projectileSpeedPxSec;

    // Слухаємо команди
    bus.on('cmd:spawnUnit',      this._onSpawnUnit.bind(this));
    bus.on('cmd:attackOrder',    this._onAttackOrder.bind(this));
    // cmd:moveOrder релеється Game.js як combat:moveOrder
    bus.on('combat:moveOrder',   this._onMoveOrder.bind(this));
  }

  // ─────────────────────────────────────────────
  //  Головне оновлення
  // ─────────────────────────────────────────────

  update(dtSec) {
    this._updateUnits('player', 'enemy', dtSec);
    this._updateUnits('enemy', 'player', dtSec);
    this._updateTowers('player', 'enemy', dtSec);
    this._updateTowers('enemy', 'player', dtSec);
    this._updateProjectiles(dtSec);
  }

  // ─────────────────────────────────────────────
  //  Юніти
  // ─────────────────────────────────────────────

  _updateUnits(myTeam, theirTeam, dtSec) {
    const myUnits     = myTeam === 'player' ? this.state.playerUnits     : this.state.enemyUnits;
    const theirUnits  = myTeam === 'player' ? this.state.enemyUnits      : this.state.playerUnits;
    const theirBuilds = myTeam === 'player' ? this.state.enemyBuildings  : this.state.playerBuildings;

    for (const [id, unit] of myUnits) {
      if (unit.isDead) { this.state.removeUnit(id, myTeam); continue; }

      switch (unit.state) {
        case 'idle':
          this._tryAggro(unit, theirUnits, theirBuilds);
          break;

        case 'moving':
          this._doMove(unit, theirUnits, theirBuilds, dtSec);
          break;

        case 'attacking':
          this._doAttack(unit, theirUnits, theirBuilds, myTeam, theirTeam, dtSec);
          break;

        case 'returning':
          // Повернення на базу (спрощено — скидаємо в idle)
          unit.state = 'idle';
          break;
      }
    }

    // Алгоритм розштовхування юнітів (Separation / Boids),
    // щоб вони не злипалися в одну точку під час руху чи бою.
    this._applySeparation(myUnits, dtSec);
  }

  _applySeparation(units, dtSec) {
    const list = [...units.values()].filter(u => !u.isDead && u.state !== 'returning');
    const sepRadius = this.tileSize * 0.65; // Радіус комфортної зони
    const pushForce = this.tileSize * 1.5;  // Сила відштовхування

    for (let i = 0; i < list.length; i++) {
      const u1 = list[i];
      let fx = 0, fy = 0;
      for (let j = i + 1; j < list.length; j++) {
        const u2 = list[j];
        const dx = u1.x - u2.x;
        const dy = u1.y - u2.y;
        const dist = Math.hypot(dx, dy) || 0.1;

        if (dist < sepRadius) {
          const force = ((sepRadius - dist) / sepRadius) * pushForce;
          const pushX = (dx / dist) * force * dtSec;
          const pushY = (dy / dist) * force * dtSec;
          
          u1.x += pushX; u1.y += pushY;
          u2.x -= pushX; u2.y -= pushY;
        }
      }
    }
  }

  /** Aggro: якщо ворог в радіусі — встановити ціль і перейти в attacking або moving. */
  _tryAggro(unit, theirUnits, theirBuilds) {
    const target = this._findNearestTarget(unit, theirUnits, theirBuilds);
    if (!target) return;

    const targetPos = this._getTargetPos(target);
    unit.targetId   = target.id;
    unit.targetTeam = target.team;

    if (unit.isInRange(targetPos, this.tileSize)) {
      unit.state = 'attacking';
    } else {
      this._moveTo(unit, targetPos);
    }
  }

  _doMove(unit, theirUnits, theirBuilds, dtSec) {
    const target = unit.targetId
      ? this._resolveTarget(unit, theirUnits, theirBuilds)
      : null;

    if (unit.targetId && !target) {
      this._stopUnit(unit);
      return;
    }

    const targetPos = target
      ? this._getTargetPos(target)
      : unit.moveTarget;

    if (!targetPos) {
      this._stopUnit(unit);
      return;
    }

    if (target && unit.isInRange(targetPos, this.tileSize)) {
      unit.moveTarget = null;
      unit.state = 'attacking';
      return;
    }

    const arrived = unit.move(dtSec, this.tileSize);
    if (arrived) {
      if (target) {
        // Перерахувати шлях (ціль могла переміститись)
        this._moveTo(unit, targetPos);
      } else {
        this._stopUnit(unit);
      }
    }
  }

  _doAttack(unit, theirUnits, theirBuilds, myTeam, theirTeam, dtSec) {
    const target = this._resolveTarget(unit, theirUnits, theirBuilds);
    if (!target) {
      unit.state    = 'idle';
      unit.targetId = null;
      return;
    }

    const targetPos = this._getTargetPos(target);

    if (!unit.isInRange(targetPos, this.tileSize)) {
      this._moveTo(unit, targetPos);
      return;
    }

    const fired = unit.tickAttack(dtSec);
    if (!fired) return;

    const combat = unit.def.combat;
    const isRanged = combat.attackRangeTiles > 1;
    const dmg = unit.calcDamage(target.type ?? 'unit');

    if (isRanged && combat.projectile) {
      // Снаряд
      this.state.addProjectile({
        id:       `proj_${Date.now()}`,
        x:        unit.x,
        y:        unit.y,
        targetId: target.id,
        targetTeam: theirTeam,
        damage:   dmg,
        dmgType:  combat.damageType ?? 'physical',
        sprite:   combat.projectile,
        speed:    this.projSpeed,
      });
    } else {
      // Миттєва атака
      this._applyDamage(target, dmg, combat.damageType ?? 'physical', theirTeam, theirUnits, theirBuilds);
    }
  }

  // ─────────────────────────────────────────────
  //  Вежі
  // ─────────────────────────────────────────────

  _updateTowers(myTeam, theirTeam, dtSec) {
    const myBuilds   = myTeam === 'player' ? this.state.playerBuildings : this.state.enemyBuildings;
    const theirUnits = myTeam === 'player' ? this.state.enemyUnits      : this.state.playerUnits;
    const theirBuilds= myTeam === 'player' ? this.state.enemyBuildings  : this.state.playerBuildings;

    for (const [, building] of myBuilds) {
      if (!building.isReady || !building.def.combat) continue;

      building._attackTimer += dtSec * 1000;
      if (building._attackTimer < building.def.combat.attackSpeedMs) continue;

      const rangePx = building.def.combat.attackRangeTiles * this.tileSize;
      const center  = {
        x: (building.tileX + building.def.size.w / 2) * this.tileSize,
        y: (building.tileY + building.def.size.h / 2) * this.tileSize,
      };

      // Знайти першого ворожого юніта в радіусі
      let nearest = null, nearestDist = Infinity;
      for (const [, u] of theirUnits) {
        if (u.isDead) continue;
        const d = Math.hypot(u.x - center.x, u.y - center.y);
        if (d <= rangePx && d < nearestDist) { nearest = u; nearestDist = d; }
      }

      if (!nearest) continue;

      building._attackTimer -= building.def.combat.attackSpeedMs;

      if (building.def.combat.projectile) {
        this.state.addProjectile({
          id:       `tproj_${Date.now()}`,
          x:        center.x, y: center.y,
          targetId: nearest.id,
          targetTeam: theirTeam,
          damage:   building.def.combat.attackDamage,
          dmgType:  'physical',
          splash:   building.def.combat.splashRadius ?? 0,
          sprite:   building.def.combat.projectile,
          speed:    this.projSpeed,
        });
      } else {
        nearest.takeDamage(building.def.combat.attackDamage);
        if (nearest.isDead) this.state.removeUnit(nearest.id, theirTeam);
      }
    }
  }

  // ─────────────────────────────────────────────
  //  Снаряди
  // ─────────────────────────────────────────────

  _updateProjectiles(dtSec) {
    for (const proj of this.state.projectiles) {
      const theirUnits = proj.targetTeam === 'enemy'
        ? this.state.enemyUnits : this.state.playerUnits;
      const theirBuilds = proj.targetTeam === 'enemy'
        ? this.state.enemyBuildings : this.state.playerBuildings;

      const target = theirUnits.get(proj.targetId) ?? theirBuilds.get(proj.targetId);
      if (!target) { this.state.removeProjectile(proj); continue; }

      const tx = target.x ?? (target.tileX * this.tileSize);
      const ty = target.y ?? (target.tileY * this.tileSize);
      const dx = tx - proj.x, dy = ty - proj.y;
      const dist = Math.hypot(dx, dy);
      const step = proj.speed * dtSec;

      if (step >= dist) {
        // Влучання
        this._applyDamage(
          target, proj.damage, proj.dmgType ?? 'physical',
          proj.targetTeam, theirUnits, theirBuilds
        );
        if (proj.splash && proj.splash > 0) {
          this._applySplash(proj, tx, ty, theirUnits, theirBuilds, proj.targetTeam);
        }
        this.state.removeProjectile(proj);
      } else {
        proj.x += (dx / dist) * step;
        proj.y += (dy / dist) * step;
      }
    }
  }

  _applySplash(proj, cx, cy, theirUnits, theirBuilds, theirTeam) {
    const rangePx = proj.splash * this.tileSize;
    for (const [, u] of theirUnits) {
      if (u.isDead) continue;
      if (Math.hypot(u.x - cx, u.y - cy) <= rangePx) {
        if (u.takeDamage(Math.round(proj.damage * 0.5), proj.dmgType)) {
          this.state.removeUnit(u.id, theirTeam);
        }
      }
    }
  }

  // ─────────────────────────────────────────────
  //  Утиліти
  // ─────────────────────────────────────────────

  _applyDamage(target, dmg, dmgType, theirTeam, theirUnits, theirBuilds) {
    const isUnit = theirUnits?.has(target.id);
    if (isUnit) {
      if (target.takeDamage(dmg, dmgType)) {
        this.state.removeUnit(target.id, theirTeam);
      }
    } else {
      if (target.takeDamage(dmg)) {
        this.state.removeBuilding(target.id, theirTeam);
      }
    }
  }

  _findNearestTarget(unit, theirUnits, theirBuilds) {
    let best = null, bestDist = this.aggroRange;

    for (const [, t] of theirUnits) {
      if (t.isDead) continue;
      const d = Math.hypot(t.x - unit.x, t.y - unit.y);
      if (d < bestDist) { best = t; bestDist = d; }
    }

    if (!best) {
      for (const [, b] of theirBuilds) {
        if (b.isDestroyed) continue;
        const bx = (b.tileX + b.def.size.w / 2) * this.tileSize;
        const by = (b.tileY + b.def.size.h / 2) * this.tileSize;
        const d  = Math.hypot(bx - unit.x, by - unit.y);
        if (d < bestDist || !best) { best = b; bestDist = d; }
      }
    }
    return best;
  }

  _resolveTarget(unit, theirUnits, theirBuilds) {
    return theirUnits.get(unit.targetId) ?? theirBuilds.get(unit.targetId) ?? null;
  }

  _getTargetPos(target) {
    if (target.x !== undefined) return { x: target.x, y: target.y };
    return {
      x: (target.tileX + target.def.size.w / 2) * this.tileSize,
      y: (target.tileY + target.def.size.h / 2) * this.tileSize,
    };
  }

  _moveTo(unit, targetPos) {
    const startTX = Math.floor(unit.x / this.tileSize);
    const startTY = Math.floor(unit.y / this.tileSize);
    const endTX   = Math.floor(targetPos.x / this.tileSize);
    const endTY   = Math.floor(targetPos.y / this.tileSize);

    const path = this._findPathForUnit(unit.team, startTX, startTY, endTX, endTY);
    if (path.length > 0) {
      unit.setPath(path, { x: targetPos.x, y: targetPos.y });
    } else {
      this._stopUnit(unit);
    }
  }

  _stopUnit(unit) {
    unit.state = 'idle';
    unit.path = [];
    unit._pathIndex = 0;
    unit.moveTarget = null;
    unit.prevX = unit.x;
    unit.prevY = unit.y;
  }

  _findPathForUnit(team, startTX, startTY, endTX, endTY) {
    const canTraverse = (x, y) => this._canUnitTraverseTile(team, x, y);
    const directPath = this.pathfinder.findPath(startTX, startTY, endTX, endTY, { canTraverse });
    if (directPath.length > 0) return directPath;

    const maxRadius = 6;
    for (let radius = 1; radius <= maxRadius; radius++) {
      const candidates = [];
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          candidates.push({ x: endTX + dx, y: endTY + dy });
        }
      }

      candidates.sort((a, b) =>
        Math.hypot(a.x - endTX, a.y - endTY) - Math.hypot(b.x - endTX, b.y - endTY)
      );

      for (const candidate of candidates) {
        const path = this.pathfinder.findPath(
          startTX,
          startTY,
          candidate.x,
          candidate.y,
          { canTraverse }
        );
        if (path.length > 0) return path;
      }
    }

    return [];
  }

  _canUnitTraverseTile(team, tileX, tileY) {
    const building = this._getBuildingAt(tileX, tileY);
    if (!building) return false;
    return building.team === team;
  }

  _getBuildingAt(tileX, tileY) {
    const buildings = [
      ...this.state.playerBuildings.values(),
      ...this.state.enemyBuildings.values(),
    ];

    return buildings.find((b) =>
      !b.isDestroyed &&
      tileX >= b.tileX && tileX < b.tileX + b.def.size.w &&
      tileY >= b.tileY && tileY < b.tileY + b.def.size.h
    ) ?? null;
  }

  // ─────────────────────────────────────────────
  //  Команди
  // ─────────────────────────────────────────────

  _onSpawnUnit({ unitDefId, tileX, tileY, team }) {
    const def = this.defs.units[unitDefId];
    if (!def) return;
    const u = new Unit(def,
      tileX * this.tileSize + this.tileSize / 2,
      tileY * this.tileSize + this.tileSize / 2,
      team
    );
    this.state.addUnit(u, team);
  }

  _onAttackOrder({ unitIds }) {
    const teamUnits = this.state.playerUnits;
    const ids = unitIds && unitIds.length > 0 ? unitIds : [...teamUnits.keys()];
    
    // Пряма атака на вказану ціль (тап по ворогу)
    if (targetId) {
      for (const id of ids) {
        const u = teamUnits.get(id);
        if (!u || u.isDead) continue;
        
        u.isOrdered = true;
        u.targetId = targetId;
        u.targetTeam = targetTeam;
        
        // Знайти ціль і рушити до неї
        const t = this.state.enemyBuildings.get(targetId) ?? this.state.enemyUnits.get(targetId);
        if (t) {
          this._moveTo(u, this._getTargetPos(t));
        }
      }
      return;
    }

    // Регулярна загальна атака
    const enemyTargets = [
      ...this.state.enemyBuildings.values(),
      ...this.state.enemyUnits.values(),
    ].filter(t => !t.isDead && !t.isDestroyed);

    for (const id of ids) {
      const u = teamUnits.get(id);
      if (!u || u.isDead) continue;

      u.isOrdered = true;

      // Знайти найближчу ціль замість просто idle
      if (enemyTargets.length > 0) {
        let nearest = null, bestDist = Infinity;
        for (const t of enemyTargets) {
          const tx = t.x ?? (t.tileX + t.def.size.w / 2) * this.tileSize;
          const ty = t.y ?? (t.tileY + t.def.size.h / 2) * this.tileSize;
          const d  = Math.hypot(tx - u.x, ty - u.y);
          if (d < bestDist) { bestDist = d; nearest = t; u.targetId = t.id; }
        }
        if (nearest) {
          const tx = nearest.x ?? (nearest.tileX + nearest.def.size.w / 2) * this.tileSize;
          const ty = nearest.y ?? (nearest.tileY + nearest.def.size.h / 2) * this.tileSize;
          this._moveTo(u, { x: tx, y: ty });
        }
      } else {
        u.state = 'idle'; // aggro сам знайде
      }
    }
  }

  _onMoveOrder({ tileX, tileY, unitIds }) {
    const ids = unitIds && unitIds.length > 0
      ? unitIds
      : [...this.state.playerUnits.keys()];

    const targetX = tileX * this.tileSize + this.tileSize / 2;
    const targetY = tileY * this.tileSize + this.tileSize / 2;

    // Розставити юнітів у вее-формації навколо цільової точки
    const spread = this.tileSize * 1.2;
    let idx = 0;
    for (const id of ids) {
      const u = this.state.playerUnits.get(id);
      if (!u || u.isDead) continue;
      u.targetId  = null;
      u.isOrdered = true;
      u.state     = 'idle'; // зновов

      // Офсет у спіральній мережі
      const angle  = (idx / Math.max(ids.length, 1)) * Math.PI * 2;
      const radius = Math.floor(idx / 6) * spread + (idx > 0 ? spread * 0.8 : 0);
      const offsetX = Math.cos(angle) * radius;
      const offsetY = Math.sin(angle) * radius;

      this._moveTo(u, { x: targetX + offsetX, y: targetY + offsetY });
      idx++;
    }
  }
}

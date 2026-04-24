import { bus } from '../core/EventBus.js';

/**
 * UIManager v2 — повністю переписаний UI з чітким контролем юнітів.
 *
 * РЕЖИМИ (inputMode):
 *   'idle'   — нічого не вибрано, тап = вибрати будівлю / юніта
 *   'build'  — режим будівництва, тап на карту = розмістити будівлю
 *   'move'   — режим переміщення, тап на карту = наказ рухатись
 *   'attack' — юніти йдуть атакувати ціль
 *
 * ВКЛАДКИ ПАНЕЛІ:
 *   'build' — список будівель (економіка / військові / захист)
 *   'army'  — управління юнітами + кнопки команд
 */
export class UIManager {
  constructor(entitiesDef, state, renderer, config = {}) {
    this.defs     = entitiesDef;
    this.state    = state;
    this.renderer = renderer;
    this.instantBuild = config.instantBuild ?? true;

    // ── UI стан ────────────────────────────────────
    /** @type {'idle'|'build'|'move'} */
    this._inputMode      = 'idle';
    this._buildDefId     = null;        // який тип будівлі ставимо
    this._previewBuildTile = null;      // Кеш координат для другого тапу
    this._activeTab      = 'build';

    /** @type {Set<string>} */
    this._selectedUnitIds = new Set();  // вибрані юніти

    // ── Кешування DOM ──────────────────────────────
    this.$goldVal    = document.getElementById('hud-gold-val');
    this.$goldCap    = document.getElementById('hud-gold-cap');
    this.$goldBar    = document.getElementById('hud-gold-bar');
    this.$armyVal    = document.getElementById('hud-army-val');
    this.$armyCap    = document.getElementById('hud-army-cap');
    this.$armyBar    = document.getElementById('hud-army-bar');
    this.$fps        = document.getElementById('hud-fps');
    this.$phase      = document.getElementById('hud-phase');
    this.$notify     = document.getElementById('notify-area');
    this.$modal      = document.getElementById('modal-overlay');
    this.$modalBody  = document.getElementById('modal-body');
    this.$panel      = document.getElementById('bottom-panel');
    this.$tabBuild   = document.getElementById('tab-build');
    this.$tabArmy    = document.getElementById('tab-army');
    this.$buildGrid  = document.getElementById('build-grid');
    this.$armyGrid   = document.getElementById('army-grid');
    this.$canvas     = document.getElementById('entity-canvas');
    this.$modeBar    = document.getElementById('mode-bar');
    this.$modeLabel  = document.getElementById('mode-label');
    this.$selCount   = document.getElementById('sel-count');
    this.$btnMove    = document.getElementById('btn-move');
    this.$btnSelAll  = document.getElementById('btn-sel-all');
    this.$btnAttack  = document.getElementById('btn-attack');
    this.$btnCancel  = document.getElementById('btn-cancel');
    this.$buildingActions = document.getElementById('building-actions');

    // ── EventBus підписки ──────────────────────────
    bus.on('gold:changed',      ({ gold, cap }) => this._onGoldChanged(gold, cap));
    bus.on('storage:changed',   ({ storageCap }) => this._onStorageChanged(storageCap));
    bus.on('unit:spawned',      ()              => this._refreshArmyState());
    bus.on('unit:died',         ({ id })        => { this._selectedUnitIds.delete(id); this._refreshArmyState(); });
    bus.on('game:phaseChanged', ({ phase })     => this._onPhaseChange(phase));
    bus.on('ui:notification',   (msg)           => this._showNotification(msg));
    bus.on('building:ready',    ()              => this._refreshBuildCosts());
    bus.on('training:progress', (d)             => this._onTrainingProgress(d));
    bus.on('ai:waveStarted',    ({ unitCount, type }) =>
      this._showNotification({ text: `⚠ ${type ?? 'Атака'}! ${unitCount} ворогів ідуть!`, type: 'warning' }));

    // ── Кнопки вкладок ────────────────────────────
    this.$tabBuild?.addEventListener('click', () => this._switchTab('build'));
    this.$tabArmy?.addEventListener('click',  () => this._switchTab('army'));

    // ── Кнопки команд армії ───────────────────────
    this.$btnSelAll?.addEventListener('click', () => this._selectAllUnits());
    this.$btnMove?.addEventListener('click',   () => this._toggleMoveMode());
    this.$btnAttack?.addEventListener('click', () => this._issueAttackOrder());
    this.$btnCancel?.addEventListener('click', () => this._cancelMode());

    // ── Canvas input ──────────────────────────────
    this._setupCanvasInput();

    // ── Ініціалізація ─────────────────────────────
    this._buildBuildPanel();
    this._buildArmyPanel();
    this._updateGold(state.gold, state.storageCap);
    this._refreshArmyState();
    this._setModeBar('Оберіть будівлю або юнітів');
  }

  // ═══════════════════════════════════════════════
  //  HUD
  // ═══════════════════════════════════════════════

  _onGoldChanged(gold, cap) {
    if (this.$goldVal) this.$goldVal.textContent = Math.floor(gold);
    if (this.$goldCap) this.$goldCap.textContent = cap;
    if (this.$goldBar) this.$goldBar.style.width = `${Math.min(100, (gold / cap) * 100)}%`;
    this._refreshBuildCosts();
  }

  _onStorageChanged(storageCap) {
    this._onGoldChanged(this.state.gold, storageCap);
  }

  _updateGold(gold, cap) { this._onGoldChanged(gold, cap); }

  _refreshArmyState() {
    const total = this.state.playerUnits.size;
    const sel   = this._selectedUnitIds.size;

    if (this.$armyVal) this.$armyVal.textContent = total;
    if (this.$armyCap) this.$armyCap.textContent = this.state.maxArmySize;
    if (this.$armyBar) this.$armyBar.style.width = `${Math.min(100, (total / this.state.maxArmySize) * 100)}%`;
    if (this.$selCount) {
      this.$selCount.textContent = sel > 0 ? `⚔ Вибрано: ${sel}` : '';
    }

    // Підсвітити кнопки якщо є виділення
    this.$btnMove?.classList.toggle('btn-active', this._inputMode === 'move');
    this.$btnMove?.classList.toggle('btn-dim', total === 0);
    this.$btnAttack?.classList.toggle('btn-dim', total === 0);
    this.$btnSelAll?.classList.toggle('btn-primary', sel < total && total > 0);
  }

  updateFps(fps) {
    if (this.$fps) this.$fps.textContent = `${fps} FPS`;
  }

  _onPhaseChange(phase) {
    const labels = { playing: '⚔ Бій', won: '🏆 Перемога!', lost: '💀 Поразка', paused: '⏸ Пауза' };
    if (this.$phase) this.$phase.textContent = labels[phase] ?? '';
    if (phase === 'won' || phase === 'lost') this._showEndScreen(phase);
  }

  // ═══════════════════════════════════════════════
  //  Mode Bar (підказка режиму)
  // ═══════════════════════════════════════════════

  _setModeBar(text, type = 'default') {
    if (!this.$modeLabel) return;
    this.$modeLabel.textContent = text;
    this.$modeBar?.setAttribute('data-type', type);
    this.$modeBar?.classList.remove('hidden');
  }

  _hideModeBar() {
    this.$modeBar?.classList.add('hidden');
  }

  // ═══════════════════════════════════════════════
  //  Панель будівництва
  // ═══════════════════════════════════════════════

  _buildBuildPanel() {
    if (!this.$buildGrid) return;
    this.$buildGrid.innerHTML = '';

    const categories = ['defense', 'economy', 'military'];
    const catLabels  = { economy: '⛏', military: '🏰', defense: '🛡' };

    for (const cat of categories) {
      const entries = Object.entries(this.defs.buildings)
        .filter(([, d]) => d.category === cat && !d.isStartBuilding);
      if (!entries.length) continue;

      const sep = document.createElement('div');
      sep.className = 'panel-sep';
      sep.textContent = catLabels[cat] ?? cat;
      this.$buildGrid.appendChild(sep);

      for (const [id, def] of entries) {
        const btn = document.createElement('button');
        btn.className     = 'build-btn';
        btn.id            = `bbtn-${id}`;
        btn.dataset.defId = id;
        btn.innerHTML = `
          <span class="btn-icon">${this._buildIcon(def)}</span>
          <span class="btn-name">${def.name}</span>
          <span class="btn-cost">🪙${def.cost.gold}</span>
        `;
        btn.addEventListener('click', () => this._startBuildMode(id, def));
        this.$buildGrid.appendChild(btn);
      }
    }

    this._refreshBuildCosts();
  }

  _refreshBuildCosts() {
    this.$buildGrid?.querySelectorAll('.build-btn').forEach(btn => {
      const def = this.defs.buildings[btn.dataset.defId];
      if (!def) return;
      const canAfford = this.state.gold >= def.cost.gold;
      btn.classList.toggle('btn-disabled', !canAfford);
      btn.classList.toggle('btn-selected', this._buildDefId === btn.dataset.defId);
    });
  }

  _startBuildMode(defId, def) {
    this._inputMode  = 'build';
    this._buildDefId = defId;
    this._setModeBar(`🏗 Оберіть місце для: ${def.name} (${def.size.w}×${def.size.h}) — Тапніть на свою зону`, 'build');
    this._refreshBuildCosts();
    // Плавно мінімізувати панель щоб бачити карту
    this.$panel?.classList.add('panel-peek');
  }

  // ═══════════════════════════════════════════════
  //  Панель армії
  // ═══════════════════════════════════════════════

  _buildArmyPanel() {
    if (!this.$armyGrid) return;
    this.$armyGrid.innerHTML = '';

    for (const [id, def] of Object.entries(this.defs.units)) {
      const btn = document.createElement('button');
      btn.className     = 'army-btn';
      btn.id            = `abtn-${id}`;
      btn.dataset.unitId = id;
      btn.innerHTML = `
        <span class="btn-icon">${this._unitIcon(def)}</span>
        <span class="btn-name">${def.name}</span>
        <span class="btn-cost">🪙${def.cost.gold}</span>
        <span class="btn-speed">👟 ${def.speed}</span>
        <div class="train-bar" id="trainbar-${id}"></div>
      `;
      btn.addEventListener('click', () => this._onTrainClick(id, def));
      this.$armyGrid.appendChild(btn);
    }
  }

  _onTrainClick(unitDefId, def) {
    const barracks = [...this.state.playerBuildings.values()]
      .find(b => b.def.training && b.isReady && b.trainingQueue.length < 4);

    if (!barracks) {
      this._showNotification({ text: '🏰 Збудуйте Казарму!', type: 'error' });
      return;
    }
    bus.emit('cmd:trainUnit', { unitDefId, buildingId: barracks.id });
  }

  _onTrainingProgress({ unitId, percent }) {
    const bar = document.getElementById(`trainbar-${unitId}`);
    if (bar) {
      bar.style.width = `${Math.round(percent)}%`;
      bar.style.opacity = '1';
    }
  }

  // ═══════════════════════════════════════════════
  //  Управління юнітами
  // ═══════════════════════════════════════════════

  /** Вибрати всіх юнітів гравця. */
  _selectAllUnits() {
    this._selectedUnitIds = new Set(this.state.playerUnits.keys());
    this._refreshArmyState();
    const n = this._selectedUnitIds.size;
    if (n > 0) {
      this._setModeBar(`⚔ Вибрано ${n} юнітів — натисніть Рухати або Атака`, 'select');
    } else {
      this._showNotification({ text: 'Немає юнітів для вибору', type: 'warning' });
    }
  }

  /** Ввімкнути / вимкнути режим переміщення. */
  _toggleMoveMode() {
    if (this.state.playerUnits.size === 0) {
      this._showNotification({ text: 'Немає юнітів!', type: 'error' });
      return;
    }
    if (this._selectedUnitIds.size === 0) this._selectAllUnits();

    if (this._inputMode === 'move') {
      this._inputMode = 'idle';
      this._setModeBar('Оберіть будівлю або юнітів');
      this.$panel?.classList.remove('panel-peek');
    } else {
      this._inputMode = 'move';
      this._setModeBar('🚶 Режим руху: торкніться карти в точці призначення', 'move');
      this._showNotification({ text: 'Торкніться карти там, куди мають піти юніти', type: 'info' });
      this.$panel?.classList.add('panel-peek');
    }
    this._refreshArmyState();
  }

  /** Наказ атакувати — юніти йдуть до ворожого штабу. */
  _issueAttackOrder() {
    const units = this._selectedUnitIds.size > 0
      ? [...this._selectedUnitIds]
      : [...this.state.playerUnits.keys()];

    if (units.length === 0) {
      this._showNotification({ text: 'Немає юнітів для атаки!', type: 'error' });
      return;
    }

    bus.emit('cmd:attackOrder', { unitIds: units });
    this._setModeBar(`⚔ ${units.length} юнітів рушили в атаку!`, 'attack');
    this._showNotification({ text: `⚔ АТАКА! ${units.length} юнітів!`, type: 'success' });

    // Скидаємо вибір через 1.5с
    setTimeout(() => {
      this._selectedUnitIds.clear();
      this._inputMode = 'idle';
      this._setModeBar('Оберіть будівлю або юнітів');
      this._refreshArmyState();
    }, 1500);
  }

  /** Скасувати поточний режим. */
  _cancelMode() {
    this._inputMode      = 'idle';
    this._buildDefId     = null;
    this._selectedUnitIds.clear();
    this.$panel?.classList.remove('panel-peek');
    this._setModeBar('Оберіть будівлю або юнітів');
    this._refreshBuildCosts();
    this._refreshArmyState();
    this._closeModal();
  }

  // ═══════════════════════════════════════════════
  //  Вкладки
  // ═══════════════════════════════════════════════

  _switchTab(tab) {
    this._activeTab = tab;
    this.$buildGrid?.classList.toggle('hidden', tab !== 'build');
    this.$armyGrid?.classList.toggle('hidden',  tab !== 'army');
    this.$tabBuild?.classList.toggle('tab-active', tab === 'build');
    this.$tabArmy?.classList.toggle('tab-active',  tab === 'army');

    // При перемиканні на армію показуємо підказку
    if (tab === 'army') {
      this._setModeBar('Оберіть: Виділити ▸ Рухати / Атакувати', 'info');
    }
  }

  // ═══════════════════════════════════════════════
  //  Canvas Input (touch + mouse)
  // ═══════════════════════════════════════════════

  _setupCanvasInput() {
    let touchStartX = 0, touchStartY = 0;
    let touchStartTime = 0;
    let isPanning = false;
    let activeMouseButton = null;

    // Стан для зуму
    let initialPinchDist = 0;
    let initialZoom = 1.0;
    let pinchCenter = { x: 0, y: 0 };
    let isPinching = false;

    const onStart = (x, y) => {
      touchStartX    = x;
      touchStartY    = y;
      touchStartTime = Date.now();
      isPanning      = false;
      isPinching     = false;
    };

    const onMove = (x, y) => {
      if (isPinching) return;
      const dx = x - touchStartX, dy = y - touchStartY;
      if (!isPanning && Math.hypot(dx, dy) > 10) {
        isPanning = true;
      }
      if (isPanning) {
        // Швидкість панорамування масштабується відповідно до зуму
        const z = this.renderer.zoom;
        this.renderer.panCamera(-dx / z, -dy / z);
        touchStartX = x;
        touchStartY = y;
      }
    };

    const onEnd = (x, y, button = 0) => {
      if (isPinching) return;
      const dt = Date.now() - touchStartTime;
      if (!isPanning && dt < 400) this._onCanvasTap(x, y, button);
    };

    // ── Mouse Wheel (Zoom) ──────────────────────
    this.$canvas?.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = this.$canvas.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      
      const zoomSpeed = 0.15;
      const zDelta = Math.sign(e.deltaY) < 0 ? zoomSpeed : -zoomSpeed;
      const oldZoom = this.renderer.zoom;
      this.renderer.setZoom(oldZoom * (1 + zDelta), { x: relX, y: relY });
    }, { passive: false });

    // ── Touch ───────────────────────────────────
    this.$canvas?.addEventListener('touchstart', e => {
      e.preventDefault();
      if (e.touches.length === 2) {
        // Pinch start
        isPinching = true;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        initialPinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        initialZoom = this.renderer.zoom;
        
        const rect = this.$canvas.getBoundingClientRect();
        pinchCenter = {
          x: ((t1.clientX + t2.clientX) / 2) - rect.left,
          y: ((t1.clientY + t2.clientY) / 2) - rect.top
        };
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        onStart(t.clientX, t.clientY);
      }
    }, { passive: false });

    this.$canvas?.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 2) {
        // Pinch move
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const scale = dist / initialPinchDist;
        this.renderer.setZoom(initialZoom * scale, pinchCenter);
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        onMove(t.clientX, t.clientY);
      }
    }, { passive: false });

    this.$canvas?.addEventListener('touchend', e => {
      if (e.touches.length > 0) {
        // Якщо відпустили 1 палець з двох, скидаємо початок для панорамування
        const t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        return;
      }
      if (isPinching) {
        isPinching = false;
        return; // Запобігаємо кліку після зуму
      }
      const t = e.changedTouches[0];
      onEnd(t.clientX, t.clientY);
    });

    // ── Mouse ───────────────────────────────────

    let mDown = false;
    this.$canvas?.addEventListener('contextmenu', e => e.preventDefault());
    this.$canvas?.addEventListener('mousedown', e => {
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      mDown = true;
      activeMouseButton = e.button;
      onStart(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', e => {
      if (mDown && activeMouseButton === 0) onMove(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', e => {
      if (!mDown) return;
      const button = activeMouseButton ?? e.button;
      mDown = false;
      activeMouseButton = null;
      onEnd(e.clientX, e.clientY, button);
    });
  }

  _onCanvasTap(screenX, screenY, button = 0) {
    const rect  = this.$canvas.getBoundingClientRect();
    const relX  = screenX - rect.left;
    const relY  = screenY - rect.top;
    const tile  = this.renderer.screenToTile(relX, relY);

    // ── Цільова атака (тап по ворогу лівою/правою коли вибрана армія) ──
    if (this._selectedUnitIds.size > 0 && this._inputMode !== 'build') {
      const isRightClick = button === 2;
      let targetId = null;
      let targetTeam = 'enemy';

      // Перевіряємо ворожих юнітів
      const ts = this.renderer.tileSize;
      for (const [id, t] of this.state.enemyUnits) {
        if (t.isDead) continue;
        const tx = t.x / ts, ty = t.y / ts;
        if (Math.abs(tx - tile.x) < 0.8 && Math.abs(ty - tile.y) < 0.8) {
          targetId = id; break;
        }
      }
      // Перевіряємо ворожі будівлі
      if (!targetId) {
        for (const [id, t] of this.state.enemyBuildings) {
          if (!t.isDestroyed && tile.x >= t.tileX && tile.x < t.tileX + t.def.size.w &&
              tile.y >= t.tileY && tile.y < t.tileY + t.def.size.h) {
            targetId = id; break;
          }
        }
      }

      if (targetId) {
        const ids = [...this._selectedUnitIds];
        bus.emit('cmd:attackOrder', { unitIds: ids, targetId, targetTeam });
        this._inputMode = 'idle';
        this.$panel?.classList.remove('panel-peek');
        this._showNotification({ text: `⚔ Пряма атака на ціль!`, type: 'success' });
        this._setModeBar(`Атака на вказану ціль`, 'attack');
        this._refreshArmyState();
        return;
      }
    }

    // ── Переміщення (явний наказ через кнопку пульта або ПКМ) ──
    if (this._inputMode === 'move' || button === 2) {
      if (this._selectedUnitIds.size === 0) return;
      const ids = [...this._selectedUnitIds];
      bus.emit('cmd:moveOrder', { tileX: tile.x, tileY: tile.y, unitIds: ids });
      this._inputMode = 'idle';
      this.$panel?.classList.remove('panel-peek');
      this._showNotification({ text: `🚶 ${ids.length} юнітів рушили до точки`, type: 'success' });
      this._setModeBar(`Маршрут задано для ${ids.length} юнітів`, 'select');
      this._refreshArmyState();
      return;
    }

    // ── Режим будівництва ──────────────────────
    if (this._inputMode === 'build' && this._buildDefId) {
      if (this.instantBuild) {
        bus.emit('cmd:buildBuilding', { defId: this._buildDefId, tileX: tile.x, tileY: tile.y });
      } else {
        // Двоетапне будівництво (Підтвердження повторним тапом)
        if (!this._previewBuildTile || this._previewBuildTile.x !== tile.x || this._previewBuildTile.y !== tile.y) {
          // Перший тап - показати Preview та запам'ятати
          this._previewBuildTile = tile;
          const def = this.defs.buildings[this._buildDefId];
          if (this.renderer.setBuildPreview) this.renderer.setBuildPreview(def, tile);
          
          this._showNotification({ text: `Тапніть ще раз на цю клітинку для підтвердження`, type: 'info' });
          return; // Чекаємо другий тап
        } else {
          // Другий тап сюди ж - будуємо
          bus.emit('cmd:buildBuilding', { defId: this._buildDefId, tileX: tile.x, tileY: tile.y });
          this._previewBuildTile = null;
          if (this.renderer.setBuildPreview) this.renderer.setBuildPreview(null);
        }
      }
      return;
    }

    // ── Режим переміщення ──────────────────────
    if (this._inputMode === 'move') {
      const ids = this._selectedUnitIds.size > 0
        ? [...this._selectedUnitIds]
        : [...this.state.playerUnits.keys()];
      bus.emit('cmd:moveOrder', { tileX: tile.x, tileY: tile.y, unitIds: ids });
      this._inputMode = 'idle';
      this.$panel?.classList.remove('panel-peek');
      this._showNotification({ text: `🚶 ${ids.length} юнітів рушили до точки`, type: 'success' });
      this._setModeBar(`Маршрут задано. Вибрано ${ids.length} юнітів`, 'select');
      this._refreshArmyState();
      return;
    }

    // ── Режим idle: вибір юніта або будівлі ───
    // Перевірити юнітів гравця
    const ts = this.renderer.tileSize;
    for (const [id, u] of this.state.playerUnits) {
      if (u.isDead) continue;
      const ux = u.x / ts, uy = u.y / ts;
      if (Math.abs(ux - tile.x) < 0.8 && Math.abs(uy - tile.y) < 0.8) {
        this._toggleUnitSelect(id);
        return;
      }
    }

    // Перевірити будівлі гравця
    for (const [id, b] of this.state.playerBuildings) {
      if (
        tile.x >= b.tileX && tile.x < b.tileX + b.def.size.w &&
        tile.y >= b.tileY && tile.y < b.tileY + b.def.size.h
      ) {
        this._showBuildingModal(b);
        return;
      }
    }

    // Тапнули пусте місце — зняти виділення
    if (this._selectedUnitIds.size > 0) {
      this._selectedUnitIds.clear();
      this._refreshArmyState();
      this._setModeBar('Оберіть будівлю або юнітів');
    }
  }

  _toggleUnitSelect(id) {
    if (this._selectedUnitIds.has(id)) {
      this._selectedUnitIds.delete(id);
    } else {
      this._selectedUnitIds.add(id);
    }
    const n = this._selectedUnitIds.size;
    this._refreshArmyState();

    if (n > 0) {
      this._setModeBar(`⚔ Вибрано ${n} — натисніть Рухати або Атака`, 'select');
    } else {
      this._setModeBar('Оберіть будівлю або юнітів');
    }
  }

  // ═══════════════════════════════════════════════
  //   Геттер для рендеру (виділені юніти)
  // ═══════════════════════════════════════════════

  get selectedUnitIds() { return this._selectedUnitIds; }
  get inputMode()       { return this._inputMode; }
  get buildDefId()      { return this._buildDefId; }

  // ═══════════════════════════════════════════════
  //  Модальне вікно будівлі
  // ═══════════════════════════════════════════════

  _showBuildingModal(building) {
    if (!this.$modal || !this.$modalBody) return;
    const def     = building.def;
    const upgId   = def.upgrades?.[0];
    const upgDef  = upgId ? this.defs.buildings[upgId] : null;
    const hpPct   = Math.round((building.hp / building.maxHp) * 100);

    // HP колір
    const hpColor = hpPct > 60 ? '#2ecc71' : hpPct > 30 ? '#f39c12' : '#e74c3c';

    this.$modalBody.innerHTML = `
      <div class="modal-header">
        <span class="modal-icon">${this._buildIcon(def)}</span>
        <div>
          <h3 class="modal-title">${def.name}</h3>
          <p class="modal-desc">${def.description}</p>
        </div>
      </div>

      <div class="modal-hp">
        <div class="modal-hp-bar" style="width:${hpPct}%;background:${hpColor}"></div>
        <span class="modal-hp-text">❤ ${Math.floor(building.hp)} / ${building.maxHp}</span>
      </div>

      <div class="modal-stats">
        ${building.isBuilding
          ? `<div class="stat stat-warn">🔨 Будується: ${Math.round(building.buildProgress)}%</div>`
          : ''}
        ${def.production
          ? `<div class="stat">⛏ +${def.production.amount} зол / ${def.production.intervalSec}с</div>`
          : ''}
        ${def.storage
          ? `<div class="stat">📦 +${def.storage.capacity} ємності</div>`
          : ''}
        ${def.combat
          ? `<div class="stat">🎯 ${def.combat.attackDamage} dmg · ${def.combat.attackRangeTiles} тайлів</div>`
          : ''}
        ${def.training
          ? `<div class="stat">🪖 Черга: ${building.trainingQueue.length} юнітів</div>`
          : ''}
      </div>

      <div class="modal-actions">
        ${upgDef
          ? `<button class="btn-modal btn-upgrade"
               onclick="window.__uiManager._doUpgrade('${building.id}')">
               ⬆ ${upgDef.name} — ${upgDef.cost.gold} 🪙
             </button>`
          : ''}
        ${building.def.id !== 'headquarters'
          ? `<button class="btn-modal btn-demolish"
               onclick="window.__uiManager._doDemolish('${building.id}')">
               🪓 Знести
             </button>`
          : ''}
        <button class="btn-modal btn-modal-close"
                onclick="window.__uiManager._closeModal()">✕ Закрити</button>
      </div>
    `;

    this.$modal.classList.remove('hidden');
    this.$modal.classList.add('modal-visible');
  }

  _doUpgrade(buildingId) {
    bus.emit('cmd:upgradeBuilding', { buildingId });
    this._closeModal();
  }

  _doDemolish(buildingId) {
    bus.emit('cmd:demolishBuilding', { buildingId });
    this._closeModal();
  }

  _closeModal() {
    this.$modal?.classList.add('hidden');
    this.$modal?.classList.remove('modal-visible');
  }

  // ═══════════════════════════════════════════════
  //  Кінцевий екран
  // ═══════════════════════════════════════════════

  _showEndScreen(phase) {
    const el    = document.getElementById('end-screen');
    const title = document.getElementById('end-title');
    const sub   = document.getElementById('end-sub');
    if (!el) return;
    title.textContent = phase === 'won' ? '🏆 Перемога!' : '💀 Поразка!';
    sub.textContent   = phase === 'won' ? 'Ворожа база знищена!' : 'Ваш штаб захоплено.';
    el.className      = `end-screen ${phase}`;
    el.classList.remove('hidden');
  }

  // ═══════════════════════════════════════════════
  //  Toast нотифікації
  // ═══════════════════════════════════════════════

  _showNotification({ text, type = 'info' }) {
    if (!this.$notify) return;
    const toast = document.createElement('div');
    toast.className   = `toast toast-${type}`;
    toast.textContent = text;
    this.$notify.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-show'));
    setTimeout(() => {
      toast.classList.remove('toast-show');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, 2500);
  }

  // ═══════════════════════════════════════════════
  //  Іконки
  // ═══════════════════════════════════════════════

  _buildIcon(def) {
    const m = {
      wall: '🧱', reinforced_wall: '🔒',
      gold_mine: '⛏', gold_mine_lvl2: '⛏⛏',
      treasury: '🏦', treasury_lvl2: '🏦🏦',
      barracks: '🏰', barracks_lvl2: '🏯',
      tower: '🗼', cannon_tower: '💣',
      headquarters: '👑',
    };
    return m[def.id] ?? '🏗';
  }

  _unitIcon(def) {
    return { melee: '⚔', ranged: '🏹', siege: '💣' }[def.category] ?? '🪖';
  }
}

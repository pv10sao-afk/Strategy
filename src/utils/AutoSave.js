/**
 * AutoSave — зберігає стан гри до localStorage.
 *
 * Зберігає:
 *   • Стан економіки (золото, ліміт)
 *   • Усі будівлі (позиція, HP, статус, рівень)
 *   • Усі юніти (позиція, HP)
 *   • Поточний тік
 *
 * Завантажується автоматично при старті якщо є збережений стан.
 */

const SAVE_KEY  = 'forgewar_save_v1';
const SAVE_VER  = 1;

export class AutoSave {
  /**
   * @param {import('../state/GameState.js').GameState} state
   * @param {import('../core/EventBus.js').EventBus}    bus
   * @param {number} intervalSec
   */
  constructor(state, bus, intervalSec = 30) {
    this.state       = state;
    this.bus         = bus;
    this._timer      = 0;
    this._interval   = intervalSec;
    this._lastSaveTick = -1;

    // Підписатись на події які форсують збереження
    bus.on('building:added',   () => this._dirty = true);
    bus.on('building:removed', () => this._dirty = true);
    bus.on('unit:spawned',     () => this._dirty = true);
    bus.on('game:phaseChanged',() => this._save());

    this._dirty = false;
  }

  // ─────────────────────────────────────────────
  //  Update (викликається з GameLoop)
  // ─────────────────────────────────────────────

  update(dtSec) {
    this._timer += dtSec;
    if (this._timer >= this._interval) {
      this._timer -= this._interval;
      this._save();
    }
  }

  // ─────────────────────────────────────────────
  //  Збереження
  // ─────────────────────────────────────────────

  _save() {
    if (this.state.phase === 'loading') return;

    try {
      const snapshot = {
        version:  SAVE_VER,
        savedAt:  Date.now(),
        state:    this.state.serialize(),
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
      this._dirty = false;
      this.bus.emit('autosave:done', { savedAt: snapshot.savedAt });
    } catch (err) {
      console.warn('[AutoSave] Failed to save:', err);
      // QuotaExceededError — ігнорувати, не збивати гру
    }
  }

  // ─────────────────────────────────────────────
  //  Завантаження
  // ─────────────────────────────────────────────

  /**
   * Повертає збережений стан або null якщо збереження немає.
   * @returns {Object|null}
   */
  static load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const snap = JSON.parse(raw);
      if (snap.version !== SAVE_VER) {
        console.warn('[AutoSave] Save version mismatch, discarding.');
        localStorage.removeItem(SAVE_KEY);
        return null;
      }
      return snap.state;
    } catch (err) {
      console.warn('[AutoSave] Failed to load save:', err);
      return null;
    }
  }

  /**
   * Видалити збереження (кнопка "Нова гра").
   */
  static clear() {
    localStorage.removeItem(SAVE_KEY);
  }

  /**
   * Чи є збережений стан?
   */
  static hasSave() {
    return localStorage.getItem(SAVE_KEY) !== null;
  }
}

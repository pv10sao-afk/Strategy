/**
 * EventBus — глобальна шина подій (Pub/Sub).
 * Дозволяє системам спілкуватися без прямих залежностей.
 *
 * Використання:
 *   EventBus.on('gold:changed', (data) => { ... });
 *   EventBus.emit('gold:changed', { amount: 50 });
 *   EventBus.off('gold:changed', handler);
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Підписатись на подію.
   * @param {string} event
   * @param {Function} handler
   */
  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
  }

  /**
   * Відписатись від події.
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    this._listeners.get(event)?.delete(handler);
  }

  /**
   * Підписатись лише один раз.
   * @param {string} event
   * @param {Function} handler
   */
  once(event, handler) {
    const wrapper = (data) => {
      handler(data);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }

  /**
   * Надіслати подію всім підписникам.
   * @param {string} event
   * @param {*} data
   */
  emit(event, data) {
    this._listeners.get(event)?.forEach((h) => {
      try {
        h(data);
      } catch (err) {
        console.error(`[EventBus] Error in handler for "${event}":`, err);
      }
    });
  }

  /**
   * Видалити всіх підписників (корисно при перезапуску гри).
   */
  clear() {
    this._listeners.clear();
  }
}

// Singleton — один на всю гру
export const bus = new EventBus();

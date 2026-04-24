/**
 * AssetLoader — завантажує зображення та JSON-конфіги до старту гри.
 * Підтримує прогрес-бар завантаження.
 */
export class AssetLoader {
  constructor() {
    /** @type {Map<string, HTMLImageElement>} */
    this.images = new Map();
    /** @type {Map<string, Object>} */
    this.data = new Map();

    this._total = 0;
    this._loaded = 0;
    this._onProgress = null;
  }

  /**
   * @param {Function} cb  - callback(percent: 0..1)
   */
  onProgress(cb) {
    this._onProgress = cb;
    return this;
  }

  _tick() {
    this._loaded++;
    if (this._onProgress) {
      this._onProgress(this._loaded / this._total);
    }
  }

  /**
   * Завантажити список зображень.
   * @param {Array<{key: string, src: string}>} list
   */
  _loadImages(list) {
    return list.map(
      ({ key, src }) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            this.images.set(key, img);
            this._tick();
            resolve();
          };
          img.onerror = () => {
            console.warn(`[AssetLoader] Failed to load image: ${src}`);
            this._tick();
            resolve(); // не блокуємо гру через відсутнє фото
          };
          img.src = src;
        })
    );
  }

  /**
   * Завантажити список JSON-файлів.
   * @param {Array<{key: string, src: string}>} list
   */
  _loadJSON(list) {
    return list.map(({ key, src }) =>
      fetch(src)
        .then((r) => r.json())
        .then((json) => {
          this.data.set(key, json);
          this._tick();
        })
        .catch((err) => {
          console.error(`[AssetLoader] Failed to load JSON: ${src}`, err);
          this._tick();
        })
    );
  }

  /**
   * Завантажити все та повернути Promise.
   * @param {{ images?: Array, json?: Array }} manifest
   */
  async loadAll(manifest) {
    const images = manifest.images ?? [];
    const json   = manifest.json ?? [];

    this._total  = images.length + json.length;
    this._loaded = 0;

    if (this._total === 0) return;

    await Promise.all([
      ...this._loadImages(images),
      ...this._loadJSON(json),
    ]);
  }

  /** @param {string} key @returns {HTMLImageElement|null} */
  getImage(key) {
    return this.images.get(key) ?? null;
  }

  /** @param {string} key @returns {Object|null} */
  getData(key) {
    return this.data.get(key) ?? null;
  }
}

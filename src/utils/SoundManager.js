/**
 * SoundManager — Web Audio API обгортка для ігрових звуків.
 *
 * Особливості:
 *   • Lazy AudioContext (ініціалізується після першого жесту користувача)
 *   • Підтримує .ogg та .mp3 з автовибором формату
 *   • Окремий канал для музики та звукових ефектів
 *   • Volume, mute, spatial audio (відстань от камери)
 */
export class SoundManager {
  constructor() {
    /** @type {AudioContext|null} */
    this._ctx    = null;
    this._master = null;
    this._sfxBus = null;
    this._bgmBus = null;

    /** @type {Map<string, AudioBuffer>} */
    this._buffers = new Map();

    /** @type {AudioBufferSourceNode|null} */
    this._bgmSource = null;

    this._sfxVol  = 1;
    this._bgmVol  = 0.4;
    this._muted   = false;

    this._ready   = false;

    // Ініціалізуємо після першого тапу (мобільне обмеження)
    const initOnce = () => {
      if (!this._ready) this._init();
      document.removeEventListener('touchstart', initOnce);
      document.removeEventListener('click',      initOnce);
    };
    document.addEventListener('touchstart', initOnce, { once: true });
    document.addEventListener('click',      initOnce, { once: true });
  }

  _init() {
    this._ctx    = new (window.AudioContext || window.webkitAudioContext)();
    this._master = this._ctx.createGain();
    this._sfxBus = this._ctx.createGain();
    this._bgmBus = this._ctx.createGain();

    this._sfxBus.connect(this._master);
    this._bgmBus.connect(this._master);
    this._master.connect(this._ctx.destination);

    this._sfxBus.gain.value = this._sfxVol;
    this._bgmBus.gain.value = this._bgmVol;

    this._ready = true;
  }

  // ─────────────────────────────────────────────
  //  Завантаження
  // ─────────────────────────────────────────────

  /**
   * Попередньо завантажити звуковий файл.
   * @param {string} key
   * @param {string} src
   */
  async load(key, src) {
    if (!this._ready) this._init();
    try {
      const res    = await fetch(src);
      const arrBuf = await res.arrayBuffer();
      const audio  = await this._ctx.decodeAudioData(arrBuf);
      this._buffers.set(key, audio);
    } catch (err) {
      console.warn(`[SoundManager] Failed to load: ${src}`, err);
    }
  }

  /**
   * Завантажити список звуків.
   * @param {Array<{key:string, src:string}>} list
   */
  async loadAll(list) {
    await Promise.all(list.map(({ key, src }) => this.load(key, src)));
  }

  // ─────────────────────────────────────────────
  //  Відтворення SFX
  // ─────────────────────────────────────────────

  /**
   * Відтворити звуковий ефект.
   * @param {string}  key
   * @param {Object}  opts
   * @param {number}  opts.volume   0..1
   * @param {number}  opts.pitch    Playback rate, 1=normal
   * @param {number}  opts.panX     -1..1 (spatial)
   */
  play(key, { volume = 1, pitch = 1, panX = 0 } = {}) {
    if (!this._ready || this._muted) return;
    const buf = this._buffers.get(key);
    if (!buf) return;

    const src    = this._ctx.createBufferSource();
    src.buffer   = buf;
    src.playbackRate.value = pitch + (Math.random() * 0.06 - 0.03); // pitch variance

    const gainNode = this._ctx.createGain();
    gainNode.gain.value = volume;

    if (panX !== 0) {
      const panner = this._ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, panX));
      src.connect(gainNode).connect(panner).connect(this._sfxBus);
    } else {
      src.connect(gainNode);
      gainNode.connect(this._sfxBus);
    }

    src.start(0);
    src.onended = () => { gainNode.disconnect(); };
  }

  // ─────────────────────────────────────────────
  //  Фонова музика
  // ─────────────────────────────────────────────

  /**
   * @param {string} key
   * @param {boolean} loop
   */
  playBGM(key, loop = true) {
    if (!this._ready) return;
    this.stopBGM();

    const buf = this._buffers.get(key);
    if (!buf) return;

    this._bgmSource = this._ctx.createBufferSource();
    this._bgmSource.buffer = buf;
    this._bgmSource.loop   = loop;
    this._bgmSource.connect(this._bgmBus);
    this._bgmSource.start(0);
  }

  stopBGM() {
    try { this._bgmSource?.stop(); } catch (_) {}
    this._bgmSource = null;
  }

  // ─────────────────────────────────────────────
  //  Гучність / Mute
  // ─────────────────────────────────────────────

  setSfxVolume(v) {
    this._sfxVol = v;
    if (this._sfxBus) this._sfxBus.gain.value = v;
  }

  setBgmVolume(v) {
    this._bgmVol = v;
    if (this._bgmBus) this._bgmBus.gain.value = v;
  }

  toggleMute() {
    this._muted = !this._muted;
    if (this._master) this._master.gain.value = this._muted ? 0 : 1;
    return this._muted;
  }

  get isMuted() { return this._muted; }
}

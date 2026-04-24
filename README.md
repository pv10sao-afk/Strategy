# ForgeWar 🏰⚔

> 2D Mobile RTS Strategy — Vanilla JS + HTML5 Canvas. Без Unity, без Godot. Власний міні-рушій.

[![Platform](https://img.shields.io/badge/platform-Android%20%7C%20Browser-blue)]()
[![Tech](https://img.shields.io/badge/tech-Vanilla%20JS%20%7C%20Canvas%20%7C%20Capacitor-orange)]()

---

## 🎮 Геймплей

- Будуй економіку (Шахти → Скарбниці)
- Тренуй армію (Воїни, Лучники, Лицарі, Катапульти)
- Захищай базу (Сторожові та Гарматні Вежі)
- Знищ штаб ворога!

---

## 🚀 Швидкий старт

```bash
cd d:\Strategy
npm install
npm run dev
# Відкрити http://localhost:3000
# Chrome DevTools → Toggle Device Toolbar → iPhone 14 Pro
```

---

## 🏗 Архітектура

```
GameLoop (fixed 100ms ticks + rAF render)
    │
    ├── EconomySystem  ← золото, будівництво, тренування
    ├── CombatSystem   ← aggro, бій, снаряди, вежі
    └── AIController   ← rule-based ШІ, хвилі атак

GameState (єдине джерело правди)
    └── EventBus (Pub/Sub між системами)

Renderer (dual-canvas)
    ├── map-canvas     ← статична карта (тайли)
    └── entity-canvas  ← динамічні об'єкти

UIManager
    ├── HUD (gold, army, fps)
    ├── BuildPanel (горизонтальний скрол)
    ├── ArmyPanel  (тренування юнітів)
    └── Modal / Toast / EndScreen
```

---

## ➕ Як додати нову будівлю (без зміни коду!)

1. Відкрити `data/entities.json`
2. Додати блок у `buildings`:
   ```json
   "magic_tower": {
     "id": "magic_tower",
     "name": "Магічна Вежа",
     "category": "defense",
     "cost": { "gold": 350 },
     "buildTime": 15,
     "maxHp": 700,
     "combat": {
       "attackDamage": 40,
       "attackRangeTiles": 6,
       "attackSpeedMs": 1200,
       "damageType": "magic"
     }
   }
   ```
3. Покласти `magic_tower.png` → `assets/sprites/buildings/`
4. **Готово** — кнопка з'явиться в панелі автоматично!

---

## 📁 Структура файлів

| Файл / Папка | Призначення |
|---|---|
| `index.html` | Точка входу, HTML-скелет |
| `data/*.json` | Всі ігрові дані (конфіги) |
| `styles/*.css` | UI стилі |
| `src/core/` | GameLoop, EventBus, AssetLoader |
| `src/state/` | GameState |
| `src/entities/` | Building, Unit |
| `src/economy/` | EconomySystem |
| `src/combat/` | CombatSystem |
| `src/pathfinding/` | A* Pathfinder |
| `src/renderer/` | Renderer, MiniMap, ParticleSystem |
| `src/ai/` | AIController |
| `src/ui/` | UIManager |
| `src/utils/` | Vec2, AutoSave, SoundManager |

---

## 📱 Android

```bash
npx cap add android
npx cap sync android
npx cap open android
# Android Studio → Build → Generate Signed Bundle/APK
```

---

## 🗺 Roadmap

- [x] GameLoop (Fixed Timestep)
- [x] EventBus (Pub/Sub)
- [x] AssetLoader з прогрес-баром
- [x] GameState (єдине джерело правди)
- [x] Data-Driven entities.json
- [x] Building & Unit entities
- [x] EconomySystem
- [x] A* Pathfinder з MinHeap
- [x] CombatSystem (melee/ranged/towers)
- [x] Rule-based AIController
- [x] Dual-canvas Renderer
- [x] UIManager (HUD + панелі + модалки)
- [x] AutoSave (localStorage)
- [x] MiniMap
- [x] ParticleSystem
- [x] SoundManager (Web Audio API)
- [ ] Pixel Art спрайти 32×32
- [ ] Fog of War
- [ ] Multiplayer (WebSocket)
- [ ] Android APK release build

/**
 * Pathfinder — A* пошук шляху на тайловій карті.
 *
 * Особливості:
 *   • Оптимізований бінарним мінімальним купою (min-heap).
 *   • Підтримує 4-напрямний та 8-напрямний рух.
 *   • Повертає масив пікселів (центри тайлів).
 *   • Path smoothing (видалення зайвих вузлів на прямих).
 */
export class Pathfinder {
  /**
   * @param {number[][]} grid    - 2D масив: 0=прохідний, 1=заблокований
   * @param {number} tileSize   - розмір тайлу в пікселях
   * @param {boolean} diagonal  - дозволити діагональний рух
   */
  constructor(grid, tileSize, diagonal = false) {
    this.grid     = grid;
    this.tileSize = tileSize;
    this.diagonal = diagonal;
    this.rows     = grid.length;
    this.cols     = grid[0]?.length ?? 0;
  }

  /**
   * Знайти шлях від (startX, startY) до (endX, endY) у тайлах.
   * @returns {Array<{x:number, y:number}>} масив пікселів або [] якщо шлях не знайдено
   */
  findPath(startX, startY, endX, endY, options = {}) {
    const canTraverse = options.canTraverse ?? null;
    if (!this._isWalkable(endX, endY, canTraverse)) return [];

    const openSet  = new MinHeap();
    const cameFrom = new Map();
    const gScore   = new Map();
    const fScore   = new Map();

    const startKey = this._key(startX, startY);
    gScore.set(startKey, 0);
    fScore.set(startKey, this._h(startX, startY, endX, endY));
    openSet.push({ x: startX, y: startY, f: fScore.get(startKey) });

    while (!openSet.isEmpty()) {
      const current = openSet.pop();
      const { x, y } = current;

      if (x === endX && y === endY) {
        return this._reconstruct(cameFrom, x, y);
      }

      const curKey = this._key(x, y);

      for (const [nx, ny] of this._neighbors(x, y, canTraverse)) {
        const nKey    = this._key(nx, ny);
        const isDiag  = nx !== x && ny !== y;
        const cost    = isDiag ? 1.414 : 1;
        const tentativeG = (gScore.get(curKey) ?? Infinity) + cost;

        if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
          cameFrom.set(nKey, { x, y });
          gScore.set(nKey, tentativeG);
          const f = tentativeG + this._h(nx, ny, endX, endY);
          fScore.set(nKey, f);
          openSet.push({ x: nx, y: ny, f });
        }
      }
    }

    return []; // немає шляху
  }

  // ── Евристика (Czebyszev для діаг, Манхеттен для 4-dir) ──
  _h(x, y, ex, ey) {
    const dx = Math.abs(x - ex);
    const dy = Math.abs(y - ey);
    return this.diagonal
      ? Math.max(dx, dy)
      : dx + dy;
  }

  _key(x, y) { return `${x},${y}`; }

  _isWalkable(x, y, canTraverse = null) {
    if (!(x >= 0 && y >= 0 && x < this.cols && y < this.rows)) return false;
    const tile = this.grid[y][x];
    return tile === 0 || tile === 4 || canTraverse?.(x, y) === true;
  }

  _neighbors(x, y, canTraverse = null) {
    const dirs4 = [[0,-1],[1,0],[0,1],[-1,0]];
    const dirs8 = [...dirs4, [-1,-1],[1,-1],[-1,1],[1,1]];
    const dirs  = this.diagonal ? dirs8 : dirs4;
    return dirs
      .map(([dx, dy]) => [x + dx, y + dy])
      .filter(([nx, ny]) => this._isWalkable(nx, ny, canTraverse));
  }

  /**
   * Відновити шлях та конвертувати в піксельні координати (центри тайлів).
   */
  _reconstruct(cameFrom, x, y) {
    const tiles = [];
    let cur = { x, y };
    while (cameFrom.has(this._key(cur.x, cur.y))) {
      tiles.unshift(cur);
      cur = cameFrom.get(this._key(cur.x, cur.y));
    }
    tiles.unshift(cur);

    // Конвертуємо тайли → пікселі (центр тайлу)
    const pixels = tiles.map(({ x, y }) => ({
      x: x * this.tileSize + this.tileSize / 2,
      y: y * this.tileSize + this.tileSize / 2,
    }));

    return this._smooth(pixels);
  }

  /**
   * Path smoothing: видаляємо зайві вузли якщо три точки колінеарні.
   * Зменшує кількість вузлів і робить рух плавнішим.
   */
  _smooth(path) {
    if (path.length <= 2) return path;
    const result = [path[0]];
    for (let i = 1; i < path.length - 1; i++) {
      const prev = result[result.length - 1];
      const cur  = path[i];
      const next = path[i + 1];
      // Кросс-добуток — якщо не 0, значить поворот
      const cross = (cur.x - prev.x) * (next.y - prev.y)
                  - (cur.y - prev.y) * (next.x - prev.x);
      if (Math.abs(cross) > 1e-6) {
        result.push(cur);
      }
    }
    result.push(path[path.length - 1]);
    return result;
  }
}

// ─────────────────────────────────────────────
//  MinHeap — пріоритетна черга для A*
// ─────────────────────────────────────────────

class MinHeap {
  constructor() { this._data = []; }

  push(node) {
    this._data.push(node);
    this._bubbleUp(this._data.length - 1);
  }

  pop() {
    const top  = this._data[0];
    const last = this._data.pop();
    if (this._data.length > 0) {
      this._data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  isEmpty() { return this._data.length === 0; }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._data[parent].f <= this._data[i].f) break;
      [this._data[parent], this._data[i]] = [this._data[i], this._data[parent]];
      i = parent;
    }
  }

  _sinkDown(i) {
    const n = this._data.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this._data[l].f < this._data[smallest].f) smallest = l;
      if (r < n && this._data[r].f < this._data[smallest].f) smallest = r;
      if (smallest === i) break;
      [this._data[smallest], this._data[i]] = [this._data[i], this._data[smallest]];
      i = smallest;
    }
  }
}

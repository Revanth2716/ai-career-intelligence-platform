/**
 * Generic binary min-heap (priority queue).
 * Used for O(n log k) top-k selection in BM25 search and hybrid ranking.
 */
export class MinHeap<T> {
  private items: T[] = [];

  constructor(private compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(item: T): void {
    this.items.push(item);
    this.siftUp(this.items.length - 1);
  }

  pop(): T | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last !== undefined) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  /** Push, then keep only the k smallest — classic bounded top-k pattern. */
  pushBounded(item: T, k: number): void {
    this.push(item);
    if (this.size > k) this.pop();
  }

  /** Drain in ascending order (heapsort). */
  drain(): T[] {
    const out: T[] = [];
    while (this.size > 0) {
      const v = this.pop();
      if (v !== undefined) out.push(v);
    }
    return out;
  }

  private siftUp(i: number): void {
    const item = this.items[i];
    if (item === undefined) return;
    while (i > 0) {
      const parentIdx = (i - 1) >> 1;
      const parent = this.items[parentIdx];
      if (parent === undefined || this.compare(item, parent) >= 0) break;
      this.items[i] = parent;
      this.items[parentIdx] = item;
      i = parentIdx;
    }
  }

  private siftDown(i: number): void {
    const n = this.items.length;
     
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      const smallestItem = this.items[smallest];
      const leftItem = this.items[left];
      const rightItem = this.items[right];
      if (left < n && leftItem !== undefined && smallestItem !== undefined && this.compare(leftItem, smallestItem) < 0) {
        smallest = left;
      }
      const smallestNow = this.items[smallest];
      if (right < n && rightItem !== undefined && smallestNow !== undefined && this.compare(rightItem, smallestNow) < 0) {
        smallest = right;
      }
      if (smallest === i) break;
      const tmp = this.items[i];
      const swap = this.items[smallest];
      if (tmp === undefined || swap === undefined) break;
      this.items[i] = swap;
      this.items[smallest] = tmp;
      i = smallest;
    }
  }
}

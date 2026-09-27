import { logger } from '../lib/logger.js';
import { queueDepth, queueJobDuration } from '../observability/metrics.js';

/**
 * In-process background task queue.
 *
 * Design:
 *  - FIFO with a bounded concurrency pool (default 2 workers)
 *  - handlers registered by name; payloads are JSON-serialisable
 *  - failures retry with exponential backoff + jitter (default 3 attempts)
 *  - durable enough for this scope: tasks are executed from an array drained
 *    by the pool; the *result* of the work (entity status) is durable in
 *    Postgres, so a crash mid-task leaves an entity in PENDING/RUNNING which
 *    the API surfaces honestly (a swap to BullMQ would add full durability)
 *  - queue depth + job duration exported to Prometheus
 */

export type TaskHandler = (payload: Record<string, unknown>) => Promise<void>;

interface QueuedTask {
  name: string;
  payload: Record<string, unknown>;
  enqueuedAt: number;
}

interface RegisteredTask {
  handler: TaskHandler;
  attempts: number;
  baseDelayMs: number;
}

export class TaskQueue {
  private tasks: QueuedTask[] = [];
  private handlers = new Map<string, RegisteredTask>();
  private active = 0;
  private stopped = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private concurrency = 2,
    private pollIntervalMs = 100,
  ) {}

  register(name: string, handler: TaskHandler, opts?: { attempts?: number; baseDelayMs?: number }): void {
    this.handlers.set(name, {
      handler,
      attempts: opts?.attempts ?? 3,
      baseDelayMs: opts?.baseDelayMs ?? 500,
    });
  }

  enqueue(name: string, payload: Record<string, unknown> = {}): void {
    if (!this.handlers.has(name)) {
      throw new Error(`No handler registered for task "${name}"`);
    }
    this.tasks.push({ name, payload, enqueuedAt: Date.now() });
    queueDepth.set(this.tasks.length);
    this.kick();
  }

  get depth(): number {
    return this.tasks.length;
  }

  /** Starts the poll loop (called once at boot). */
  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => this.kick(), this.pollIntervalMs);
    this.timer.unref();
  }

  /** Stops accepting work and waits (briefly) for in-flight tasks. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    const deadline = Date.now() + 5_000;
    while (this.active > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private kick(): void {
    if (this.stopped) return;
    while (this.active < this.concurrency && this.tasks.length > 0) {
      const task = this.tasks.shift();
      if (task === undefined) break;
      queueDepth.set(this.tasks.length);
      void this.run(task);
    }
  }

  private async run(task: QueuedTask): Promise<void> {
    const registered = this.handlers.get(task.name);
    if (registered === undefined) return;
    this.active += 1;
    const started = Date.now();
    try {
      await registered.handler(task.payload);
      queueJobDuration.observe({ handler: task.name }, Date.now() - started);
    } catch (err) {
      const attempt = (task.payload['__attempt'] as number | undefined) ?? 1;
      logger.warn({ task: task.name, attempt, err }, 'task_failed');
      if (attempt < registered.attempts) {
        // Exponential backoff with jitter; re-queue at the front? No — FIFO
        // fairness: push to the back; delay simulated by scheduling.
        const delay = registered.baseDelayMs * 2 ** (attempt - 1) + Math.random() * 250;
        setTimeout(() => {
          if (!this.stopped) {
            this.tasks.push({ ...task, payload: { ...task.payload, __attempt: attempt + 1 } });
            queueDepth.set(this.tasks.length);
            this.kick();
          }
        }, delay);
      } else {
        logger.error({ task: task.name, err }, 'task_dead_letter');
        await this.onDeadLetter(task, err);
      }
    } finally {
      this.active -= 1;
      this.kick();
    }
  }

  /** Overridden by registration: mark the owning entity FAILED. */
  private async onDeadLetter(task: QueuedTask, err: unknown): Promise<void> {
    const handler = this.deadLetterHandler;
    if (handler !== undefined) await handler(task, err);
  }

  private deadLetterHandler?: (task: QueuedTask, err: unknown) => Promise<void>;

  setDeadLetterHandler(handler: (task: QueuedTask, err: unknown) => Promise<void>): void {
    this.deadLetterHandler = handler;
  }
}

/** App-wide singleton queue. */
export const queue = new TaskQueue(2);

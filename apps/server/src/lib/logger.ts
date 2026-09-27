import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Structured JSON logger. In dev, pretty-printed for humans.
 * Every request gets a `requestId` (see middleware/request-context.ts) and
 * passes it here so all log lines of one request correlate.
 */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  base: { service: 'career-server' },
  ...(env.LOG_PRETTY
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
    : {}),
});

export type Logger = typeof logger;
export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}

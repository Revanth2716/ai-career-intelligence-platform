import client from 'prom-client';
import type { RequestHandler } from 'express';

/**
 * Prometheus metrics (prom-client), exposed at GET /metrics.
 *  - career_http_request_duration_ms histogram by route/method/status
 *  - career_http_requests_total counter
 *  - career_cache_{hits,misses,evictions}_total counters
 *  - career_llm_tokens_total / career_llm_cost_usd_total by purpose
 *  - career_queue_depth gauge, career_queue_job_duration_ms histogram
 */
export const registry = new client.Registry();

client.collectDefaultMetrics({ register: registry, prefix: 'career_' });

export const httpRequestDuration = new client.Histogram({
  name: 'career_http_request_duration_ms',
  help: 'HTTP request duration in ms',
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  labelNames: ['route', 'method', 'status'],
  registers: [registry],
});

export const httpRequestsTotal = new client.Counter({
  name: 'career_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['route', 'method', 'status'],
  registers: [registry],
});

export const cacheHits = new client.Counter({
  name: 'career_cache_hits_total',
  help: 'Cache hits',
  registers: [registry],
});

export const cacheMisses = new client.Counter({
  name: 'career_cache_misses_total',
  help: 'Cache misses',
  registers: [registry],
});

export const cacheEvictions = new client.Counter({
  name: 'career_cache_evictions_total',
  help: 'Cache evictions',
  registers: [registry],
});

export const llmTokens = new client.Counter({
  name: 'career_llm_tokens_total',
  help: 'LLM tokens consumed',
  labelNames: ['purpose', 'direction'],
  registers: [registry],
});

export const llmCostUsd = new client.Counter({
  name: 'career_llm_cost_usd_total',
  help: 'Estimated LLM cost in USD',
  labelNames: ['purpose'],
  registers: [registry],
});

export const queueDepth = new client.Gauge({
  name: 'career_queue_depth',
  help: 'Pending background jobs',
  registers: [registry],
});

export const queueJobDuration = new client.Histogram({
  name: 'career_queue_job_duration_ms',
  help: 'Background job duration in ms',
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  labelNames: ['handler'],
  registers: [registry],
});

/** Express middleware recording duration + status per request. */
export function metricsMiddleware(): RequestHandler {
  return (req, res, next) => {
    res.on('finish', () => {
      // Route label: prefer the matched route pattern to bound cardinality.
      const route = req.route?.path ?? req.path.split('/').slice(0, 3).join('/');
      const labels = { route, method: req.method, status: String(res.statusCode) };
      const start = res.locals['start'] as number | undefined;
      const durationMs = start === undefined ? 0 : Date.now() - start;
      httpRequestDuration.observe(labels, durationMs);
      httpRequestsTotal.inc(labels, 1);
    });
    next();
  };
}

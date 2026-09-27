import type { Request } from 'express';
import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';

/**
 * Declarative request validation. Schemas come from @career/shared so the
 * client validates the same contracts. Invalid requests are rejected with a
 * 422 and field-level details before any handler logic runs.
 */
export function validate<S extends ZodTypeAny>(schemas: {
  body?: S;
  query?: S;
  params?: S;
}): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.body !== undefined) req.body = schemas.body.parse(req.body);
      if (schemas.query !== undefined) {
        // Express 5 makes req.query a getter-only proxy; parsed values are
        // exposed on a narrowed copy instead of overwriting req.query.
        const parsed = schemas.query.parse(req.query) as Record<string, unknown>;
        (req as Request & { validatedQuery?: Record<string, unknown> }).validatedQuery = parsed;
      }
      if (schemas.params !== undefined) {
        (req as Request & { validatedParams?: Record<string, unknown> }).validatedParams =
          schemas.params.parse(req.params);
      }
      next();
    } catch (err) {
      next(err); // ZodError -> 422 via the global handler
    }
  };
}

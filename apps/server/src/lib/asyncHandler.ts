import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps async route handlers so rejections reach the global error handler
 * instead of crashing or hanging the request.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

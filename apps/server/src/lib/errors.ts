/**
 * Domain error hierarchy. Routes throw these; the single global error handler
 * maps them to the uniform API error envelope. Nothing else should set
 * HTTP status codes ad hoc.
 */

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, statusCode: number, code: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request', details?: unknown) {
    super(message, 422, 'VALIDATION_ERROR', details);
  }
}

export class AuthError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHENTICATED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Not allowed') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(entity = 'Resource') {
    super(`${entity} not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409, 'CONFLICT');
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super('Too many requests', 429, 'RATE_LIMITED');
    this.retryAfterSec = retryAfterSec;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: unknown) {
    super(message, 400, 'BAD_REQUEST', details);
  }
}

export class UpstreamError extends AppError {
  constructor(message = 'Upstream service failed') {
    super(message, 502, 'UPSTREAM_ERROR');
  }
}

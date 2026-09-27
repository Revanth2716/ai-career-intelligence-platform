import { prisma } from '../../lib/prisma.js';
import { NotFoundError, ForbiddenError } from '../../lib/errors.js';

/**
 * Per-row authorization: fetch the row scoped by owner and translate
 * "missing" into 404 (do not leak existence to non-owners).
 */
export async function findOwnedOr404<T extends { userId: string }>(
  finder: () => Promise<T | null>,
  userId: string,
): Promise<T> {
  const row = await finder();
  if (row === null) throw new NotFoundError('Resource');
  if (row.userId !== userId) throw new ForbiddenError('You do not own this resource');
  return row;
}

export { prisma };

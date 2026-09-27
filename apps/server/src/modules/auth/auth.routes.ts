import { Router } from 'express';
import { AuthUserSchema } from '@career/shared';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { clientIp } from '../../middleware/request-context.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { LoginSchema, RegisterSchema } from '@career/shared';
import { AuthService } from './auth.service.js';

const service = new AuthService();

export const authRouter = Router();

authRouter.post(
  '/register',
  validate({ body: RegisterSchema }),
  asyncHandler(async (req, res) => {
    const tokens = await service.register(req.body, clientIp(req));
    res.status(201).json(tokens);
  }),
);

authRouter.post(
  '/login',
  validate({ body: LoginSchema }),
  asyncHandler(async (req, res) => {
    const tokens = await service.login(req.body, clientIp(req));
    res.json(tokens);
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const body = req.body as { refreshToken?: unknown };
    if (typeof body?.refreshToken !== 'string' || body.refreshToken.length === 0) {
      res.status(422).json({ error: 'refreshToken required', code: 'VALIDATION_ERROR' });
      return;
    }
    const result = await service.refresh(body.refreshToken, clientIp(req));
    res.json(result);
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const body = req.body as { refreshToken?: unknown };
    if (typeof body?.refreshToken === 'string') {
      await service.logout(body.refreshToken, clientIp(req));
    }
    res.status(204).send();
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await service.me(req.auth!.userId);
    res.json(AuthUserSchema.parse({ ...user, createdAt: user.createdAt.toISOString() }));
  }),
);

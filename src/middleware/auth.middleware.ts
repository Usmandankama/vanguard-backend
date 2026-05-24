import { Elysia } from 'elysia';
import { User } from '../model';
import { verifyJwt } from '../utils/jwt.utils';

async function validateToken(token: string): Promise<User | null> {
  const payload = verifyJwt(token);
  if (!payload) return null;
  return User.findByPk(payload.userId);
}

export const authMiddleware = new Elysia({ name: 'auth' })
  .derive(async ({ request, set }) => {
    const authHeader = request.headers.get('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      set.status = 401;
      throw new Error('Unauthorized: Missing or invalid token');
    }

    const token = authHeader.substring(7);

    try {
      const user = await validateToken(token);
      if (!user) {
        set.status = 401;
        throw new Error('Unauthorized: Invalid token');
      }

      return {
        user,
        userId: user.id
      };
    } catch {
      set.status = 401;
      throw new Error('Unauthorized: Token validation failed');
    }
  });

export const optionalAuth = new Elysia({ name: 'optional-auth' })
  .derive(async ({ request }) => {
    const authHeader = request.headers.get('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { user: null, userId: null };
    }

    const token = authHeader.substring(7);

    try {
      const user = await validateToken(token);
      return {
        user,
        userId: user?.id || null
      };
    } catch {
      return { user: null, userId: null };
    }
  });

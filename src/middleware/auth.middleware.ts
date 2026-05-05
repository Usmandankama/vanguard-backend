import { Elysia } from 'elysia';
import { User } from '../model';

export const authMiddleware = new Elysia({ name: 'auth' })
  .derive(async ({ request, set }) => {
    // Get Authorization header
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      set.status = 401;
      throw new Error('Unauthorized: Missing or invalid token');
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // For now, we'll use a simple token-based auth
    // In production, you'd want to use JWT or similar
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
    } catch (error) {
      set.status = 401;
      throw new Error('Unauthorized: Token validation failed');
    }
  });

// Simple token validation (in production, use JWT)
async function validateToken(token: string): Promise<User | null> {
  try {
    // For demo purposes, we'll treat the token as a user ID
    // In production, you'd decode and verify a JWT token
    const userId = token;
    return await User.findByPk(userId);
  } catch (error) {
    return null;
  }
}

// Optional auth for routes that don't require authentication
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
    } catch (error) {
      return { user: null, userId: null };
    }
  });

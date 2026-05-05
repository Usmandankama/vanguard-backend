import { Elysia, t } from 'elysia';
import { AuthController } from '../controllers/auth.controller';

export const authRoutes = new Elysia({ prefix: '/api/auth' })
  .post('/signup', AuthController.signup, {
    body: t.Object({
      name: t.String({ minLength: 2, error: 'Name must be at least 2 characters' }),
      email: t.String({ format: 'email', error: 'Invalid email address' }),
      password: t.String({ minLength: 6, error: 'Password must be at least 6 characters' }),
      role: t.Union([t.Literal('victim'), t.Literal('volunteer')], { error: 'Role must be victim or volunteer' })
    })
  })
  .post('/signin', AuthController.signin, {
    body: t.Object({
      email: t.String({ format: 'email', error: 'Invalid email address' }),
      password: t.String({ minLength: 1, error: 'Password is required' })
    })
  });
import { User } from '../model/users/users.model';
import { signJwt } from '../utils/jwt.utils';
import bcrypt from 'bcryptjs';
import { Sequelize } from 'sequelize';

export class AuthController {
  static async signup({ body, set }: any) {
    try {
      const { name, email, password, role, latitude, longitude } = body;

      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        set.status = 400;
        return { success: false, error: 'User with this email already exists' };
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      // Build last_location only if coords were provided
      const locationData = (latitude != null && longitude != null)
        ? {
            last_location: Sequelize.fn(
              'ST_SetSRID',
              Sequelize.fn('ST_MakePoint', longitude, latitude),
              4326
            )
          }
        : {};

      const user = await User.create({
        name,
        email,
        password: hashedPassword,
        role,
        ...locationData,
      });

      const token = signJwt({
        userId: user.id,
        role: user.role,
        is_verified: user.is_verified,
      });

      return {
        success: true,
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            is_verified: user.is_verified,
          },
          token,
        },
      };
    } catch (error) {
      console.error('Signup Error:', error);
      set.status = 500;
      return { success: false, error: 'Internal Server Error during signup' };
    }
  }

  // signin unchanged
  static async signin({ body, set }: any) {
    try {
      const { email, password } = body;

      const user = await User.findOne({ where: { email } });
      if (!user) {
        set.status = 401;
        return { success: false, error: 'Invalid credentials' };
      }

      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        set.status = 401;
        return { success: false, error: 'Invalid credentials' };
      }

      const token = signJwt({
        userId: user.id,
        role: user.role,
        is_verified: user.is_verified,
      });

      return {
        success: true,
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            is_verified: user.is_verified,
          },
          token,
        },
      };
    } catch (error) {
      console.error('Signin Error:', error);
      set.status = 500;
      return { success: false, error: 'Internal Server Error during signin' };
    }
  }
}
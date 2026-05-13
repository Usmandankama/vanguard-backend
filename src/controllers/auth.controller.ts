import { User } from '../model/users/users.model';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET || 'vanguard_super_secret_dev_key';

export class AuthController {
  static async signup({ body, set }: any) {
    try {
      const { name, email, password, role } = body;

      // 1. Check for existing user
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        set.status = 400;
        return { success: false, error: 'User with this email already exists' };
      }

      // 2. Hash Password safely
      const hashedPassword = await bcrypt.hash(password, 10);

      // 3. Create User (is_verified defaults to false automatically)
      const user = await User.create({
        name,
        email,
        password: hashedPassword,
        role
      });

      // 4. Generate JWT
      const token = jwt.sign(
        { userId: user.id, role: user.role, is_verified: user.is_verified },
        JWT_SECRET,
        { expiresIn: '30d' } // 30 days for mobile app convenience
      );

      return {
        success: true,
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            is_verified: user.is_verified
          },
          token
        }
      };
    } catch (error) {
      console.error('Signup Error:', error);
      set.status = 500;
      return { success: false, error: 'Internal Server Error during signup' };
    }
  }

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

      const token = jwt.sign(
        { userId: user.id, role: user.role, is_verified: user.is_verified },
        JWT_SECRET,
        { expiresIn: '30d' }
      );

      return {
        success: true,
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            is_verified: user.is_verified
          },
          token
        }
      };  
    } catch (error) {
      console.error('Signin Error:', error);
      set.status = 500;
      return { success: false, error: 'Internal Server Error during signin' };
    }
  }
}
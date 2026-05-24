import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'vanguard_super_secret_dev_key';

export interface JwtPayload {
  userId: string;
  role: string;
  is_verified: boolean;
}

export function verifyJwt(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

export function signJwt(payload: JwtPayload, expiresIn: string | number = '30d'): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

import { User } from '../model';

export class UserService {
  static async getUserById(userId: string): Promise<{
    success: boolean;
    data?: { id: string; name: string | null; email: string; role: string };
    error?: string;
  }> {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        return { success: false, error: 'User not found' };
      }
      return {
        success: true,
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      };
    } catch (error: any) {
      console.error('Error getting user by ID:', error);
      return { success: false, error: 'Failed to get user' };
    }
  }

  static async updateUserLocation(
    userId: string,
    location: {
      latitude: number;
      longitude: number;
      accuracy?: number | null;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      // Update last_location with PostGIS POINT format
      await user.update({
        last_location: {
          type: 'Point',
          coordinates: [location.longitude, location.latitude]
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error('Error updating user location:', error);
      return { success: false, error: 'Failed to update user location' };
    }
  }

  static async getUserLocation(userId: string): Promise<{
    success: boolean;
    data?: { latitude: number; longitude: number };
    error?: string;
  }> {
    try {
      const user = await User.findByPk(userId);
      if (!user || !user.last_location) {
        return { success: false, error: 'User location not found' };
      }

      // PostGIS GeoJSON format: { type: 'Point', coordinates: [longitude, latitude] }
      const coordinates = user.last_location.coordinates;
      return {
        success: true,
        data: {
          latitude: coordinates[1],
          longitude: coordinates[0]
        }
      };
    } catch (error: any) {
      console.error('Error getting user location:', error);
      return { success: false, error: 'Failed to get user location' };
    }
  }

  static async validateUserType(
    userId: string,
    expectedType: 'victim' | 'volunteer'
  ): Promise<{ isValid: boolean; error?: string }> {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        return { isValid: false, error: 'User not found' };
      }

      if (user.role !== expectedType) {
        return {
          isValid: false,
          error: `User is not a ${expectedType}`
        };
      }

      return { isValid: true };
    } catch (error: any) {
      console.error('Error validating user type:', error);
      return { isValid: false, error: 'Failed to validate user type' };
    }
  }
}

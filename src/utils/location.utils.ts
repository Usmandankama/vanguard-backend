import { DatabaseService } from '../services/database.service';
import { QueryTypes } from 'sequelize';

export class LocationUtils {
  
  /**
   * Calculate distance between two points using Haversine formula (Local Math)
   */
  static calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  /**
   * Find nearby volunteers using PostGIS
   */
  static async findNearbyVolunteers(
    latitude: number,
    longitude: number,
    radiusMeters: number = 5000,
    limit: number = 20
  ) {
    try {
      const sequelize = DatabaseService.getPrimary(); // <-- V2 Architecture fix
      const query = `
        SELECT 
          id, 
          name,
          ST_X(last_location::geometry) as longitude,
          ST_Y(last_location::geometry) as latitude,
          ST_Distance(
            last_location::geography,
            ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography
          ) as distance
         FROM users 
         WHERE role = 'volunteer' -- Fixed 'type' to 'role' to match our V2 schema
         AND last_location IS NOT NULL
         AND ST_DWithin(
           last_location::geography,
           ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography,
           :radiusMeters
         )
         ORDER BY distance
         LIMIT :limit
      `;

      const results = await sequelize.query(query, {
        replacements: { longitude, latitude, radiusMeters, limit }, // Using safer named parameters
        type: QueryTypes.SELECT
      });

      return results.map((volunteer: any) => ({
        id: volunteer.id,
        name: volunteer.name,
        distance: parseFloat(volunteer.distance),
        location: {
          latitude: parseFloat(volunteer.latitude),
          longitude: parseFloat(volunteer.longitude)
        }
      }));
    } catch (error) {
      console.error('Error finding nearby volunteers:', error);
      return [];
    }
  }

  /**
   * Find nearby SOS alerts for a volunteer
   */
  static async findNearbySOSAlerts(
    latitude: number,
    longitude: number,
    radiusMeters: number = 10000,
    limit: number = 10
  ) {
    try {
      const sequelize = DatabaseService.getPrimary();
      
      // FIXED: Safely interacts with true PostGIS geometry instead of raw JSON
      const query = `
        SELECT 
          sa.id,
          sa.victim_id,
          sa.type,
          sa.description,
          sa.status,
          ST_X(sa.location::geometry) as longitude,
          ST_Y(sa.location::geometry) as latitude,
          sa."createdAt",
          u.name as victim_name,
          ST_Distance(
            sa.location::geography,
            ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography
          ) as distance
         FROM sos_alerts sa
         LEFT JOIN users u ON sa.victim_id = u.id
         WHERE sa.status IN ('pending', 'responding')
         AND ST_DWithin(
           sa.location::geography,
           ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography,
           :radiusMeters
         )
         ORDER BY distance, sa."createdAt" DESC
         LIMIT :limit
      `;

      const results = await sequelize.query(query, {
        replacements: { longitude, latitude, radiusMeters, limit },
        type: QueryTypes.SELECT
      });

      return results.map((alert: any) => ({
        id: alert.id,
        victimId: alert.victim_id,
        victimName: alert.victim_name,
        type: alert.type,
        description: alert.description,
        status: alert.status,
        distance: parseFloat(alert.distance),
        location: {
          latitude: parseFloat(alert.latitude),
          longitude: parseFloat(alert.longitude)
        },
        createdAt: alert.createdAt
      }));
    } catch (error) {
      console.error('Error finding nearby SOS alerts:', error);
      return [];
    }
  }

  /**
   * Update user location in PostGIS format
   */
  static async updateUserLocation(userId: string, latitude: number, longitude: number): Promise<void> {
    try {
      const sequelize = DatabaseService.getPrimary();
      await sequelize.query(
        `UPDATE users 
         SET last_location = ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326), 
             "updatedAt" = NOW() 
         WHERE id = :userId`,
        {
          replacements: { longitude, latitude, userId },
          type: QueryTypes.UPDATE
        }
      );
    } catch (error) {
      console.error('Error updating user location:', error);
      throw error;
    }
  }

  /**
   * Get user location from PostGIS
   */
  static async getUserLocation(userId: string) {
    try {
      const sequelize = DatabaseService.getPrimary();
      const result = await sequelize.query(
        `SELECT 
          ST_X(last_location::geometry) as longitude,
          ST_Y(last_location::geometry) as latitude,
          "updatedAt"
         FROM users 
         WHERE id = :userId AND last_location IS NOT NULL`,
        {
          replacements: { userId },
          type: QueryTypes.SELECT
        }
      );

      if (result.length === 0) return null;

      const location = result[0] as any;
      return {
        latitude: parseFloat(location.latitude),
        longitude: parseFloat(location.longitude),
        timestamp: location.updatedAt
      };
    } catch (error) {
      console.error('Error getting user location:', error);
      return null;
    }
  }

  static validateCoordinates(latitude: number, longitude: number): boolean {
    return (
      latitude >= -90 && latitude <= 90 &&
      longitude >= -180 && longitude <= 180 &&
      !isNaN(latitude) && !isNaN(longitude)
    );
  }

  static formatDistance(meters: number): string {
    return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`;
  }
}
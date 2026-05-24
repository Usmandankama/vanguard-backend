import { DatabaseService } from '../services/database.service';
import { QueryTypes } from 'sequelize';

export class LocationUtils {

  /**
   * Haversine formula — straight-line distance between two coordinates.
   * Used for response-time calculations and distance display.
   * For spatial filtering, always use PostGIS ST_DWithin instead —
   * it uses a proper spheroid and is index-accelerated.
   */
  static calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Find nearby VERIFIED volunteers using PostGIS.
   *
   * Fix: added `is_verified = true` filter. Previously this was enforced in
   * SOSController's inline query but missing here, meaning any code path that
   * called LocationUtils directly (e.g. future scheduled re-dispatch) could
   * return unverified volunteers. The two code paths now agree.
   */
  static async findNearbyVolunteers(
    latitude: number,
    longitude: number,
    radiusMeters: number = 5000,
    limit: number = 20
  ) {
    try {
      const sequelize = DatabaseService.getPrimary();
      const query = `
        SELECT
          id,
          name,
          ST_X(last_location::geometry)  AS longitude,
          ST_Y(last_location::geometry)  AS latitude,
          ST_Distance(
            last_location::geography,
            ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography
          ) AS distance
        FROM users
        WHERE role = 'volunteer'
          AND is_verified = true
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
        replacements: { longitude, latitude, radiusMeters, limit },
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
   * Find nearby active SOS alerts for a volunteer's feed.
   * Returns alerts in 'pending' or 'responding' status within radius.
   */
  static async findNearbySOSAlerts(
    latitude: number,
    longitude: number,
    radiusMeters: number = 10000,
    limit: number = 10
  ) {
    try {
      const sequelize = DatabaseService.getPrimary();
      const query = `
        SELECT
          sa.id,
          sa.victim_id,
          sa.type,
          sa.description,
          sa.status,
          sa."createdAt",
          ST_X(sa.location::geometry) AS longitude,
          ST_Y(sa.location::geometry) AS latitude,
          u.name AS victim_name,
          ST_Distance(
            sa.location::geography,
            ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography
          ) AS distance
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
        victim_id: alert.victim_id,
        victim_name: alert.victim_name,
        type: alert.type,
        description: alert.description,
        status: alert.status,
        distance: parseFloat(alert.distance),
        location: {
          latitude: parseFloat(alert.latitude),
          longitude: parseFloat(alert.longitude),
          timestamp: alert.createdAt
        },
        created_at: alert.createdAt
      }));
    } catch (error) {
      console.error('Error finding nearby SOS alerts:', error);
      return [];
    }
  }

  /**
   * Persist a user's live location to PostGIS.
   * Called on every location update from the Flutter app.
   */
  static async updateUserLocation(
    userId: string,
    latitude: number,
    longitude: number
  ): Promise<void> {
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
   * Read a user's last known location from PostGIS.
   */
  static async getUserLocation(userId: string) {
    try {
      const sequelize = DatabaseService.getPrimary();
      const result = await sequelize.query(
        `SELECT
           ST_X(last_location::geometry) AS longitude,
           ST_Y(last_location::geometry) AS latitude,
           "updatedAt"
         FROM users
         WHERE id = :userId AND last_location IS NOT NULL`,
        {
          replacements: { userId },
          type: QueryTypes.SELECT
        }
      );

      if (result.length === 0) return null;

      const loc = result[0] as any;
      return {
        latitude: parseFloat(loc.latitude),
        longitude: parseFloat(loc.longitude),
        timestamp: loc.updatedAt
      };
    } catch (error) {
      console.error('Error getting user location:', error);
      return null;
    }
  }

  /**
   * Validate that coordinates are within legal geographic bounds.
   * Call this before every PostGIS query — passing NaN or out-of-range
   * values to ST_MakePoint does not throw; it silently returns bad geometry.
   */
  static validateCoordinates(latitude: number, longitude: number): boolean {
    return (
      !isNaN(latitude) &&
      !isNaN(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    );
  }

  static formatDistance(meters: number): string {
    return meters < 1000
      ? `${Math.round(meters)}m`
      : `${(meters / 1000).toFixed(1)}km`;
  }
}
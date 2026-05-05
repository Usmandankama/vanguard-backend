import { SOSAlert, User } from '../model';
import { DatabaseService } from '../services/database.service';
import { WebSocketService } from '../services/websocket.service'; // <--- NEW IMPORT

export class SOSController {
  
  // 1. Trigger a new Emergency
  static async createAlert({ body, set }: any) {
    try {
      const { victim_id, type, description, metadata, latitude, longitude } = body;

      // Ensure victim exists
      const victim = await User.findByPk(victim_id);
      if (!victim) {
        set.status = 404;
        return { success: false, error: 'Victim not found' };
      }

      // Create the SOS Record
      const alert = await SOSAlert.create({
        victim_id,
        type,
        description,
        metadata: metadata || {}, 
        // PostGIS requires coordinates in [Longitude, Latitude] format
        location: { type: 'Point', coordinates: [longitude, latitude] },
        status: 'pending'
      });

      // --- THE GOLDEN HOUR DISPATCH LOGIC ---
      // Find VERIFIED volunteers within 5km (5000 meters)
      const query = `
        SELECT id, name, "last_location"
        FROM users
        WHERE role = 'volunteer' 
        AND is_verified = true
        AND ST_DWithin(
          last_location::geography, 
          ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography, 
          5000
        );
      `;

      const nearbyVolunteers = await DatabaseService.executeReadQuery(query, {
        longitude,
        latitude
      });

      // --- NEW WEBSOCKET DISPATCH LOGIC ---
      
      // Extract just the IDs of the nearby volunteers
      const volunteerIds = nearbyVolunteers.map((v: any) => v.id);

      // 1. Dispatch full details strictly to the verified volunteers
      WebSocketService.dispatchToVolunteers(volunteerIds, {
        type: 'NEW_SOS_DISPATCH',
        data: alert
      });

      // 2. Broadcast anonymized blip to the public Community Map (Dad's feature)
      WebSocketService.broadcastToCommunity({
        type: 'COMMUNITY_MAP_UPDATE',
        data: {
          id: alert.id,
          type: alert.type,
          latitude,
          longitude
        } // Notice: No names, no exact descriptions, just type and location.
      });

      return {
        success: true,
        data: {
          alert,
          dispatched_to: nearbyVolunteers.length,
          message: `SOS broadcasted to ${nearbyVolunteers.length} nearby volunteers.`
        }
      };

    } catch (error) {
      console.error('SOS Creation Error:', error);
      set.status = 500;
      return { success: false, error: 'Failed to create SOS Alert' };
    }
  }

  // 2. The "Community Map" Feed (For Dad's Feature)
  static async getActiveAlerts({ query, set }: any) {
    try {
      // If the app passes the user's location, we only show alerts within 10km
      const { lat, lng } = query;

      let sql = `
        SELECT id, type, status, location, "createdAt"
        FROM sos_alerts
        WHERE status IN ('pending', 'responding')
      `;

      const replacements: any = {};

      if (lat && lng) {
        sql += ` AND ST_DWithin(
          location::geography, 
          ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, 
          10000
        )`;
        replacements.lat = parseFloat(lat);
        replacements.lng = parseFloat(lng);
      }

      sql += ` ORDER BY "createdAt" DESC LIMIT 50;`;

      const activeAlerts = await DatabaseService.executeReadQuery(sql, replacements);

      return {
        success: true,
        data: activeAlerts // Notice we DO NOT send victim names or phone numbers here. Privacy first.
      };

    } catch (error) {
      console.error('Fetch Alerts Error:', error);
      set.status = 500;
      return { success: false, error: 'Failed to fetch active alerts' };
    }
  }
}
import { SOSAlert, User } from '../models';
import { Op } from 'sequelize';
import { LocationUtils } from '../utils/location.utils';
import { redisService } from './redis.service';
import { UserService } from './user.service';

/**
 * SOS Service - Handles all SOS alert-related business logic
 * This service manages the lifecycle of SOS alerts from creation to resolution,
 * including volunteer matching and proximity calculations.
 */
export class SOSService {
  /**
   * Create a new SOS alert
   * @param sosData SOS alert creation data
   * @returns Created SOS alert or error
   */
  static async createSOSAlert(sosData: {
    victim_id: string;
    type: string;
    description: string;
    location: {
      latitude: number;
      longitude: number;
      accuracy?: number | null;
      timestamp: string;
    };
  }): Promise<{
    success: boolean;
    data?: {
      id: string;
      victim_id: string;
      victim_name: string | null;
      type: string;
      description: string;
      location: any;
      status: string;
      created_at: string;
      responded_at: string | null;
      responder_id: string | null;
      responder_name: string | null;
      distance: number | null;
    };
    error?: string;
    status?: number;
  }> {
    try {
      // Validate input data
      const validationResult = await this.validateSOSRequest(sosData);
      if (!validationResult.isValid) {
        return {
          success: false,
          error: validationResult.error,
          status: 400
        };
      }

      // Validate location coordinates
      if (!LocationUtils.validateCoordinates(sosData.location.latitude, sosData.location.longitude)) {
        return {
          success: false,
          error: 'Invalid location coordinates provided',
          status: 400
        };
      }

      // Get victim details
      const victimResult = await UserService.getUserById(sosData.victim_id);
      if (!victimResult.success) {
        return {
          success: false,
          error: 'Victim not found',
          status: 404
        };
      }

      // Create SOS alert in database
      const sosAlert = await SOSAlert.create({
        victimId: sosData.victim_id,
        type: sosData.type,
        description: sosData.description,
        location: sosData.location,
        status: 'pending'
      });

      // Update victim's current location
      await UserService.updateUserLocation(sosData.victim_id, {
        latitude: sosData.location.latitude,
        longitude: sosData.location.longitude,
        accuracy: sosData.location.accuracy
      });

      // Cache SOS alert in Redis
      await redisService.cacheSOSAlert(sosAlert.id, {
        id: sosAlert.id,
        victim_id: sosAlert.victimId,
        victim_name: victimResult.data?.name || null,
        type: sosAlert.type,
        description: sosAlert.description,
        location: sosAlert.location,
        status: sosAlert.status,
        created_at: sosAlert.createdAt.toISOString(),
        responded_at: null,
        responder_id: null,
        responder_name: null,
        distance: null
      });

      console.log(`🚨 Created SOS alert ${sosAlert.id} for victim ${sosData.victim_id}`);

      return {
        success: true,
        data: {
          id: sosAlert.id,
          victim_id: sosAlert.victimId,
          victim_name: victimResult.data?.name || null,
          type: sosAlert.type,
          description: sosAlert.description,
          location: sosAlert.location,
          status: sosAlert.status,
          created_at: sosAlert.createdAt.toISOString(),
          responded_at: null,
          responder_id: null,
          responder_name: null,
          distance: null
        }
      };
    } catch (error: any) {
      console.error('Error creating SOS alert:', error);
      return {
        success: false,
        error: 'Failed to create SOS alert',
        status: 500
      };
    }
  }

  /**
   * Get all active SOS alerts
   * @returns List of active SOS alerts or error
   */
  static async getActiveSOSAlerts(): Promise<{
    success: boolean;
    data?: Array<{
      id: string;
      victim_id: string;
      victim_name: string | null;
      type: string;
      description: string;
      location: any;
      status: string;
      created_at: string;
      responded_at: string | null;
      responder_id: string | null;
      responder_name: string | null;
      distance: number | null;
    }>;
    error?: string;
    status?: number;
  }> {
    try {
      // Try to get from Redis cache first
      const activeSOSIds = await redisService.getActiveSOSAlerts();
      
      if (activeSOSIds.length > 0) {
        const cachedAlerts = [];
        
        for (const alertId of activeSOSIds) {
          const cachedAlert = await redisService.getCachedSOSAlert(alertId);
          if (cachedAlert && ['pending', 'responding'].includes(cachedAlert.status)) {
            cachedAlerts.push(cachedAlert);
          }
        }

        if (cachedAlerts.length > 0) {
          return {
            success: true,
            data: cachedAlerts.sort((a, b) => 
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )
          };
        }
      }

      // Fallback to database query
      const activeAlerts = await SOSAlert.findAll({
        where: {
          status: {
            [$in]: ['pending', 'responding']
          }
        },
        include: [
          {
            model: User,
            as: 'victim',
            attributes: ['id', 'name', 'type']
          }
        ],
        order: [['createdAt', 'DESC']]
      });

      const formattedAlerts = activeAlerts.map(alert => ({
        id: alert.id,
        victim_id: alert.victimId,
        victim_name: (alert as any).victim?.name || null,
        type: alert.type,
        description: alert.description,
        location: alert.location,
        status: alert.status,
        created_at: alert.createdAt.toISOString(),
        responded_at: alert.respondedAt?.toISOString() || null,
        responder_id: alert.responderId,
        responder_name: alert.responderName,
        distance: alert.distance
      }));

      // Update cache with fresh data
      for (const alert of formattedAlerts) {
        await redisService.cacheSOSAlert(alert.id, alert);
      }

      return {
        success: true,
        data: formattedAlerts
      };
    } catch (error: any) {
      console.error('Error getting active SOS alerts:', error);
      return {
        success: false,
        error: 'Failed to get active SOS alerts',
        status: 500
      };
    }
  }

  /**
   * Get specific SOS alert by ID
   * @param alertId SOS alert ID
   * @returns SOS alert details or error
   */
  static async getSOSAlert(alertId: string): Promise<{
    success: boolean;
    data?: {
      id: string;
      victim_id: string;
      victim_name: string | null;
      type: string;
      description: string;
      location: any;
      status: string;
      created_at: string;
      responded_at: string | null;
      responder_id: string | null;
      responder_name: string | null;
      distance: number | null;
    };
    error?: string;
    status?: number;
  }> {
    try {
      // Try to get from cache first
      const cachedAlert = await redisService.getCachedSOSAlert(alertId);
      if (cachedAlert) {
        return {
          success: true,
          data: cachedAlert
        };
      }

      // Get from database
      const sosAlert = await SOSAlert.findByPk(alertId, {
        include: [
          {
            model: User,
            as: 'victim',
            attributes: ['id', 'name', 'type']
          }
        ]
      });

      if (!sosAlert) {
        return {
          success: false,
          error: 'SOS alert not found',
          status: 404
        };
      }

      const alertData = {
        id: sosAlert.id,
        victim_id: sosAlert.victimId,
        victim_name: (sosAlert as any).victim?.name || null,
        type: sosAlert.type,
        description: sosAlert.description,
        location: sosAlert.location,
        status: sosAlert.status,
        created_at: sosAlert.createdAt.toISOString(),
        responded_at: sosAlert.respondedAt?.toISOString() || null,
        responder_id: sosAlert.responderId,
        responder_name: sosAlert.responderName,
        distance: sosAlert.distance
      };

      // Cache the alert data
      await redisService.cacheSOSAlert(alertId, alertData);

      return {
        success: true,
        data: alertData
      };
    } catch (error: any) {
      console.error('Error getting SOS alert:', error);
      return {
        success: false,
        error: 'Failed to get SOS alert',
        status: 500
      };
    }
  }

  /**
   * Respond to an SOS alert
   * @param alertId SOS alert ID
   * @param responseData Response data from volunteer
   * @returns Updated SOS alert or error
   */
  static async respondToSOSAlert(
    alertId: string,
    responseData: {
      responder_id: string;
      responder_name: string;
      location?: {
        latitude: number;
        longitude: number;
        accuracy?: number | null;
        timestamp: string;
      };
  }): Promise<{
    success: boolean;
    data?: {
      id: string;
      victim_id: string;
      victim_name: string | null;
      type: string;
      description: string;
      location: any;
      status: string;
      created_at: string;
      responded_at: string;
      responder_id: string | null;
      responder_name: string | null;
      distance: number | null;
    };
    error?: string;
    status?: number;
  }> {
    try {
      // Validate responder is a volunteer
      const responderValidation = await UserService.validateUserType(responseData.responder_id, 'volunteer');
      if (!responderValidation.isValid) {
        return {
          success: false,
          error: responderValidation.error || 'Invalid responder',
          status: 400
        };
      }

      // Get SOS alert
      const sosAlert = await SOSAlert.findByPk(alertId);
      if (!sosAlert) {
        return {
          success: false,
          error: 'SOS alert not found',
          status: 404
        };
      }

      // Check if alert is still pending
      if (sosAlert.status !== 'pending') {
        return {
          success: false,
          error: 'SOS alert is no longer accepting responses',
          status: 400
        };
      }

      // Calculate distance if responder location provided
      let distance = null;
      if (responseData.location && sosAlert.location) {
        distance = LocationUtils.calculateDistance(
          responseData.location.latitude,
          responseData.location.longitude,
          sosAlert.location.latitude,
          sosAlert.location.longitude
        );

        // Update responder's location
        await UserService.updateUserLocation(responseData.responder_id, {
          latitude: responseData.location.latitude,
          longitude: responseData.location.longitude,
          accuracy: responseData.location.accuracy
        });
      }

      // Update SOS alert
      await sosAlert.update({
        status: 'responding',
        responderId: responseData.responder_id,
        responderName: responseData.responder_name,
        respondedAt: new Date(),
        distance: distance
      });

      // Get victim details
      const victimResult = await UserService.getUserById(sosAlert.victimId);

      // Update cache
      const updatedAlert = {
        id: sosAlert.id,
        victim_id: sosAlert.victimId,
        victim_name: victimResult.data?.name || null,
        type: sosAlert.type,
        description: sosAlert.description,
        location: sosAlert.location,
        status: sosAlert.status,
        created_at: sosAlert.createdAt.toISOString(),
        responded_at: sosAlert.respondedAt!.toISOString(),
        responder_id: sosAlert.responderId,
        responder_name: sosAlert.responderName,
        distance: sosAlert.distance
      };

      await redisService.cacheSOSAlert(alertId, updatedAlert);

      console.log(`✅ Volunteer ${responseData.responder_id} responded to SOS alert ${alertId}`);

      return {
        success: true,
        data: updatedAlert
      };
    } catch (error: any) {
      console.error('Error responding to SOS alert:', error);
      return {
        success: false,
        error: 'Failed to respond to SOS alert',
        status: 500
      };
    }
  }

  /**
   * Update SOS alert status
   * @param alertId SOS alert ID
   * @param status New status
   * @returns Updated alert or error
   */
  static async updateSOSStatus(
    alertId: string,
    status: 'pending' | 'responding' | 'resolved' | 'cancelled'
  ): Promise<{
    success: boolean;
    data?: {
      id: string;
      status: string;
      updated_at: string;
    };
    error?: string;
    status?: number;
  }> {
    try {
      // Validate status
      const validStatuses = ['pending', 'responding', 'resolved', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return {
          success: false,
          error: 'Invalid status',
          status: 400
        };
      }

      // Get and update SOS alert
      const sosAlert = await SOSAlert.findByPk(alertId);
      if (!sosAlert) {
        return {
          success: false,
          error: 'SOS alert not found',
          status: 404
        };
      }

      await sosAlert.update({ status });

      // Update cache
      const cachedAlert = await redisService.getCachedSOSAlert(alertId);
      if (cachedAlert) {
        cachedAlert.status = status;
        await redisService.cacheSOSAlert(alertId, cachedAlert);
      }

      // Remove from active alerts if resolved or cancelled
      if (['resolved', 'cancelled'].includes(status)) {
        await redisService.removeCachedSOSAlert(alertId);
      }

      console.log(`📝 Updated SOS alert ${alertId} status to ${status}`);

      return {
        success: true,
        data: {
          id: sosAlert.id,
          status: sosAlert.status,
          updated_at: sosAlert.updatedAt?.toISOString() || new Date().toISOString()
        }
      };
    } catch (error: any) {
      console.error('Error updating SOS status:', error);
      return {
        success: false,
        error: 'Failed to update SOS status',
        status: 500
      };
    }
  }

  /**
   * Find nearby SOS alerts for a volunteer
   * @param volunteerId Volunteer ID
   * @param radius Search radius in meters
   * @returns List of nearby SOS alerts or error
   */
  static async findNearbySOSAlerts(
    volunteerId: string,
    radius: number = 10000
  ): Promise<{
    success: boolean;
    data?: Array<{
      id: string;
      victim_id: string;
      victim_name: string | null;
      type: string;
      description: string;
      status: string;
      distance: number;
      location: {
        latitude: number;
        longitude: number;
        timestamp: string;
      };
      created_at: string;
    }>;
    error?: string;
    status?: number;
  }> {
    try {
      // Get volunteer's current location
      const volunteerLocation = await UserService.getUserLocation(volunteerId);
      if (!volunteerLocation.success || !volunteerLocation.data) {
        return {
          success: false,
          error: 'Volunteer location not found',
          status: 404
        };
      }

      // Find nearby alerts using PostGIS
      const nearbyAlerts = await LocationUtils.findNearbySOSAlerts(
        volunteerLocation.data.latitude,
        volunteerLocation.data.longitude,
        radius
      );

      console.log(`🔍 Found ${nearbyAlerts.length} nearby SOS alerts for volunteer ${volunteerId}`);

      return {
        success: true,
        data: nearbyAlerts
      };
    } catch (error: any) {
      console.error('Error finding nearby SOS alerts:', error);
      return {
        success: false,
        error: 'Failed to find nearby SOS alerts',
        status: 500
      };
    }
  }

  /**
   * Validate SOS request data
   * @param sosData SOS request data
   * @returns Validation result
   */
  private static async validateSOSRequest(sosData: {
    victim_id: string;
    type: string;
    description: string;
    location: any;
  }): Promise<{
    isValid: boolean;
    error?: string;
  }> {
    // Validate victim exists and is victim type
    const victimValidation = await UserService.validateUserType(sosData.victim_id, 'victim');
    if (!victimValidation.isValid) {
      return {
        isValid: false,
        error: victimValidation.error || 'Invalid victim'
      };
    }

    // Validate required fields
    if (!sosData.type || sosData.type.trim().length === 0) {
      return {
        isValid: false,
        error: 'SOS type is required'
      };
    }

    if (!sosData.description || sosData.description.trim().length === 0) {
      return {
        isValid: false,
        error: 'SOS description is required'
      };
    }

    if (!sosData.location) {
      return {
        isValid: false,
        error: 'Location data is required'
      };
    }

    // Validate location structure
    const requiredLocationFields = ['latitude', 'longitude', 'timestamp'];
    for (const field of requiredLocationFields) {
      if (!(field in sosData.location)) {
        return {
          isValid: false,
          error: `Location ${field} is required`
        };
      }
    }

    return { isValid: true };
  }

  /**
   * Get SOS statistics for monitoring
   * @returns SOS statistics
   */
  static async getSOSStatistics(): Promise<{
    total_active: number;
    pending: number;
    responding: number;
    resolved_today: number;
    average_response_time: number;
  }> {
    try {
      const activeAlerts = await this.getActiveSOSAlerts();
      
      const pending = activeAlerts.data?.filter(alert => alert.status === 'pending').length || 0;
      const responding = activeAlerts.data?.filter(alert => alert.status === 'responding').length || 0;
      
      // Get today's resolved alerts (this would need additional database query)
      const resolvedToday = await SOSAlert.count({
        where: {
          status: 'resolved',
          createdAt: {
            [Op.gte]: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      });

      // Calculate average response time (simplified calculation)
      const respondingAlerts = activeAlerts.data?.filter(alert => alert.responded_at) || [];
      const averageResponseTime = respondingAlerts.length > 0 
        ? respondingAlerts.reduce((sum, alert) => {
            const created = new Date(alert.created_at).getTime();
            const responded = new Date(alert.responded_at!).getTime();
            return sum + (responded - created);
          }, 0) / respondingAlerts.length / 1000 // Convert to seconds
        : 0;

      return {
        total_active: activeAlerts.data?.length || 0,
        pending,
        responding,
        resolved_today,
        average_response_time: Math.round(averageResponseTime)
      };
    } catch (error: any) {
      console.error('Error getting SOS statistics:', error);
      return {
        total_active: 0,
        pending: 0,
        responding: 0,
        resolved_today: 0,
        average_response_time: 0
      };
    }
  }
}

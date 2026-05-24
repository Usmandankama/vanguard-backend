import { SOSAlert, User } from "../model";
import { Op } from "sequelize";
import { LocationUtils } from "../utils/location.utils";
import { UserService } from "../services/user.service";
import { WebSocketService } from "./websocket.service";

export class SOSService {
  // ─── Create ───────────────────────────────────────────────────────────────
  static async createSOSAlert(sosData: {
    victim_id: string;
    type: string;
    description?: string | null;
    location: { latitude: number; longitude: number; accuracy?: number | null; timestamp: string };
  }): Promise<{ success: boolean; data?: any; error?: string; status?: number }> {
    try {
      const validationResult = await this.validateSOSRequest(sosData);
      if (!validationResult.isValid) return { success: false, error: validationResult.error, status: 400 };

      if (!LocationUtils.validateCoordinates(sosData.location.latitude, sosData.location.longitude))
        return { success: false, error: "Invalid location coordinates", status: 400 };

      const victimResult = await UserService.getUserById(sosData.victim_id);
      if (!victimResult.success) return { success: false, error: "Victim not found", status: 404 };

      const sosAlert = await SOSAlert.create({
        victim_id: sosData.victim_id,
        type: sosData.type as "medical" | "fire" | "crime" | "accident",
        description: sosData.description ?? undefined,
        location: sosData.location,
        status: "pending",
      });

      await UserService.updateUserLocation(sosData.victim_id, {
        latitude: sosData.location.latitude,
        longitude: sosData.location.longitude,
        accuracy: sosData.location.accuracy,
      });

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
          distance: null,
        },
      };
    } catch (error: any) {
      console.error("Error creating SOS alert:", error);
      return { success: false, error: "Failed to create SOS alert", status: 500 };
    }
  }

  // ─── Patch / Enrich ───────────────────────────────────────────────────────
  static async patchAlert(alertId: string, patch: { type?: string; description?: string; metadata?: Record<string, any> }): Promise<{ success: boolean; data?: any; error?: string; status?: number }> {
    try {
      const sosAlert = await SOSAlert.findByPk(alertId);
      if (!sosAlert) return { success: false, error: "SOS alert not found", status: 404 };
      if (!["pending", "responding"].includes(sosAlert.status))
        return { success: false, error: "Cannot enrich a resolved or cancelled alert", status: 400 };

      const mergedMetadata = patch.metadata ? { ...(sosAlert.metadata || {}), ...patch.metadata } : sosAlert.metadata;
      const updates: Record<string, any> = {};
      if (patch.type !== undefined) updates.type = patch.type;
      if (patch.description !== undefined) updates.description = patch.description;
      if (patch.metadata !== undefined) updates.metadata = mergedMetadata;
      await sosAlert.update(updates);

      return {
        success: true,
        data: {
          id: sosAlert.id,
          type: sosAlert.type,
          description: sosAlert.description,
          metadata: sosAlert.metadata,
          status: sosAlert.status,
          updated_at: sosAlert.updatedAt?.toISOString() || new Date().toISOString(),
        },
      };
    } catch (error: any) {
      console.error("Error patching SOS alert:", error);
      return { success: false, error: "Failed to enrich SOS alert", status: 500 };
    }
  }

  // ─── Get active alerts ────────────────────────────────────────────────────
  static async getActiveSOSAlerts(): Promise<{ success: boolean; data?: any[]; error?: string; status?: number }> {
    try {
      const activeAlerts = await SOSAlert.findAll({
        where: { status: { [Op.in]: ["pending", "responding"] } },
        include: [{ model: User, as: "victim", attributes: ["id", "name", "role"] }],
        order: [["createdAt", "DESC"]],
      });

      return {
        success: true,
        data: activeAlerts.map((alert: any) => ({
          id: alert.id,
          victim_id: alert.victimId,
          victim_name: alert.victim?.name || null,
          type: alert.type,
          description: alert.description,
          location: alert.location,
          status: alert.status,
          created_at: alert.createdAt.toISOString(),
          responded_at: alert.respondedAt?.toISOString() ?? null,
          responder_id: alert.responderId ?? null,
          responder_name: alert.responderName ?? null,
          distance: alert.distance ?? null,
        })),
      };
    } catch (error: any) {
      console.error("Error getting active SOS alerts:", error);
      return { success: false, error: "Failed to get active SOS alerts", status: 500 };
    }
  }

  // ─── Get single alert ─────────────────────────────────────────────────────
  static async getSOSAlert(alertId: string): Promise<{ success: boolean; data?: any; error?: string; status?: number }> {
    try {
      const sosAlert = await SOSAlert.findByPk(alertId, {
        include: [{ model: User, as: "victim", attributes: ["id", "name", "role"] }],
      });
      if (!sosAlert) return { success: false, error: "SOS alert not found", status: 404 };

      return {
        success: true,
        data: {
          id: sosAlert.id,
          victim_id: sosAlert.victimId,
          victim_name: (sosAlert as any).victim?.name || null,
          type: sosAlert.type,
          description: sosAlert.description,
          location: sosAlert.location,
          status: sosAlert.status,
          created_at: sosAlert.createdAt.toISOString(),
          responded_at: sosAlert.respondedAt?.toISOString() ?? null,
          responder_id: sosAlert.responder_id ?? null,
          responder_name: sosAlert.responderName ?? null,
          distance: sosAlert.distance ?? null,
        },
      };
    } catch (error: any) {
      console.error("Error getting SOS alert:", error);
      return { success: false, error: "Failed to get SOS alert", status: 500 };
    }
  }

  // ─── Respond ──────────────────────────────────────────────────────────────
  static async respondToSOSAlert(
    alertId: string,
    responseData: { responder_id: string; responder_name?: string; location?: { latitude: number; longitude: number; accuracy?: number | null; timestamp: string } },
  ): Promise<{ success: boolean; data?: any; error?: string; status?: number }> {
    try {
      const responderValidation = await UserService.validateUserType(responseData.responder_id, "volunteer");
      if (!responderValidation.isValid)
        return { success: false, error: responderValidation.error || "Invalid responder", status: 400 };

      const sosAlert = await SOSAlert.findByPk(alertId);
      if (!sosAlert) return { success: false, error: "SOS alert not found", status: 404 };
      if (sosAlert.status !== "pending")
        return { success: false, error: "SOS alert is no longer accepting responses", status: 400 };

      let distance = null;
      if (responseData.location && sosAlert.location) {
        distance = LocationUtils.calculateDistance(
          responseData.location.latitude, responseData.location.longitude,
          sosAlert.location.latitude, sosAlert.location.longitude,
        );
        await UserService.updateUserLocation(responseData.responder_id, {
          latitude: responseData.location.latitude,
          longitude: responseData.location.longitude,
          accuracy: responseData.location.accuracy,
        });
      }

      await sosAlert.update({
        status: "responding",
        responder_id: responseData.responder_id,
      });

      // ── Notify victim that a volunteer is on the way ──────────────────────
      // This is what makes the victim's active alert screen update in real time.
      const responderUser = await UserService.getUserById(responseData.responder_id);
      WebSocketService.sendTo(sosAlert.victim_id, {
        type: "VOLUNTEER_RESPONDING",
        data: {
          alert_id: alertId,
          responder_id: responseData.responder_id,
          responder_name: responderUser.data?.name ?? responseData.responder_name ?? "Volunteer",
          status: "responding",
          distance_meters: distance,
        },
      });
      console.log(`📣 VOLUNTEER_RESPONDING sent to victim ${sosAlert.victim_id}: ${responderUser}`);

      

      // Also assign the responder in the WS client map so location relay works
      WebSocketService.assignResponderToAlert(responseData.responder_id, alertId);

      const victimResult = await UserService.getUserById(sosAlert.victimId);

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
          responded_at: sosAlert.respondedAt?.toISOString() ?? null,
          responder_id: sosAlert.responderId ?? null,
          responder_name: sosAlert.responderName ?? null,
          distance: distance,
        },
      };
    } catch (error: any) {
      console.error("Error responding to SOS alert:", error);
      return { success: false, error: "Failed to respond to SOS alert", status: 500 };
    }
  }

  // ─── Update status ────────────────────────────────────────────────────────
  static async updateSOSStatus(
    alertId: string,
    status: "pending" | "responding" | "resolved" | "cancelled",
  ): Promise<{ success: boolean; data?: any; error?: string; status?: number }> {
    try {
      const validStatuses = ["pending", "responding", "resolved", "cancelled"];
      if (!validStatuses.includes(status)) return { success: false, error: "Invalid status", status: 400 };

      const sosAlert = await SOSAlert.findByPk(alertId);
      if (!sosAlert) return { success: false, error: "SOS alert not found", status: 404 };

      await sosAlert.update({ status });
      console.log(`📝 SOS alert ${alertId} status → ${status}`);

      // ── Notify victim when alert is resolved ─────────────────────────────
      if (status === "resolved" || status === "cancelled") {
        WebSocketService.sendTo(sosAlert.victim_id, {
          type: "ALERT_RESOLVED",
          data: {
            alert_id: alertId,
            status,
            message: status === "resolved"
              ? "The responder has marked this incident as resolved."
              : "This alert has been cancelled.",
          },
        });
      }

      return {
        success: true,
        data: {
          id: sosAlert.id,
          status: sosAlert.status,
          updated_at: sosAlert.updatedAt?.toISOString() || new Date().toISOString(),
        },
      };
    } catch (error: any) {
      console.error("Error updating SOS status:", error);
      return { success: false, error: "Failed to update SOS status", status: 500 };
    }
  }

  // ─── Find nearby alerts ───────────────────────────────────────────────────
  static async findNearbySOSAlerts(volunteerId: string, radius: number = 10000): Promise<{ success: boolean; data?: any[]; error?: string; status?: number }> {
    try {
      const volunteerLocation = await UserService.getUserLocation(volunteerId);
      if (!volunteerLocation.success || !volunteerLocation.data)
        return { success: false, error: "Volunteer location not found", status: 404 };

      const nearbyAlerts = await LocationUtils.findNearbySOSAlerts(
        volunteerLocation.data.latitude, volunteerLocation.data.longitude, radius,
      );
      return { success: true, data: nearbyAlerts };
    } catch (error: any) {
      console.error("Error finding nearby SOS alerts:", error);
      return { success: false, error: "Failed to find nearby SOS alerts", status: 500 };
    }
  }

  // ─── Statistics ───────────────────────────────────────────────────────────
  static async getSOSStatistics() {
    try {
      const activeAlerts = await this.getActiveSOSAlerts();
      const pending = activeAlerts.data?.filter((a) => a.status === "pending").length || 0;
      const responding = activeAlerts.data?.filter((a) => a.status === "responding").length || 0;
      const resolvedToday = await SOSAlert.count({
        where: { status: "resolved", createdAt: { [Op.gte]: new Date(new Date().setHours(0, 0, 0, 0)) } },
      });
      return { total_active: activeAlerts.data?.length || 0, pending, responding, resolved_today: resolvedToday, average_response_time: 0 };
    } catch {
      return { total_active: 0, pending: 0, responding: 0, resolved_today: 0, average_response_time: 0 };
    }
  }

  // ─── Validation ───────────────────────────────────────────────────────────
  private static async validateSOSRequest(sosData: { victim_id: string; type?: string; description?: string | null; location: any }): Promise<{ isValid: boolean; error?: string }> {
    const victimValidation = await UserService.validateUserType(sosData.victim_id, "victim");
    if (!victimValidation.isValid) return { isValid: false, error: victimValidation.error || "Invalid victim" };
    if (!sosData.location) return { isValid: false, error: "Location data is required" };
    for (const field of ["latitude", "longitude", "timestamp"]) {
      if (!(field in sosData.location)) return { isValid: false, error: `Location ${field} is required` };
    }
    return { isValid: true };
  }

  // ─── Responder history ────────────────────────────────────────────────────
  static async getResponderHistory(responderId: string) {
    try {
      const history = await SOSAlert.findAll({
        where: { responder_id: responderId },
        order: [["createdAt", "DESC"]],
      });
      return { success: true, data: history };
    } catch (error: any) {
      return { success: false, error: error.message, status: 500 };
    }
  }
}
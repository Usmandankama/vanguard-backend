import { SOSAlert, User } from "../model";
import { DatabaseService } from "../services/database.service";
import { WebSocketService } from "../services/websocket.service";
import { LocationUtils } from "../utils/location.utils";
import { SOSService } from "../services/sos.service";
import { QueryTypes } from "sequelize";

// ─── Shared Types ──────────────────────────────────────────────────────────────

// Elysia's context type is too complex to replicate manually (set.status alone
// is a union of 60+ string literals). All handlers use `any` — the route
// schemas in sos.route.ts handle runtime validation before handlers are called.

interface CreateAlertBody {
  victim_id: string;
  type: 'medical' | 'fire' | 'crime' | 'accident';
  latitude: string | number;
  longitude: string | number;
  metadata?: Record<string, unknown>;
}

interface EnrichAlertBody {
  type?: string;
  description?: string;
  people_involved?: number;
  injured_count?: number;
  critical_injured?: boolean;
  has_fire?: boolean;
  has_weapons?: boolean;
  has_structural_collapse?: boolean;
  immediate_danger?: boolean;
  location_description?: string;
}

const METADATA_KEYS: Array<keyof EnrichAlertBody> = [
  "people_involved",
  "injured_count",
  "critical_injured",
  "has_fire",
  "has_weapons",
  "has_structural_collapse",
  "immediate_danger",
  "location_description",
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parseCoord(value: string | number | undefined): number {
  const n = typeof value === "number" ? value : parseFloat(value ?? "");
  return isFinite(n) ? n : NaN;
}

function fail(
  set: { status: number },
  status: number,
  error: string,
): { success: false; error: string } {
  set.status = status;
  return { success: false, error };
}

// ─── Controller ────────────────────────────────────────────────────────────────

export class SOSController {

  // ─── 1. Create & Broadcast SOS ──────────────────────────────────────────────
  static async createAlert({ body, set }: any) {
    try {
      const { victim_id, type, latitude, longitude, metadata } =
        body as unknown as CreateAlertBody;

      if (!victim_id || typeof victim_id !== "string") {
        return fail(set, 400, "victim_id is required and must be a string");
      }

      const lat = parseCoord(latitude);
      const lng = parseCoord(longitude);

      if (isNaN(lat) || isNaN(lng)) {
        return fail(set, 400, "latitude and longitude are required and must be finite numbers");
      }

      if (!LocationUtils.validateCoordinates(lat, lng)) {
        return fail(set, 400, "Invalid coordinates. Latitude must be −90..90, longitude −180..180.");
      }

      const victim = await User.findByPk(victim_id, {
        attributes: ["id", "name", "role"],
      });
      if (!victim) return fail(set, 404, "Victim not found");

      const alert = await SOSAlert.create({
        victim_id,
        type,
        metadata: metadata ?? {},
        location: {
          type: "Point",
          coordinates: [lng, lat],
        },
        status: "pending",
      });

      WebSocketService.assignClientToAlert(victim_id, alert.id);

      set.status = 201;
      const immediateResponse = {
        success: true,
        data: {
          id: alert.id,
          type: alert.type,
          status: alert.status,
          location: { latitude: lat, longitude: lng },
          created_at: alert.createdAt.toISOString(),
        },
        message: "SOS created. Dispatching to nearby volunteers.",
      };

      setImmediate(() =>
        SOSController._dispatchToNearbyVolunteers(alert, lat, lng),
      );

      return immediateResponse;
    } catch (error) {
      console.error("SOS Creation Error:", error);
      return fail(set, 500, "Failed to create SOS alert");
    }
  }

  private static async _dispatchToNearbyVolunteers(
    alert: InstanceType<typeof SOSAlert>,
    lat: number,
    lng: number,
  ): Promise<void> {
    try {
      // Try PostGIS spatial query first (requires volunteers to have last_location set)
      let nearbyVolunteers = await LocationUtils.findNearbyVolunteers(
        lat, lng, 5000, 20,
      );

      // Fallback: if PostGIS returns 0 results (null last_location in DB),
      // dispatch to ALL online verified volunteers connected via WS.
      // This covers the case where volunteers haven't seeded their location yet.
      if (nearbyVolunteers.length === 0) {
        console.log('⚠️  No volunteers found via PostGIS — falling back to all online WS volunteers');
        const stats = WebSocketService.getStats();
        console.log(`📊 WS stats: ${JSON.stringify(stats)}`);

        // Get all verified volunteers from DB and let WS filter to online ones
        const { User } = await import('../model');
        const allVolunteers = await User.findAll({
          where: { role: 'volunteer', is_verified: true },
          attributes: ['id', 'name'],
        });
        // Shape matches the full volunteer object so the type is satisfied.
        // distance and location are unknown without PostGIS — use 0/null defaults.
        nearbyVolunteers = allVolunteers.map((v: any) => ({
          id: v.id,
          name: v.name,
          distance: 0,
          location: { latitude: 0, longitude: 0 },
        }));
        console.log(`📋 Fallback dispatch to ${nearbyVolunteers.length} verified volunteers`);
      }

      const volunteerIds: string[] = nearbyVolunteers.map((v: { id: string }) => v.id);

      // Include metadata in the dispatch payload so the Flutter dispatch
      // screen can show full incident details without a separate fetch.
      WebSocketService.dispatchToVolunteers(volunteerIds, {
        type: "NEW_SOS_DISPATCH",
        data: {
          id: alert.id,
          victim_id: alert.victim_id,
          type: alert.type,
          status: alert.status,
          metadata: alert.metadata ?? {},
          description: alert.description ?? null,
          location: { latitude: lat, longitude: lng },
          // distance is 0 at dispatch time — responder hasn't moved yet.
          // The active response screen computes live distance from GPS.
          distance: 0,
          created_at: alert.createdAt.toISOString(),
        },
      });

      WebSocketService.broadcastToCommunity({
        type: "COMMUNITY_MAP_UPDATE",
        data: {
          id: alert.id,
          type: alert.type,
          latitude: lat,
          longitude: lng,
        },
      });

      console.log(`🚨 SOS ${alert.id} dispatched to ${volunteerIds.length} volunteers`);
    } catch (err) {
      console.error(`Dispatch failed for SOS ${alert.id}:`, err);
    }
  }

  // ─── 2. Enrich an active SOS ──────────────────────────────────────────────
  static async enrichAlert({ params, body, set }: any) {
    try {
      const { id } = params;
      if (!id) return fail(set, 400, "Alert ID parameter is required");

      const input = body as EnrichAlertBody;
      const alert = await SOSAlert.findByPk(id);

      if (!alert) return fail(set, 404, "SOS alert not found");

      if (!["pending", "responding"].includes(alert.status)) {
        return fail(set, 400, "Cannot enrich a resolved or cancelled alert");
      }

      const columnUpdates: Record<string, unknown> = {};
      if (input.type !== undefined) columnUpdates.type = input.type;
      if (input.description !== undefined) columnUpdates.description = input.description;

      const metadataPatch: Record<string, unknown> = {};
      for (const key of METADATA_KEYS) {
        if (input[key] !== undefined) metadataPatch[key] = input[key];
      }

      if (Object.keys(metadataPatch).length > 0) {
        columnUpdates.metadata = {
          ...(typeof alert.metadata === "object" && alert.metadata !== null
            ? (alert.metadata as Record<string, unknown>)
            : {}),
          ...metadataPatch,
        };
      }

      if (Object.keys(columnUpdates).length === 0) {
        return { success: true, message: "No changes to apply", data: SOSController._formatAlertResponse(alert) };
      }

      await alert.update(columnUpdates);

      const payloadData = {
        id: alert.id,
        type: alert.type,
        status: alert.status,
        description: alert.description,
        metadata: alert.metadata,
        created_at: new Date(alert.createdAt).toISOString(),
        updated_at: new Date(alert.updatedAt).toISOString(),
      };

      WebSocketService.dispatchToAlertResponders(id, {
        type: "SOS_ENRICHED",
        data: payloadData,
      });

      console.log(`📋 SOS [${id}] enriched. Broadcasted to responders.`);

      return { success: true, data: payloadData };
    } catch (error) {
      console.error("SOS Enrich Error:", error);
      return fail(set, 500, "Failed to enrich SOS alert");
    }
  }

  private static _formatAlertResponse(alert: any) {
    return {
      id: alert.id,
      status: alert.status,
      type: alert.type,
      metadata: alert.metadata,
      description: alert.description,
      created_at: new Date(alert.createdAt).toISOString(),
    };
  }

  // ─── 3. Community map feed ───────────────────────────────────────────────────
  // Uses a dedicated context type because GET routes have body: unknown,
  // not body: Record<string, unknown> — the shared ElysiaContext doesn't fit.
  static async getActiveAlerts(ctx: any) {
    try {
      const { lat, lng, radius } = ctx.query;

      if (!lat || !lng) {
        return new Response(
          JSON.stringify({ success: false, message: "Missing coordinates" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const parsedLat = parseCoord(lat);
      const parsedLng = parseCoord(lng);
      const parsedRadius = radius ? parseCoord(radius) : 10000;

      if (isNaN(parsedLat) || isNaN(parsedLng)) {
        return new Response(
          JSON.stringify({ success: false, message: "Coordinates must be valid numbers" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      if (!LocationUtils.validateCoordinates(parsedLat, parsedLng)) {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid coordinates alignment" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Fixed: include metadata and ST_Distance so Flutter gets full alert data.
      // Distance is computed from the responder's coordinates (passed as lat/lng).
      const sql = `
        SELECT
          id,
          type,
          status,
          metadata,
          description,
          "createdAt",
          ST_Y(location::geometry)  AS latitude,
          ST_X(location::geometry)  AS longitude,
          ST_Distance(
            location::geography,
            ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography
          ) AS distance
        FROM sos_alerts
        WHERE status = 'pending'
          AND ST_DWithin(
                location::geography,
                ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
                ?
              )
        ORDER BY distance ASC
      `;

      const sequelizeInstance = DatabaseService.getPrimary();

      const activeAlerts = await sequelizeInstance.query(sql, {
        // First pair for ST_Distance, second pair + radius for ST_DWithin
        replacements: [parsedLng, parsedLat, parsedLng, parsedLat, parsedRadius],
        type: QueryTypes.SELECT,
      });

      const shaped = (activeAlerts as Array<Record<string, unknown>>).map((a) => {
        // metadata comes back as a string from raw queries in some PG drivers
        let meta: Record<string, unknown> = {};
        if (typeof a.metadata === "string") {
          try { meta = JSON.parse(a.metadata); } catch (_) {}
        } else if (typeof a.metadata === "object" && a.metadata !== null) {
          meta = a.metadata as Record<string, unknown>;
        }

        return {
          id: a.id,
          type: a.type,
          status: a.status,
          metadata: meta,
          description: a.description ?? null,
          // Force UTC ISO string — raw PG queries may omit the Z suffix
          created_at: (() => {
            const raw = (a.createdAt ?? a.created_at) as string | Date | undefined;
            if (!raw) return new Date().toISOString();
            if (raw instanceof Date) return raw.toISOString();
            // String without Z — treat as UTC and append Z
            return raw.endsWith('Z') ? raw : raw + 'Z';
          })(),
          location: {
            latitude: parseFloat(String(a.latitude)),
            longitude: parseFloat(String(a.longitude)),
          },
          // distance is in metres (PostGIS geography ST_Distance returns metres)
          distance: parseFloat(String(a.distance ?? 0)),
        };
      });

      return new Response(
        JSON.stringify({ success: true, data: shaped }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error) {
      console.error("Fetch Alerts Error:", error instanceof Error ? error.message : error);
      return new Response(
        JSON.stringify({ success: false, message: "Internal Server Error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // ─── 4. Get single alert ─────────────────────────────────────────────────────
  static async getAlert({ params, set }: any) {
    if (!params.id) return fail(set, 400, "Alert ID is required");
    const result = await SOSService.getSOSAlert(params.id);
    if (!result.success) {
      set.status = result.status ?? 404;
      return { success: false, error: result.error };
    }
    return { success: true, data: result.data };
  }

  // ─── 5. Volunteer responds to alert ─────────────────────────────────────────
  static async respondToAlert({ params, body, set }: any) {
    if (!params.id) return fail(set, 400, "Alert ID is required");

    // Cast through unknown — Elysia route schema already validates shape.
    const typedBody = body as unknown as {
      responder_id: string;
      responder_name: string;
      location?: {
        latitude: number;
        longitude: number;
        accuracy?: number | null;
        timestamp: string;
      };
    };

    const result = await SOSService.respondToSOSAlert(params.id, typedBody);
    if (!result.success) {
      set.status = result.status ?? 400;
      return { success: false, error: result.error };
    }
    return { success: true, data: result.data };
  }

  // ─── 6. Update alert status ──────────────────────────────────────────────────
  static async updateStatus({ params, body, set }: any) {
    if (!params.id) return fail(set, 400, "Alert ID is required");

    // Cast to enum — Elysia route schema validates the literal before here.
    const { status } = body as {
      status: "pending" | "responding" | "resolved" | "cancelled";
    };

    const result = await SOSService.updateSOSStatus(params.id, status);
    if (!result.success) {
      set.status = result.status ?? 400;
      return { success: false, error: result.error };
    }
    return { success: true, data: result.data };
  }

  // ─── 7. Responder history ────────────────────────────────────────────────────
  static async getResponderHistory({ params, set }: any) {
    if (!params.id) return fail(set, 400, "Responder ID is required");
    const result = await SOSService.getResponderHistory(params.id);
    if (!result.success) {
      set.status = result.status ?? 400;
      return { success: false, error: result.error };
    }
    return { success: true, data: result.data };
  }
}
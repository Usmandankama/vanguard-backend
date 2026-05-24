import { ElysiaWS } from "elysia/ws";
import { User } from "../model";
import { verifyJwt } from "../utils/jwt.utils";
import { LocationUtils } from "../utils/location.utils";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface WSClient {
  ws: ElysiaWS<any, any>;
  userId: string;
  role: "victim" | "volunteer" | "admin";
  isOnline: boolean; // volunteer duty status
  alertId?: string; // alert the client is currently responding to
  lastSeen: Date;
}

interface OutboundEvent {
  type: string;
  data: Record<string, any>;
}

// ─────────────────────────────────────────────────────────────────────────────
// WEBSOCKET SERVICE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * VanguardNet WebSocket Service
 *
 * Manages all persistent WS connections for the platform.
 *
 * Responsibilities:
 *  - Register / deregister clients on connect/disconnect
 *  - Dispatch full SOS detail to specific verified volunteers
 *  - Broadcast anonymised blips to the community map
 *  - Push live enrichment patches to responders on an active alert
 *  - Track responder live locations and relay to victims
 *  - Handle PING keepalives and RESPONDER_STATUS_CHANGE events
 *
 * Called by:
 *  - SOSController  → dispatchToVolunteers(), broadcastToCommunity(), dispatchToAlertResponders()
 *  - ElysiaJS route → registerClient(), removeClient(), handleMessage()
 */
export class WebSocketService {
  // Map of userId → WSClient
  // One connection per user — if a user reconnects, the old entry is replaced
  private static clients = new Map<string, WSClient>();

  // ── Connection lifecycle (called from server.ts) ───────────────────────────

  static async handleConnection(
    ws: ElysiaWS<any, any>,
    query: { userId?: string; token?: string },
  ): Promise<void> {
    let userId = query.userId;

    if (query.token) {
      const payload = verifyJwt(query.token);
      if (!payload) {
        ws.close(4001, "Invalid token");
        return;
      }
      userId = payload.userId;
    }

    if (!userId) {
      ws.close(4002, "userId or token required");
      return;
    }

    const user = await User.findByPk(userId, { attributes: ["id", "role"] });
    if (!user) {
      ws.close(4003, "Unknown user");
      return;
    }

    const role =
      user.role === "volunteer"
        ? "volunteer"
        : user.role === "victim"
          ? "victim"
          : "admin";

    this.registerClient(ws, userId, role);
  }

  static handleDisconnection(userId: string): void {
    this.removeClient(userId);
  }

  // ── Registration ────────────────────────────────────────────────────────────

  static registerClient(
    ws: ElysiaWS<any, any>,
    userId: string,
    role: "victim" | "volunteer" | "admin",
  ): void {
    // If the user already has a connection (e.g. reconnect), cleanly replace it
    const existing = this.clients.get(userId);
    if (existing) {
      console.log(`🔁 WS replacing stale connection for user ${userId}`);
    }

    this.clients.set(userId, {
      ws,
      userId,
      role,
      isOnline: role === "victim", // victims are always "online"; volunteers toggle
      lastSeen: new Date(),
    });

    console.log(
      `🟢 WS connected: ${userId} (${role}) | total: ${this.clients.size}`,
    );

    // Acknowledge the connection
    this.sendTo(userId, {
      type: "CONNECTION_ACK",
      data: {
        userId,
        role,
        serverTime: new Date().toISOString(),
        message: "VanguardNet WSS connected",
      },
    });
  }

  static removeClient(userId: string): void {
    const client = this.clients.get(userId);
    if (!client) return;

    // If they were mid-response, log it for re-queue logic
    if (client.alertId) {
      console.warn(
        `⚠️  Responder ${userId} disconnected while responding to alert ${client.alertId}`,
      );
      // TODO: trigger re-dispatch to next nearest volunteer
    }

    this.clients.delete(userId);
    console.log(`🔴 WS disconnected: ${userId} | total: ${this.clients.size}`);
  }

  // ── Inbound message router ──────────────────────────────────────────────────

  static handleMessage(userId: string, raw: string | Buffer): void {
    try {
      const event = JSON.parse(raw.toString()) as {
        type: string;
        data?: Record<string, any>;
      };

      const client = this.clients.get(userId);
      if (!client) return;

      // Update lastSeen on every message
      client.lastSeen = new Date();

      switch (event.type) {
        case "PING":
          this.sendTo(userId, { type: "PONG", data: {} });
          break;

        case "RESPONDER_STATUS_CHANGE":
          // Volunteer toggling on/off duty
          if (client.role === "volunteer") {
            client.isOnline = event.data?.online === true;
            console.log(
              `📡 Volunteer ${userId} is now ${client.isOnline ? "ONLINE" : "OFFLINE"}`,
            );
          }
          break;

        case "VICTIM_JOINED_ALERT": {
          if (client.role === "victim") {
            const alertId = event.data?.alert_id as string | undefined;
            if (alertId) {
              client.alertId = alertId;
              console.log(`🆘 Victim ${userId} joined alert ${alertId}`);
            }
          }
          break;
        }

        case "RESPONDER_LOCATION_UPDATE": {
          const alertId = event.data?.alert_id as string | undefined;
          if (alertId && client.role === "volunteer") {
            client.alertId = alertId;
          }

          // Persist location to DB so PostGIS findNearbyVolunteers works on next dispatch.
          // Fire-and-forget — don't await, this must not block the message handler.
          const lat = event.data?.latitude as number | undefined;
          const lng = event.data?.longitude as number | undefined;
          if (
            lat !== undefined &&
            lng !== undefined &&
            client.role === "volunteer"
          ) {
            LocationUtils.updateUserLocation(userId, lat, lng).catch(
              (err: any) =>
                console.error(`Failed to persist location for ${userId}:`, err),
            );
          }

          this._relayResponderLocation(userId, event.data || {});
          break;
        }
        case "ALERT_MESSAGE": {
          const alertId = event.data?.alert_id as string | undefined;
          const text = event.data?.text as string | undefined;
          const from = event.data?.from as string | undefined;
          if (!alertId || !text) break;

          // Relay to the other party on this alert
          for (const [, c] of this.clients) {
            if (c.alertId === alertId && c.userId !== userId) {
              this.sendTo(c.userId, {
                type: "ALERT_MESSAGE",
                data: { alert_id: alertId, text, from: from ?? userId },
              });
            }
          }
          break;
        }

        default:
          console.log(`WS unhandled event: ${event.type} from ${userId}`);
      }
    } catch (err) {
      console.error(`WS message parse error from ${userId}:`, err);
    }
  }

  // ── Dispatch to specific volunteers ────────────────────────────────────────

  /**
   * Send a full SOS dispatch to a list of volunteer IDs.
   * Only sends to volunteers who are currently connected AND on duty.
   * Called by SOSController after PostGIS nearby volunteer query.
   */
  static dispatchToVolunteers(
    volunteerIds: string[],
    event: OutboundEvent,
  ): void {
    let dispatched = 0;

    for (const id of volunteerIds) {
      const client = this.clients.get(id);

      // Skip: not connected, not a volunteer, or not on duty
      if (!client || client.role !== "volunteer" || !client.isOnline) {
        continue;
      }

      const sent = this.sendTo(id, event);
      if (sent) dispatched++;
    }

    console.log(
      `📡 Dispatched ${event.type} to ${dispatched}/${volunteerIds.length} online volunteers`,
    );
  }

  // ── Broadcast to all connected clients ─────────────────────────────────────

  /**
   * Broadcast an anonymised event to every connected client.
   * Used for the community map — NEVER include victim PII here.
   */
  static broadcastToCommunity(event: OutboundEvent): void {
    let count = 0;
    for (const [, client] of this.clients) {
      const sent = this.sendTo(client.userId, event);
      if (sent) count++;
    }
    console.log(`📢 Community broadcast: ${event.type} → ${count} clients`);
  }

  // ── Dispatch to responders on a specific alert ──────────────────────────────

  /**
   * Push a live enrichment patch to all volunteers currently responding
   * to a specific alert ID.
   * Called when the victim pushes a PATCH /sos/:id/enrich update.
   */
  static dispatchToAlertResponders(
    alertId: string,
    event: OutboundEvent,
  ): void {
    let count = 0;
    for (const [, client] of this.clients) {
      if (client.alertId === alertId) {
        const sent = this.sendTo(client.userId, event);
        if (sent) count++;
      }
    }
    console.log(
      `📋 Enrichment patch sent to ${count} responders on alert ${alertId}`,
    );
  }

  // ── Assign a responder to an alert ─────────────────────────────────────────

  /**
   * Mark a volunteer as actively responding to an alert.
   * Called by SOSController when a volunteer accepts a dispatch.
   * This allows dispatchToAlertResponders() to find them by alertId.
   */
  static assignClientToAlert(userId: string, alertId: string): void {
    const client = this.clients.get(userId);
    if (client) {
      client.alertId = alertId;
    }
  }

  static assignResponderToAlert(volunteerId: string, alertId: string): void {
    this.assignClientToAlert(volunteerId, alertId);
    console.log(`✅ Volunteer ${volunteerId} assigned to alert ${alertId}`);
  }

  static unassignClientFromAlert(userId: string): void {
    const client = this.clients.get(userId);
    if (client) {
      client.alertId = undefined;
    }
  }

  /**
   * Clear the alert assignment when a response is resolved or cancelled.
   */
  static unassignResponderFromAlert(volunteerId: string): void {
    const client = this.clients.get(volunteerId);
    if (client) {
      const prev = client.alertId;
      client.alertId = undefined;
      console.log(`🏁 Volunteer ${volunteerId} unassigned from alert ${prev}`);
    }
  }

  // ── Relay responder location to victim ─────────────────────────────────────

  /**
   * When a responder sends RESPONDER_LOCATION_UPDATE, relay it to the
   * victim of the same alert so their map shows the responder moving.
   */
  private static _relayResponderLocation(
    responderId: string,
    data: Record<string, any>,
  ): void {
    const responder = this.clients.get(responderId);
    if (!responder?.alertId) return;

    // Find the victim for this alert
    // We look for a 'victim' client whose alertId matches
    // In practice you may want to store victimId on the alert record
    // and look them up directly — this is a best-effort relay
    for (const [, client] of this.clients) {
      if (client.role === "victim" && client.alertId === responder.alertId) {
        this.sendTo(client.userId, {
          type: "RESPONDER_LOCATION_UPDATE",
          data: {
            responder_id: responderId,
            latitude: data.latitude,
            longitude: data.longitude,
            timestamp: new Date().toISOString(),
          },
        });
        this.broadcastToCommunity({
          type: "RESPONDER_LOCATION_UPDATE",
          data: {
            volunteer_id: responderId,
            latitude: data.latitude,
            longitude: data.longitude,
            timestamp: new Date().toISOString(),
          },
        });
        break;
      }
    }
  }

  // ── Direct send helper ──────────────────────────────────────────────────────

  /**
   * Send a typed event to a single client by userId.
   * Returns true if the message was sent, false if the client wasn't found
   * or the socket threw (stale connection).
   */
  static sendTo(userId: string, event: OutboundEvent): boolean {
    const client = this.clients.get(userId);
    if (!client) return false;

    try {
      client.ws.send(JSON.stringify(event));
      return true;
    } catch (err) {
      // Socket is stale — clean it up
      console.error(`WS dead socket for ${userId}, removing:`, err);
      this.clients.delete(userId);
      return false;
    }
  }

  // ── Diagnostics ─────────────────────────────────────────────────────────────

  static getStats(): {
    total: number;
    victims: number;
    volunteersOnline: number;
    volunteersOffline: number;
    activeResponders: number;
  } {
    let victims = 0;
    let volunteersOnline = 0;
    let volunteersOffline = 0;
    let activeResponders = 0;

    for (const [, client] of this.clients) {
      if (client.role === "victim") victims++;
      else if (client.role === "volunteer") {
        if (client.isOnline) volunteersOnline++;
        else volunteersOffline++;
        if (client.alertId) activeResponders++;
      }
    }

    return {
      total: this.clients.size,
      victims,
      volunteersOnline,
      volunteersOffline,
      activeResponders,
    };
  }

  // ── Stale connection cleanup ────────────────────────────────────────────────

  /**
   * Sweep for clients that haven't sent a message in over 2 minutes.
   * Call this on an interval from your app startup:
   *   setInterval(() => WebSocketService.sweepStaleConnections(), 60_000)
   */
  static sweepStaleConnections(): void {
    const cutoff = new Date(Date.now() - 2 * 60 * 1000);
    let swept = 0;

    for (const [userId, client] of this.clients) {
      if (client.lastSeen < cutoff) {
        this.clients.delete(userId);
        swept++;
      }
    }

    if (swept > 0) {
      console.log(`🧹 WS swept ${swept} stale connections`);
    }
  }
}

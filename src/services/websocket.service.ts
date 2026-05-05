export class WebSocketService {
  // Maps a User ID to their active WebSocket connection
  private static activeConnections = new Map<string, any>();

  static handleConnection(ws: any, userId: string) {
    this.activeConnections.set(userId, ws);
    console.log(`🔌 WS Connected: User [${userId}] | Total Active: ${this.activeConnections.size}`);
  }

  static handleDisconnection(userId: string) {
    this.activeConnections.delete(userId);
    console.log(`❌ WS Disconnected: User [${userId}] | Total Active: ${this.activeConnections.size}`);
  }

  // Target specific users (The 5km radius volunteers)
  static dispatchToVolunteers(volunteerIds: string[], payload: any) {
    let deliveredCount = 0;
    
    volunteerIds.forEach((id) => {
      const connection = this.activeConnections.get(id);
      if (connection) {
        connection.send(JSON.stringify(payload));
        deliveredCount++;
      }
    });

    console.log(`📡 Dispatched SOS to ${deliveredCount}/${volunteerIds.length} online volunteers.`);
  }

  // Target ALL users (Dad's Community Map Feature)
  static broadcastToCommunity(payload: any) {
    const message = JSON.stringify(payload);
    this.activeConnections.forEach((connection) => {
      connection.send(message);
    });
  }
}
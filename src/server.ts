import { Elysia, t } from 'elysia';
import { DatabaseService } from "./services/database.service";
import { initializeDatabaseModels } from "./model";
import { authRoutes } from "./routes/auth.route";
import { sosRoutes } from "./routes/sos.route";
import { WebSocketService } from "./services/websocket.service";
import { loggingMiddleware } from "./middleware/logging.middleware";

const PORT = parseInt(process.env.PORT || "3000");

async function bootstrap() {
  console.log("🚀 Initiating VanguardNet V2 Boot Sequence...");

  try {
    // 1. Initialize Database Core
    await DatabaseService.initialize();

    // 2. Initialize Models & Associations
    await initializeDatabaseModels();

    // 3. Construct Elysia Application
    const app = new Elysia()
      .use(loggingMiddleware)
      .get("/api/health", () => ({
        status: "VanguardNet Core ALIVE",
        timestamp: new Date(),
      }))
      .use(authRoutes)
      .use(sosRoutes)

      // 3. The WebSocket Gateway
      .ws("/ws/vanguard", {
        // We require the mobile app to pass their User ID in the URL: ws://localhost:3000/ws/vanguard?userId=123
        query: t.Object({
          userId: t.String(),
        }),
        open(ws) {
          WebSocketService.handleConnection(ws, ws.data.query.userId);
        },
        close(ws) {
          WebSocketService.handleDisconnection(ws.data.query.userId);
        },
        message(ws, message) {
          // Keep-alive ping from Flutter app to prevent dropping on bad networks
          if (message === "ping") ws.send("pong");
        },
      })

      .listen(PORT);

    console.log(`\n🟢 VanguardNet running at http://localhost:${PORT}`);
    console.log(`🔑 Auth Gateway Ready`);
    console.log(`🚨 SOS Gateway Ready`);
  } catch (error) {
    console.error("💥 CRITICAL: Boot Sequence Failed", error);
    process.exit(1);
  }
}

bootstrap();

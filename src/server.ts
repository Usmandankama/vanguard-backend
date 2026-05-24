import { Elysia, t } from 'elysia';
import { DatabaseService } from "./services/database.service";
import { initializeDatabaseModels } from "./model";
import { authRoutes } from "./routes/auth.route";
import { sosRoutes, sosLegacyRoutes } from "./routes/sos.route";
import { responderRoutes, responderLegacyRoutes } from "./routes/responder.route";
import { WebSocketService } from "./services/websocket.service";
import { loggingMiddleware } from "./middleware/logging.middleware";
import { verifyJwt } from "./utils/jwt.utils";

const PORT = parseInt(process.env.PORT || "3000");

const wsQuerySchema = t.Object({
  userId: t.Optional(t.String()),
  token: t.Optional(t.String()),
});

function resolveUserIdFromQuery(query: { userId?: string; token?: string }): string | null {
  if (query.userId) return query.userId;
  if (query.token) return verifyJwt(query.token)?.userId ?? null;
  return null;
}

function registerWebSocketGateway(app: any) {
  const wsHandler = {
    query: wsQuerySchema,
    async open(ws: any) {
      console.log(`🔌 WS open — query: ${JSON.stringify(ws.data.query)}`);
      if (ws.data.query.userId || ws.data.query.token) {
        await WebSocketService.handleConnection(ws, ws.data.query);
      }
      // Otherwise wait for AUTH frame
    },
    close(ws: any) {
      const userId = ws.data._resolvedUserId ?? resolveUserIdFromQuery(ws.data.query);
      console.log(`🔴 WS close — resolvedUserId: ${userId ?? 'none'}`);
      if (userId) WebSocketService.handleDisconnection(userId);
    },
    async message(ws: any, message: string | Buffer) {
      // Normalize to string — Flutter's web_socket_channel sends binary frames
      // on Android, so message arrives as a Buffer. message.toString() on a
      // Buffer returns "[object Object]"; Buffer.from() decodes it correctly.
      const raw = typeof message === 'string'
        ? message
        : Buffer.from(message as Buffer).toString('utf8');

      // Debug log — remove once WS auth is confirmed working
      console.log('📨 WS message received:', raw.substring(0, 120));

      let userId = resolveUserIdFromQuery(ws.data.query);

      if (!userId) {
        try {
          const parsed = JSON.parse(raw) as any;
          if (parsed.type === 'AUTH') {
            const payload = parsed.token ? verifyJwt(parsed.token) : null;
            userId = payload?.userId ?? parsed.userId ?? null;

            console.log(`🔑 AUTH frame — token present: ${!!parsed.token}, resolved userId: ${userId ?? 'null'}`);

            if (!userId) {
              console.log('❌ AUTH frame rejected — invalid token');
              ws.close(4001, 'Invalid auth frame');
              return;
            }

            ws.data._resolvedUserId = userId;

            await WebSocketService.handleConnection(ws, {
              userId,
              token: parsed.token,
            });
            return;
          }
        } catch (_) {}

        console.log('❌ WS message rejected — no auth, not AUTH frame');
        ws.close(4002, 'Authenticate first');
        return;
      }

      if (raw === 'ping') {
        ws.send('pong');
        return;
      }

      WebSocketService.handleMessage(userId, raw);
    },
  };

  return app.ws('/ws/vanguard', wsHandler).ws('/ws', wsHandler);
}

async function bootstrap() {
  console.log("🚀 Initiating VanguardNet V2 Boot Sequence...");

  try {
    await DatabaseService.initialize();
    await initializeDatabaseModels();

    const app = new Elysia()
      .use(loggingMiddleware)
      .get("/api/health", () => ({
        status: "VanguardNet Core ALIVE",
        timestamp: new Date(),
      }))
      .use(authRoutes)
      .use(sosRoutes)
      .use(sosLegacyRoutes)
      .use(responderRoutes)
      .use(responderLegacyRoutes);

    registerWebSocketGateway(app).listen(PORT);

    setInterval(() => WebSocketService.sweepStaleConnections(), 60_000);

    console.log(`\n🟢 VanguardNet running at http://localhost:${PORT}`);
    console.log(`🔑 Auth Gateway Ready`);
    console.log(`🚨 SOS Gateway Ready`);
  } catch (error) {
    console.error("💥 CRITICAL: Boot Sequence Failed", error);
    process.exit(1);
  }
}

bootstrap();
import { Elysia, t } from 'elysia';
import { websocket } from '@elysiajs/websocket';
import postgres from 'postgres';

// PostGIS Connection
const sql = postgres('postgres://username:password@localhost:5432/vanguard_db');

const app = new Elysia()
  .use(websocket())
  .ws('/ws/vanguard', {
    body: t.Object({
      type: t.String(), // 'LOCATION_UPDATE' or 'SOS_TRIGGER'
      lat: t.Number(),
      lng: t.Number(),
      userId: t.String(),
    }),
    message(ws, message) {
      if (message.type === 'LOCATION_UPDATE') {
        // Update PostGIS location in real-time
        updateUserLocation(message.userId, message.lat, message.lng);
      } 
      
      if (message.type === 'SOS_TRIGGER') {
        // Trigger the Proximity Logic
        broadcastEmergency(message.userId, message.lat, message.lng, ws);
      }
    },
  })
  .listen(3000);

console.log(`🚀 VanguardNet Backend sprinting on port ${app.server?.port}`);

async function updateUserLocation(userId: string, lat: number, lng: number) {
  await sql`
    UPDATE users 
    SET last_location = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 
        updated_at = NOW() 
    WHERE id = ${userId}`;
}
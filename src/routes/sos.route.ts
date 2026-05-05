import { Elysia, t } from 'elysia';
import { SOSController } from '../controllers/sos.controller';

export const sosRoutes = new Elysia({ prefix: '/api/sos' })
  .post('/create', SOSController.createAlert, {
    body: t.Object({
      victim_id: t.String({ format: 'uuid', error: 'Invalid Victim ID' }),
      type: t.Union([
        t.Literal('medical'), 
        t.Literal('fire'), 
        t.Literal('crime'), 
        t.Literal('accident')
      ]),
      description: t.Optional(t.String()),
      metadata: t.Optional(t.Any()), // Accepts the dynamic pre-flight survey JSON
      latitude: t.Number({ minimum: -90, maximum: 90, error: 'Invalid Latitude' }),
      longitude: t.Number({ minimum: -180, maximum: 180, error: 'Invalid Longitude' })
    })
  })
  .get('/active', SOSController.getActiveAlerts, {
    query: t.Optional(t.Object({
      lat: t.Optional(t.String()),
      lng: t.Optional(t.String())
    }))
  });
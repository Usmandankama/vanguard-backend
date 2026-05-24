import { Elysia, t } from 'elysia';
import { SOSController } from '../controllers/sos.controller';

const sosTypeSchema = t.Union([
  t.Literal('medical'),
  t.Literal('fire'),
  t.Literal('crime'),
  t.Literal('accident'),
]);

const sosStatusSchema = t.Union([
  t.Literal('pending'),
  t.Literal('responding'),
  t.Literal('resolved'),
  t.Literal('cancelled'),
]);

function buildSosRoutes(prefix: string) {
  return new Elysia({ prefix })
    .post('/create', SOSController.createAlert, {
      body: t.Object({
        victim_id: t.String({ format: 'uuid', error: 'Invalid Victim ID' }),
        type: sosTypeSchema,
        description: t.Optional(t.String()),
        metadata: t.Optional(t.Any()),
        latitude: t.Number({ minimum: -90, maximum: 90, error: 'Invalid Latitude' }),
        longitude: t.Number({ minimum: -180, maximum: 180, error: 'Invalid Longitude' }),
      }),
    })
    .patch('/:id/enrich', SOSController.enrichAlert, {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: t.Object({
        type: t.Optional(sosTypeSchema),
        description: t.Optional(t.String()),
        people_involved: t.Optional(t.Number()),
        injured_count: t.Optional(t.Number()),
        critical_injured: t.Optional(t.Number()),
        has_fire: t.Optional(t.Boolean()),
        has_weapons: t.Optional(t.Boolean()),
        has_structural_collapse: t.Optional(t.Boolean()),
        immediate_danger: t.Optional(t.Boolean()),
        location_description: t.Optional(t.String()),
      }),
    })
    .post('/:id/respond', SOSController.respondToAlert, {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: t.Object({
        responder_id: t.String({ format: 'uuid' }),
        // Optional during development — add back as required before production
        responder_name: t.Optional(t.String()),
        location: t.Optional(
          t.Object({
            latitude: t.Number(),
            longitude: t.Number(),
            accuracy: t.Optional(t.Nullable(t.Number())),
            timestamp: t.String(),
          }),
        ),
      }),
    })
    .get('/active', SOSController.getActiveAlerts, {
      query: t.Optional(
        t.Object({
          lat: t.Optional(t.String()),
          lng: t.Optional(t.String()),
          radius: t.Optional(t.String()),
        }),
      ),
    })
    .get('/:id', SOSController.getAlert, {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
    })
    .patch('/:id/status', SOSController.updateStatus, {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: t.Object({ status: sosStatusSchema }),
    });
}

export const sosRoutes = buildSosRoutes('/api/sos');
export const sosLegacyRoutes = buildSosRoutes('/sos');
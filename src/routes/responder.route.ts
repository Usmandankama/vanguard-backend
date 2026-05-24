import { Elysia, t } from 'elysia';
import { SOSController } from '../controllers/sos.controller';

function buildResponderRoutes(prefix: string) {
  return new Elysia({ prefix })
    .get('/:id/history', SOSController.getResponderHistory, {
      params: t.Object({ id: t.String({ format: 'uuid' }) })
    });
}

export const responderRoutes = buildResponderRoutes('/api/responders');
export const responderLegacyRoutes = buildResponderRoutes('/responders');

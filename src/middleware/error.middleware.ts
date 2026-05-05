import { Elysia } from 'elysia';

export const errorHandler = new Elysia({ name: 'error-handler' })
  .onError(({ code, error, set }) => {
    console.error('Error occurred:', error);

    switch (code) {
      case 'VALIDATION':
        set.status = 400;
        return {
          success: false,
          error: 'Validation failed',
          details: error.message,
          status: 400
        };

      case 'NOT_FOUND':
        set.status = 404;
        return {
          success: false,
          error: 'Resource not found',
          status: 404
        };

      case 'INTERNAL_SERVER_ERROR':
        set.status = 500;
        return {
          success: false,
          error: 'Internal server error',
          status: 500
        };

      default:
        set.status = 500;
        return {
          success: false,
          error: 'An unexpected error occurred',
          status: 500
        };
    }
  });

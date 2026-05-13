import { Elysia } from 'elysia';

export const loggingMiddleware = new Elysia({ name: 'logging' })
  .onRequest(({ request }) => {
    const timestamp = new Date().toISOString();
    const method = request.method;
    const url = request.url;
    const userAgent = request.headers.get('user-agent') || 'Unknown';
    
    console.log(`📥 [${timestamp}] ${method} ${new URL(url).pathname}`);
    console.log(`   URL: ${url}`);
    console.log(`   User-Agent: ${userAgent}`);
  })
  .onBeforeHandle(({ request, body, query, params }) => {
    const timestamp = new Date().toISOString();
    const path = new URL(request.url).pathname;
    
    console.log(`🔍 [${timestamp}] Processing ${path}`);
    
    // Log query parameters
    if (query && Object.keys(query).length > 0) {
      console.log(`   Query:`, query);
    }
    
    // Log path parameters
    if (params && Object.keys(params).length > 0) {
      console.log(`   Params:`, params);
    }
    
    // Log body for POST/PUT/PATCH requests
    if (body && ['POST', 'PUT', 'PATCH'].includes(request.method)) {
      console.log(`   Body:`, JSON.stringify(body, null, 2));
    }
    
    // Log headers (excluding sensitive ones)
    const headers = Object.fromEntries(request.headers.entries());
    const sanitizedHeaders = { ...headers };
    delete sanitizedHeaders.authorization;
    delete sanitizedHeaders.cookie;
    
    if (Object.keys(sanitizedHeaders).length > 0) {
      console.log(`   Headers:`, sanitizedHeaders);
    }
  })
  .onAfterHandle(({ request, set }: any) => {
    const timestamp = new Date().toISOString();
    const path = new URL(request.url).pathname;
    const status = set.status || 200;
    const responseTime = set.headers?.['x-response-time'] || 'N/A';
    
    console.log(`📤 [${timestamp}] ${request.method} ${path} - Status: ${status} - Time: ${responseTime}`);
  })
  .onError(({ error, code, request }: any) => {
    const timestamp = new Date().toISOString();
    const path = new URL(request.url).pathname;
    console.log(`❌ [${timestamp}] Error in ${request.method} ${path}`);
    console.log(`   Code: ${code}`);
    console.log(`   Error:`, error.message);
    if (error.stack) {
      console.log(`   Stack:`, error.stack);
    }
  });

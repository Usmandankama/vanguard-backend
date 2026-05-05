import { redisService } from './redis.service';
import { DatabaseService } from './database.service';

/**
 * Monitoring Service - Handles application monitoring, logging, and health checks
 * This service provides comprehensive monitoring capabilities including
 * performance metrics, health checks, and system statistics.
 */
export class MonitoringService {
  private static metrics: Map<string, any> = new Map();
  private static startTime = Date.now();

  /**
   * Initialize monitoring service
   * Sets up metrics collection and health monitoring
   */
  static async initialize(): Promise<void> {
    console.log('📊 Initializing monitoring service...');
    
    // Initialize basic metrics
    this.metrics.set('uptime', 0);
    this.metrics.set('requests_total', 0);
    this.metrics.set('errors_total', 0);
    this.metrics.set('websocket_connections', 0);
    this.metrics.set('sos_alerts_created', 0);
    this.metrics.set('volunteer_responses', 0);

    // Start periodic health checks
    this.startHealthChecks();
    
    console.log('✅ Monitoring service initialized');
  }

  /**
   * Record a metric
   * @param metricName Name of the metric
   * @param value Metric value (optional, defaults to increment by 1)
   * @param labels Additional labels for the metric
   */
  static recordMetric(metricName: string, value?: number, labels?: Record<string, string>): void {
    const current = this.metrics.get(metricName) || 0;
    const newValue = value !== undefined ? value : current + 1;
    
    this.metrics.set(metricName, newValue);
    
    // Log important metrics
    if (['errors_total', 'sos_alerts_created'].includes(metricName)) {
      console.log(`📈 Metric ${metricName}: ${newValue}`);
    }
  }

  /**
   * Increment a counter metric
   * @param metricName Name of the metric
   * @param labels Additional labels
   */
  static incrementCounter(metricName: string, labels?: Record<string, string>): void {
    this.recordMetric(metricName, undefined, labels);
  }

  /**
   * Set a gauge metric
   * @param metricName Name of the metric
   * @param value Metric value
   * @param labels Additional labels
   */
  static setGauge(metricName: string, value: number, labels?: Record<string, string>): void {
    this.recordMetric(metricName, value, labels);
  }

  /**
   * Record response time
   * @param endpoint API endpoint
   * @param responseTime Response time in milliseconds
   * @param statusCode HTTP status code
   */
  static recordResponseTime(endpoint: string, responseTime: number, statusCode: number): void {
    const metricName = `response_time_${endpoint.replace(/[^a-zA-Z0-9]/g, '_')}`;
    this.recordMetric(metricName, responseTime);
    
    // Record error if status code indicates error
    if (statusCode >= 400) {
      this.incrementCounter('errors_total', { endpoint, status_code: statusCode.toString() });
    }
  }

  /**
   * Get all metrics
   * @returns All collected metrics
   */
  static getMetrics(): Record<string, any> {
    const metrics: Record<string, any> = {};
    
    // Update uptime
    this.metrics.set('uptime', Date.now() - this.startTime);
    
    // Convert Map to plain object
    for (const [key, value] of this.metrics.entries()) {
      metrics[key] = value;
    }
    
    return metrics;
  }

  /**
   * Get system health status
   * @returns Comprehensive health status
   */
  static async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    uptime: number;
    timestamp: string;
    services: {
      database: {
        status: 'healthy' | 'unhealthy';
        latency: number;
        error?: string;
      };
      redis: {
        status: 'healthy' | 'unhealthy';
        error?: string;
      };
      websocket: {
        status: 'healthy' | 'degraded' | 'unhealthy';
        connections: number;
      };
    };
    metrics: Record<string, any>;
  }> {
    const timestamp = new Date().toISOString();
    const uptime = Date.now() - this.startTime;
    
    // Check database health
    const dbHealth = await DatabaseService.checkHealth();
    
    // Check Redis health
    let redisStatus: 'healthy' | 'unhealthy' = 'healthy';
    let redisError: string | undefined;
    
    try {
      const redisStats = await redisService.getStats();
      // Consider Redis unhealthy if no connected clients
      if (redisStats.connectedClients === 0) {
        redisStatus = 'unhealthy';
        redisError = 'No connected clients';
      }
    } catch (error: any) {
      redisStatus = 'unhealthy';
      redisError = error.message;
    }
    
    // Get WebSocket connection count
    const activeConnections = await this.getActiveWebSocketConnections();
    
    // Determine overall health
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (!dbHealth.primary || redisStatus === 'unhealthy') {
      overallStatus = 'unhealthy';
    } else if (activeConnections === 0) {
      overallStatus = 'degraded';
    }
    
    return {
      status: overallStatus,
      uptime,
      timestamp,
      services: {
        database: {
          status: dbHealth.primary ? 'healthy' : 'unhealthy',
          latency: dbHealth.latency.primary,
          error: !dbHealth.primary ? 'Database connection failed' : undefined
        },
        redis: {
          status: redisStatus,
          error: redisError
        },
        websocket: {
          status: activeConnections > 0 ? 'healthy' : 'degraded',
          connections: activeConnections
        }
      },
      metrics: this.getMetrics()
    };
  }

  /**
   * Get performance statistics
   * @returns Performance metrics
   */
  static async getPerformanceStats(): Promise<{
    response_times: Record<string, number>;
    error_rates: Record<string, number>;
    throughput: {
      requests_per_minute: number;
      sos_alerts_per_hour: number;
    };
    resources: {
      memory_usage: string;
      cpu_usage: number;
      database_connections: any;
      redis_memory: string;
    };
  }> {
    const metrics = this.getMetrics();
    
    // Calculate response times
    const responseTimes: Record<string, number> = {};
    for (const [key, value] of Object.entries(metrics)) {
      if (key.startsWith('response_time_')) {
        responseTimes[key] = value;
      }
    }
    
    // Calculate error rates
    const errorRates: Record<string, number> = {};
    const totalRequests = metrics.requests_total || 0;
    const totalErrors = metrics.errors_total || 0;
    
    errorRates.overall = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
    
    // Calculate throughput
    const uptimeMinutes = this.metrics.get('uptime') / 60000; // Convert to minutes
    const requestsPerMinute = uptimeMinutes > 0 ? (totalRequests / uptimeMinutes) : 0;
    const sosAlertsPerHour = uptimeMinutes > 0 ? ((metrics.sos_alerts_created || 0) / (uptimeMinutes / 60)) : 0;
    
    // Get resource usage
    const memoryUsage = process.memoryUsage();
    const dbConnections = DatabaseService.getConnectionStats();
    const redisStats = await redisService.getStats();
    
    return {
      response_times: responseTimes,
      error_rates: errorRates,
      throughput: {
        requests_per_minute: Math.round(requestsPerMinute * 100) / 100,
        sos_alerts_per_hour: Math.round(sosAlertsPerHour * 100) / 100
      },
      resources: {
        memory_usage: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
        cpu_usage: process.cpuUsage().user / 1000000, // Convert to seconds
        database_connections: dbConnections,
        redis_memory: redisStats.usedMemory
      }
    };
  }

  /**
   * Start periodic health checks
   */
  private static startHealthChecks(): void {
    // Run health checks every 30 seconds
    setInterval(async () => {
      try {
        const health = await this.getHealthStatus();
        
        // Log health status
        if (health.status === 'unhealthy') {
          console.error('🚨 System health check failed:', health);
        } else if (health.status === 'degraded') {
          console.warn('⚠️ System health degraded:', health);
        } else {
          console.log('✅ System health check passed');
        }
        
        // Update metrics
        this.setGauge('websocket_connections', health.services.websocket.connections);
        
      } catch (error: any) {
        console.error('❌ Health check failed:', error);
      }
    }, 30000); // 30 seconds
  }

  /**
   * Get active WebSocket connections count
   * @returns Number of active connections
   */
  private static async getActiveWebSocketConnections(): Promise<number> {
    try {
      // This would typically come from the WebSocket service
      // For now, we'll use Redis to count active connections
      const connectionKeys = await redisService.getStats();
      return connectionKeys.connectedClients;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Log an event with structured data
   * @param level Log level
   * @param message Log message
   * @param data Additional data
   */
  static logEvent(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
      uptime: Date.now() - this.startTime
    };
    
    // Log to console (in production, this would go to a logging service)
    switch (level) {
      case 'info':
        console.log('ℹ️', JSON.stringify(logEntry));
        break;
      case 'warn':
        console.warn('⚠️', JSON.stringify(logEntry));
        break;
      case 'error':
        console.error('❌', JSON.stringify(logEntry));
        break;
    }
    
    // In production, you might send this to Elasticsearch, Logstash, etc.
  }

  /**
   * Create an alert for monitoring
   * @param alertType Type of alert
   * @param message Alert message
   * @param severity Alert severity
   * @param data Additional data
   */
  static createAlert(
    alertType: string,
    message: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    data?: any
  ): void {
    const alert = {
      id: `alert_${Date.now()}`,
      type: alertType,
      message,
      severity,
      timestamp: new Date().toISOString(),
      data,
      resolved: false
    };
    
    // Log the alert
    this.logEvent('warn', `ALERT: ${alertType} - ${message}`, alert);
    
    // In production, you might send this to PagerDuty, Slack, etc.
    if (severity === 'critical') {
      console.error('🚨 CRITICAL ALERT:', alert);
    }
  }

  /**
   * Get application statistics summary
   * @returns Summary statistics
   */
  static async getStatisticsSummary(): Promise<{
    application: {
      name: string;
      version: string;
      uptime: string;
      environment: string;
    };
    performance: {
      total_requests: number;
      total_errors: number;
      error_rate: number;
      avg_response_time: number;
    };
    system: {
      memory_usage: string;
      websocket_connections: number;
      active_sos_alerts: number;
    };
    database: {
      status: string;
      connection_pool: any;
    };
  }> {
    const metrics = this.getMetrics();
    const performance = await this.getPerformanceStats();
    const health = await this.getHealthStatus();
    
    const totalRequests = metrics.requests_total || 0;
    const totalErrors = metrics.errors_total || 0;
    const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
    
    // Calculate average response time
    let avgResponseTime = 0;
    let responseTimeCount = 0;
    for (const [key, value] of Object.entries(metrics)) {
      if (key.startsWith('response_time_')) {
        avgResponseTime += value;
        responseTimeCount++;
      }
    }
    avgResponseTime = responseTimeCount > 0 ? avgResponseTime / responseTimeCount : 0;
    
    return {
      application: {
        name: 'Vanguard Emergency Response Backend',
        version: process.env.npm_package_version || '1.0.0',
        uptime: this.formatUptime(metrics.uptime),
        environment: process.env.NODE_ENV || 'development'
      },
      performance: {
        total_requests: totalRequests,
        total_errors: totalErrors,
        error_rate: Math.round(errorRate * 100) / 100,
        avg_response_time: Math.round(avgResponseTime * 100) / 100
      },
      system: {
        memory_usage: performance.resources.memory_usage,
        websocket_connections: health.services.websocket.connections,
        active_sos_alerts: metrics.sos_alerts_created || 0
      },
      database: {
        status: health.services.database.status,
        connection_pool: performance.resources.database_connections
      }
    };
  }

  /**
   * Format uptime for human readability
   * @param uptime Uptime in milliseconds
   * @returns Formatted uptime string
   */
  private static formatUptime(uptime: number): string {
    const seconds = Math.floor(uptime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Reset all metrics (useful for testing)
   */
  static resetMetrics(): void {
    this.metrics.clear();
    this.startTime = Date.now();
  }
}

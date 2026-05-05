// import Redis from 'ioredis';

// /**
//  * Redis Service for caching active connections and real-time data
//  * This service provides high-performance caching for WebSocket connections,
//  * user sessions, and frequently accessed data to reduce database load.
//  */
// export class RedisService {
//   private redis: Redis;
//   private readonly CONNECTION_TTL = 3600; // 1 hour
//   private readonly SESSION_TTL = 1800; // 30 minutes
//   private readonly LOCATION_TTL = 300; // 5 minutes

//   constructor() {
//     // Initialize Redis connection with configuration
//     this.redis = new Redis({
//       host: process.env.REDIS_HOST || 'localhost',
//       port: parseInt(process.env.REDIS_PORT || '6379'),
//       password: process.env.REDIS_PASSWORD,
//       retryDelayOnFailover: 100,
//       maxRetriesPerRequest: 3,
//       lazyConnect: true,
//     });

//     // Handle Redis connection events
//     this.redis.on('connect', () => {
//       console.log('✅ Redis connected successfully');
//     });

//     this.redis.on('error', (error) => {
//       console.error('❌ Redis connection error:', error);
//     });

//     this.redis.on('close', () => {
//       console.log('🔌 Redis connection closed');
//     });
//   }

//   /**
//    * Initialize Redis connection
//    * @returns Promise that resolves when connected
//    */
//   async connect(): Promise<void> {
//     try {
//       await this.redis.connect();
//       console.log('🚀 Redis service initialized');
//     } catch (error) {
//       console.error('Failed to connect to Redis:', error);
//       throw error;
//     }
//   }

//   /**
//    * Store active WebSocket connection in Redis
//    * @param userId User ID
//    * @param connectionId WebSocket connection ID
//    * @param metadata Additional connection metadata
//    */
//   async storeActiveConnection(
//     userId: string, 
//     connectionId: string, 
//     metadata: { lastPing: string; userAgent?: string } = { lastPing: new Date().toISOString() }
//   ): Promise<void> {
//     try {
//       const key = `connection:${connectionId}`;
//       const userKey = `user_connections:${userId}`;
      
//       // Store connection details
//       await this.redis.hmset(key, {
//         userId,
//         connectionId,
//         lastPing: metadata.lastPing,
//         userAgent: metadata.userAgent || 'unknown',
//         connectedAt: new Date().toISOString()
//       });

//       // Set expiration
//       await this.redis.expire(key, this.CONNECTION_TTL);

//       // Add to user's connection set
//       await this.redis.sadd(userKey, connectionId);
//       await this.redis.expire(userKey, this.CONNECTION_TTL);

//       console.log(`📡 Stored connection ${connectionId} for user ${userId}`);
//     } catch (error) {
//       console.error('Error storing active connection:', error);
//       throw error;
//     }
//   }

//   /**
//    * Get active connection details
//    * @param connectionId WebSocket connection ID
//    * @returns Connection details or null if not found
//    */
//   async getActiveConnection(connectionId: string): Promise<{
//     userId: string;
//     connectionId: string;
//     lastPing: string;
//     userAgent: string;
//     connectedAt: string;
//   } | null> {
//     try {
//       const key = `connection:${connectionId}`;
//       const data = await this.redis.hgetall(key);
      
//       if (!data || Object.keys(data).length === 0) {
//         return null;
//       }

//       return {
//         userId: data.userId,
//         connectionId: data.connectionId,
//         lastPing: data.lastPing,
//         userAgent: data.userAgent,
//         connectedAt: data.connectedAt
//       };
//     } catch (error) {
//       console.error('Error getting active connection:', error);
//       return null;
//     }
//   }

//   /**
//    * Remove active connection from Redis
//    * @param connectionId WebSocket connection ID
//    */
//   async removeActiveConnection(connectionId: string): Promise<void> {
//     try {
//       const connection = await this.getActiveConnection(connectionId);
      
//       if (connection) {
//         const key = `connection:${connectionId}`;
//         const userKey = `user_connections:${connection.userId}`;
        
//         // Remove connection
//         await this.redis.del(key);
        
//         // Remove from user's connection set
//         await this.redis.srem(userKey, connectionId);
        
//         console.log(`🗑️ Removed connection ${connectionId} for user ${connection.userId}`);
//       }
//     } catch (error) {
//       console.error('Error removing active connection:', error);
//       throw error;
//     }
//   }

//   /**
//    * Get all active connections for a user
//    * @param userId User ID
//    * @returns Array of connection IDs
//    */
//   async getUserConnections(userId: string): Promise<string[]> {
//     try {
//       const userKey = `user_connections:${userId}`;
//       return await this.redis.smembers(userKey);
//     } catch (error) {
//       console.error('Error getting user connections:', error);
//       return [];
//     }
//   }

//   /**
//    * Update connection last ping timestamp
//    * @param connectionId WebSocket connection ID
//    */
//   async updateConnectionPing(connectionId: string): Promise<void> {
//     try {
//       const key = `connection:${connectionId}`;
//       await this.redis.hset(key, 'lastPing', new Date().toISOString());
//       await this.redis.expire(key, this.CONNECTION_TTL); // Refresh TTL
//     } catch (error) {
//       console.error('Error updating connection ping:', error);
//     }
//   }

//   /**
//    * Store user location in Redis for fast access
//    * @param userId User ID
//    * @param location Location data
//    */
//   async storeUserLocation(
//     userId: string, 
//     location: { latitude: number; longitude: number; accuracy?: number; timestamp: string }
//   ): Promise<void> {
//     try {
//       const key = `location:${userId}`;
//       await this.redis.hmset(key, {
//         userId,
//         latitude: location.latitude.toString(),
//         longitude: location.longitude.toString(),
//         accuracy: location.accuracy?.toString() || 'null',
//         timestamp: location.timestamp
//       });

//       // Set expiration for location data
//       await this.redis.expire(key, this.LOCATION_TTL);

//       // Also add to geospatial index for nearby queries
//       await this.redis.geoadd('user_locations', location.longitude, location.latitude, userId);
//       await this.redis.expire('user_locations', this.LOCATION_TTL);

//       console.log(`📍 Stored location for user ${userId}`);
//     } catch (error) {
//       console.error('Error storing user location:', error);
//       throw error;
//     }
//   }

//   /**
//    * Get user location from Redis cache
//    * @param userId User ID
//    * @returns Location data or null if not found
//    */
//   async getUserLocation(userId: string): Promise<{
//     latitude: number;
//     longitude: number;
//     accuracy?: number;
//     timestamp: string;
//   } | null> {
//     try {
//       const key = `location:${userId}`;
//       const data = await this.redis.hgetall(key);
      
//       if (!data || Object.keys(data).length === 0) {
//         return null;
//       }

//       return {
//         latitude: parseFloat(data.latitude),
//         longitude: parseFloat(data.longitude),
//         accuracy: data.accuracy !== 'null' ? parseFloat(data.accuracy) : undefined,
//         timestamp: data.timestamp
//       };
//     } catch (error) {
//       console.error('Error getting user location from cache:', error);
//       return null;
//     }
//   }

//   /**
//    * Find nearby users using Redis geospatial commands
//    * @param latitude Center latitude
//    * @param longitude Center longitude
//    * @param radiusMeters Search radius in meters
//    * @param userType Filter by user type (optional)
//    * @returns Array of nearby user IDs with distances
//    */
//   async findNearbyUsers(
//     latitude: number, 
//     longitude: number, 
//     radiusMeters: number,
//     userType?: 'victim' | 'volunteer'
//   ): Promise<Array<{ userId: string; distance: number }>> {
//     try {
//       // Use Redis geospatial search
//       const results = await this.redis.geosearch(
//         'user_locations',
//         longitude,
//         latitude,
//         radiusMeters,
//         'm'
//       );

//       const nearbyUsers: Array<{ userId: string; distance: number }> = [];
      
//       for (let i = 0; i < results.length; i += 2) {
//         const userId = results[i];
//         const distance = parseFloat(results[i + 1]);
        
//         // Filter by user type if specified
//         if (userType) {
//           const userKey = `user:${userId}`;
//           const userTypeCached = await this.redis.hget(userKey, 'type');
          
//           if (userTypeCached !== userType) {
//             continue;
//           }
//         }
        
//         nearbyUsers.push({ userId, distance });
//       }

//       return nearbyUsers.sort((a, b) => a.distance - b.distance);
//     } catch (error) {
//       console.error('Error finding nearby users:', error);
//       return [];
//     }
//   }

//   /**
//    * Cache SOS alert for fast access
//    * @param alertId SOS alert ID
//    * @param alertData Alert data
//    */
//   async cacheSOSAlert(alertId: string, alertData: any): Promise<void> {
//     try {
//       const key = `sos:${alertId}`;
//       await this.redis.hmset(key, alertData);
//       await this.redis.expire(key, this.CONNECTION_TTL);
      
//       // Add to active alerts set
//       await this.redis.sadd('active_sos', alertId);
//       await this.redis.expire('active_sos', this.CONNECTION_TTL);
//     } catch (error) {
//       console.error('Error caching SOS alert:', error);
//     }
//   }

//   /**
//    * Get cached SOS alert
//    * @param alertId SOS alert ID
//    * @returns Alert data or null if not found
//    */
//   async getCachedSOSAlert(alertId: string): Promise<any | null> {
//     try {
//       const key = `sos:${alertId}`;
//       const data = await this.redis.hgetall(key);
      
//       if (!data || Object.keys(data).length === 0) {
//         return null;
//       }

//       return data;
//     } catch (error) {
//       console.error('Error getting cached SOS alert:', error);
//       return null;
//     }
//   }

//   /**
//    * Remove SOS alert from cache
//    * @param alertId SOS alert ID
//    */
//   async removeCachedSOSAlert(alertId: string): Promise<void> {
//     try {
//       const key = `sos:${alertId}`;
//       await this.redis.del(key);
//       await this.redis.srem('active_sos', alertId);
//     } catch (error) {
//       console.error('Error removing cached SOS alert:', error);
//     }
//   }

//   /**
//    * Get all active SOS alerts from cache
//    * @returns Array of active SOS alert IDs
//    */
//   async getActiveSOSAlerts(): Promise<string[]> {
//     try {
//       return await this.redis.smembers('active_sos');
//     } catch (error) {
//       console.error('Error getting active SOS alerts:', error);
//       return [];
//     }
//   }

//   /**
//    * Store user session data
//    * @param userId User ID
//    * @param sessionData Session data
//    */
//   async storeUserSession(userId: string, sessionData: any): Promise<void> {
//     try {
//       const key = `session:${userId}`;
//       await this.redis.hmset(key, sessionData);
//       await this.redis.expire(key, this.SESSION_TTL);
//     } catch (error) {
//       console.error('Error storing user session:', error);
//     }
//   }

//   /**
//    * Get user session data
//    * @param userId User ID
//    * @returns Session data or null if not found
//    */
//   async getUserSession(userId: string): Promise<any | null> {
//     try {
//       const key = `session:${userId}`;
//       const data = await this.redis.hgetall(key);
      
//       if (!data || Object.keys(data).length === 0) {
//         return null;
//       }

//       return data;
//     } catch (error) {
//       console.error('Error getting user session:', error);
//       return null;
//     }
//   }

//   /**
//    * Clean up expired connections (maintenance task)
//    * @returns Number of cleaned up connections
//    */
//   async cleanupExpiredConnections(): Promise<number> {
//     try {
//       const cutoffTime = new Date(Date.now() - 90000).toISOString(); // 90 seconds ago
//       const pattern = 'connection:*';
//       const keys = await this.redis.keys(pattern);
      
//       let cleanedCount = 0;
      
//       for (const key of keys) {
//         const lastPing = await this.redis.hget(key, 'lastPing');
        
//         if (lastPing && lastPing < cutoffTime) {
//           const connectionId = key.replace('connection:', '');
//           await this.removeActiveConnection(connectionId);
//           cleanedCount++;
//         }
//       }

//       if (cleanedCount > 0) {
//         console.log(`🧹 Cleaned up ${cleanedCount} expired connections`);
//       }

//       return cleanedCount;
//     } catch (error) {
//       console.error('Error cleaning up expired connections:', error);
//       return 0;
//     }
//   }

//   /**
//    * Get Redis statistics for monitoring
//    * @returns Redis performance metrics
//    */
//   async getStats(): Promise<{
//     connectedClients: number;
//     usedMemory: string;
//     totalCommands: number;
//     keyspaceHits: number;
//     keyspaceMisses: number;
//   }> {
//     try {
//       const info = await this.redis.info();
//       const lines = info.split('\r\n');
      
//       const stats: any = {};
      
//       for (const line of lines) {
//         if (line.includes(':')) {
//           const [key, value] = line.split(':');
//           stats[key] = value;
//         }
//       }

//       return {
//         connectedClients: parseInt(stats.connected_clients || '0'),
//         usedMemory: stats.used_memory_human || '0B',
//         totalCommands: parseInt(stats.total_commands_processed || '0'),
//         keyspaceHits: parseInt(stats.keyspace_hits || '0'),
//         keyspaceMisses: parseInt(stats.keyspace_misses || '0')
//       };
//     } catch (error) {
//       console.error('Error getting Redis stats:', error);
//       return {
//         connectedClients: 0,
//         usedMemory: '0B',
//         totalCommands: 0,
//         keyspaceHits: 0,
//         keyspaceMisses: 0
//       };
//     }
//   }

//   /**
//    * Close Redis connection
//    */
//   async disconnect(): Promise<void> {
//     try {
//       await this.redis.quit();
//       console.log('🔌 Redis connection closed');
//     } catch (error) {
//       console.error('Error closing Redis connection:', error);
//     }
//   }
// }

// // Export singleton instance
// export const redisService = new RedisService();

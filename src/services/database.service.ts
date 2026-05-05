import { Sequelize, QueryTypes } from 'sequelize';

export class DatabaseService {
  private static primaryInstance: Sequelize | null = null;
  private static replicaInstance: Sequelize | null = null;
  private static isInitialized = false;

  static async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // 1. Primary Database (For all Writes and real-time updates)
      this.primaryInstance = new Sequelize({
        database: process.env.DB_NAME || 'vanguard_db',
        username: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'password',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        dialect: 'postgres',
        logging: false, // Disables raw SQL spam in the terminal
        pool: {
          max: 20, // Maximum concurrent connections
          min: 5,  // Minimum idle connections
          acquire: 30000,
          idle: 10000
        }
      });

      // 2. Replica Database (Optional: For heavy read queries if scaling)
      if (process.env.DB_REPLICA_HOST) {
        this.replicaInstance = new Sequelize({
          database: process.env.DB_REPLICA_NAME || process.env.DB_NAME || 'vanguard_db',
          username: process.env.DB_REPLICA_USER || process.env.DB_USER || 'postgres',
          password: process.env.DB_REPLICA_PASSWORD || process.env.DB_PASSWORD || 'postgres',
          host: process.env.DB_REPLICA_HOST,
          port: parseInt(process.env.DB_REPLICA_PORT || '5432'),
          dialect: 'postgres',
          logging: false,
          pool: {
            max: 10,
            min: 2,
            acquire: 30000,
            idle: 10000
          }
        });
      }

      // 3. Test Connections
      await this.primaryInstance.authenticate();
      console.log('✅ PostgreSQL Primary Connection Established');

      if (this.replicaInstance) {
        await this.replicaInstance.authenticate();
        console.log('✅ PostgreSQL Replica Connection Established');
      }

      // 4. Verify PostGIS is Active (Critical for Golden Hour Routing)
      try {
        await this.primaryInstance.query('CREATE EXTENSION IF NOT EXISTS postgis;');
        console.log('🌐 PostGIS Geospatial Extension Verified');
      } catch (err) {
        console.warn('⚠️ PostGIS verification failed. Ensure PostGIS is installed on your Postgres server.');
      }

      this.isInitialized = true;
    } catch (error) {
      console.error('❌ FATAL: Database Initialization Failed', error);
      throw error; // Let the boot sequence catch this and crash the app safely
    }
  }

  // --- Accessors for Controllers ---

  static getPrimary(): Sequelize {
    if (!this.primaryInstance) throw new Error('Primary DB not initialized. Call initialize() first.');
    return this.primaryInstance;
  }

  static getReplica(): Sequelize {
    return this.replicaInstance || this.getPrimary();
  }

  // --- High-Performance Query Wrappers ---

  static async executeReadQuery(query: string, replacements?: any): Promise<any[]> {
    const instance = this.getReplica();
    const [results] = await instance.query(query, { 
      replacements,
      type: QueryTypes.SELECT 
    });
    return results as any[];
  }

  static async executeWriteQuery(query: string, replacements?: any[]): Promise<void> {
    const instance = this.getPrimary();
    await instance.query(query, { 
      replacements,
      type: QueryTypes.UPDATE
    });
  }

  static async close(): Promise<void> {
    if (this.primaryInstance) await this.primaryInstance.close();
    if (this.replicaInstance) await this.replicaInstance.close();
    this.isInitialized = false;
    console.log('🔌 Database Connections Closed Safely');
  }
}
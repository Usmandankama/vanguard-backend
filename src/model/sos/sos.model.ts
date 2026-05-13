import { DataTypes, Model, type Optional } from 'sequelize';
import { DatabaseService } from '../../services/database.service';

// 1. Define the attributes
export interface SOSAlertAttributes {
  id: string;
  victim_id: string;
  responder_id?: string | null;
  type: 'medical' | 'fire' | 'crime' | 'accident';
  description?: string;
  metadata?: any; // JSONB - This holds the survey (e.g., { injured: true, trapped: false })
  location: any;  // Geometry Point (SRID: 4326)
  status: 'pending' | 'responding' | 'resolved' | 'cancelled';
  createdAt?: Date;
  updatedAt?: Date;
}

// 2. Define creation attributes (Optional fields during creation)
export interface SOSAlertCreationAttributes extends Optional<SOSAlertAttributes, 'id' | 'responder_id' | 'description' | 'metadata' | 'status'> {}

// 3. Define the Class
export class SOSAlert extends Model<SOSAlertAttributes, SOSAlertCreationAttributes> implements SOSAlertAttributes {
  declare id: string;
  declare victim_id: string;
  declare responder_id: string | null;
  declare type: 'medical' | 'fire' | 'crime' | 'accident';
  declare description: string;
  declare metadata: any;
  declare location: any;
  declare status: 'pending' | 'responding' | 'resolved' | 'cancelled';

  // Timestamps
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

// 4. Initialize the Model Configuration
export const initSOSModel = () => {
  const sequelize = DatabaseService.getPrimary();

  SOSAlert.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      victim_id: {
        type: DataTypes.UUID,
        allowNull: false,
        // We will define the actual foreign key association in an index.ts file
      },
      responder_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      type: {
        type: DataTypes.ENUM('medical', 'fire', 'crime', 'accident'),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSONB, // Flexible data structure for mobile survey responses
        allowNull: true,
      },
      location: {
        type: DataTypes.GEOMETRY('POINT', 4326), // Critical PostGIS Declaration
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('pending', 'responding', 'resolved', 'cancelled'),
        defaultValue: 'pending',
        allowNull: false,
      },
    },
    {
      sequelize,
      tableName: 'sos_alerts',
      timestamps: true,
      indexes: [
        {
          name: 'sos_location_gist',
          fields: ['location'],
          using: 'GIST', // Spatial Index for fast map rendering
        },
        {
          name: 'sos_status_idx',
          fields: ['status'], // Standard B-Tree index for filtering "active" alerts quickly
        }
      ],
    }
  );
};
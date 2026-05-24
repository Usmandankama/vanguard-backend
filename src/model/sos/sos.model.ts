import { DataTypes, Model, type Optional } from 'sequelize';
import { DatabaseService } from '../../services/database.service';

export interface SOSAlertAttributes {
  id: string;
  victim_id: string;
  responder_id?: string | null;
  type: 'medical' | 'fire' | 'crime' | 'accident';
  description?: string | null;
  metadata?: any;
  location: any;
  status: 'pending' | 'responding' | 'resolved' | 'cancelled';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SOSAlertCreationAttributes
  extends Optional<
    SOSAlertAttributes,
    'id' | 'responder_id' | 'description' | 'metadata' | 'status'
  > {}

export class SOSAlert
  extends Model<SOSAlertAttributes, SOSAlertCreationAttributes>
  implements SOSAlertAttributes
{
  declare id: string;
  declare victim_id: string;
  declare responder_id: string | null;
  declare type: 'medical' | 'fire' | 'crime' | 'accident';
  declare description: string | null;
  declare metadata: any;
  declare location: any;
  declare status: 'pending' | 'responding' | 'resolved' | 'cancelled';
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  // ── Sequelize aliased accessors ──────────────────────────────────────────
  // Sequelize maps snake_case columns to camelCase getters automatically.
  // Declaring them here gives TypeScript the correct types instead of `any`.
  declare victimId: string;       // alias for victim_id
  declare responderId: string | null; // alias for responder_id

  // ── Fields that are NOT in the DB schema yet ─────────────────────────────
  // These are referenced in service code but the columns are commented out
  // on the model init below. Typed as optional so optional chaining works.
  declare respondedAt?: Date | null;
  declare responderName?: string | null;

  // ── Computed field — NOT stored in DB ────────────────────────────────────
  // distance is calculated by PostGIS ST_Distance in raw queries and
  // attached to query result rows. It is never written via update().
  declare distance?: number | null;
}

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
        type: DataTypes.JSONB,
        allowNull: true,
      },
      location: {
        type: DataTypes.GEOMETRY('POINT', 4326),
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
          using: 'GIST',
        },
        {
          name: 'sos_status_idx',
          fields: ['status'],
        },
      ],
    },
  );
};
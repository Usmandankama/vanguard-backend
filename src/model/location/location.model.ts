import { Model, DataTypes, Sequelize, type InferAttributes, type InferCreationAttributes, type CreationOptional } from 'sequelize';

export class LocationHistory extends Model<InferAttributes<LocationHistory>, InferCreationAttributes<LocationHistory>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare latitude: number;
  declare longitude: number;
  declare accuracy: number | null;
  declare timestamp: Date;
  declare createdAt: CreationOptional<Date>;
}

export const initLocationModel = (sequelize: Sequelize) => {
  LocationHistory.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
    },
    latitude: {
      type: DataTypes.DECIMAL(10, 8),
      allowNull: false,
    },
    longitude: {
      type: DataTypes.DECIMAL(11, 8),
      allowNull: false,
    },
    accuracy: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    createdAt: DataTypes.DATE,
  }, { 
    sequelize, 
    modelName: 'LocationHistory',
    tableName: 'location_history'
  });
};

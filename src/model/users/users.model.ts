import { DataTypes, Model, type Optional } from 'sequelize';
import { DatabaseService } from '../../services/database.service';

// 1. Define the attributes exactly as they exist in the DB
export interface UserAttributes {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: 'victim' | 'volunteer';
  is_verified: boolean;
  last_location?: any; // Sequelize formats PostGIS Points as GeoJSON objects
  createdAt?: Date;
  updatedAt?: Date;
}

// 2. Define attributes required for user creation (ID, verification, and location are generated/optional)
export interface UserCreationAttributes extends Optional<UserAttributes, 'id' | 'is_verified' | 'last_location'> {}

// 3. Define the Class
export class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  declare id: string;
  declare name: string;
  declare email: string;
  declare password: string;
  declare role: 'victim' | 'volunteer';
  declare is_verified: boolean;
  declare last_location?: any;

  // Timestamps
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

// 4. Initialize the Model Configuration
export const initUserModel = () => {
  const sequelize = DatabaseService.getPrimary();

  User.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      password: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      role: {
        type: DataTypes.ENUM('victim', 'volunteer'),
        allowNull: false,
      },
      is_verified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
      last_location: {
        type: DataTypes.GEOMETRY('POINT', 4326), // Critical PostGIS Declaration
        allowNull: true,
      },
    },
    {
      sequelize,
      tableName: 'users',
      timestamps: true,
      indexes: [
        {
          name: 'users_last_location_gist',
          fields: ['last_location'],
          using: 'GIST', // PostGIS Spatial Index for lightning-fast ST_DWithin queries
        },
      ],
    }
  );
};
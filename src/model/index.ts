import { User, initUserModel } from './users/users.model';
import { SOSAlert, initSOSModel } from './sos/sos.model';
import { setupAssociations } from '../utils/associations';
import { DatabaseService } from '../services/database.service';

// THIS is the function your main src/index.ts is calling!
export const initializeDatabaseModels = async () => {
  // 1. Initialize schemas
  initUserModel();
  initSOSModel();

  // 2. Establish Relationships
  setupAssociations();

  // 3. Sync Database 
  const sequelize = DatabaseService.getPrimary();
  await sequelize.sync({ alter: true }); 
  console.log('✅ Database Schemas Synchronized');
};

export { User, SOSAlert };
import { User } from '../model/users/users.model';
import { SOSAlert } from '../model/sos/sos.model';

export const setupAssociations = () => {
  // 1. Victim Relationship: A User (Victim) can raise many SOS Alerts
  User.hasMany(SOSAlert, { 
    foreignKey: 'victim_id', 
    as: 'raised_alerts' 
  });
  SOSAlert.belongsTo(User, { 
    foreignKey: 'victim_id', 
    as: 'victim' 
  });

  // 2. Responder Relationship: A User (Volunteer) can respond to many SOS Alerts
  User.hasMany(SOSAlert, { 
    foreignKey: 'responder_id', 
    as: 'responded_alerts' 
  });
  SOSAlert.belongsTo(User, { 
    foreignKey: 'responder_id', 
    as: 'responder' 
  });

  console.log('🔗 Database Associations Configured');
};
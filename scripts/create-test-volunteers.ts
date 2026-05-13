import { User } from '../src/model/users/users.model';
import { DatabaseService } from '../src/services/database.service';
import { initializeDatabaseModels } from '../src/model';
import bcrypt from 'bcryptjs';

// Update these coordinates to your actual location
const BASE_LOCATION = { lng: -73.9857, lat: 40.7484 }; // Change to your current coordinates

const testVolunteers = [
  {
    name: 'Sarah Chen',
    email: 'sarah.chen@volunteer.com',
    password: 'volunteer123',
    role: 'volunteer' as const,
    last_location: { type: 'Point', coordinates: [BASE_LOCATION.lng + 0.001, BASE_LOCATION.lat + 0.001] } // ~100m away
  },
  {
    name: 'Mike Rodriguez',
    email: 'mike.rodriguez@volunteer.com', 
    password: 'volunteer123',
    role: 'volunteer' as const,
    last_location: { type: 'Point', coordinates: [BASE_LOCATION.lng - 0.002, BASE_LOCATION.lat] } // ~200m away
  },
  {
    name: 'Emily Johnson',
    email: 'emily.johnson@volunteer.com',
    password: 'volunteer123', 
    role: 'volunteer' as const,
    is_verified: true,
    last_location: { type: 'Point', coordinates: [BASE_LOCATION.lng, BASE_LOCATION.lat - 0.003] } // ~300m away
  }
];

async function createTestVolunteers() {
  try {
    console.log('🚀 Creating test volunteers...');
    
    // Initialize database
    await DatabaseService.initialize();
    await initializeDatabaseModels();
    
    for (const volunteer of testVolunteers) {
      const hashedPassword = await bcrypt.hash(volunteer.password, 10);
      
      const [user, created] = await User.findOrCreate({
        where: { email: volunteer.email },
        defaults: {
          ...volunteer,
          password: hashedPassword,
          is_verified: volunteer.is_verified || false
        }
      });
      
      if (created) {
        console.log(`✅ Created volunteer: ${volunteer.name}`);
      } else {
        console.log(`⚠️  Volunteer already exists: ${volunteer.name}`);
      }
    }
    
    console.log('🎉 Test volunteers creation complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating volunteers:', error);
    process.exit(1);
  }
}

createTestVolunteers();

import { User } from '../src/model/users/users.model';
import { DatabaseService } from '../src/services/database.service';
import { initializeDatabaseModels } from '../src/model';

// Update these coordinates to your actual location
const BASE_LOCATION = { lng: -73.9857, lat: 40.7484 }; // Change to your current coordinates

async function updateVolunteerLocations() {
  try {
    console.log('🗺️  Updating volunteer locations...');
    
    // Initialize database
    await DatabaseService.initialize();
    await initializeDatabaseModels();
    
    // Get all volunteers
    const volunteers = await User.findAll({ where: { role: 'volunteer' } });
    
    for (let i = 0; i < volunteers.length; i++) {
      const volunteer = volunteers[i];
      if (!volunteer) continue;
      
      // Create small offsets to make them near but not at exact same location
      const offset = (i + 1) * 0.001; // ~100m increments
      const lng = BASE_LOCATION.lng + (offset * 0.5);
      const lat = BASE_LOCATION.lat + (offset * 0.3);
      
      await volunteer.update({
        last_location: { type: 'Point', coordinates: [lng, lat] },
        is_verified: true // Make them all verified for testing
      });
      
      console.log(`✅ Updated ${volunteer.name} - Location: [${lng}, ${lat}]`);
    }
    
    console.log('🎉 Volunteer locations updated!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error updating locations:', error);
    process.exit(1);
  }
}

updateVolunteerLocations();

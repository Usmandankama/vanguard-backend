/** Extract lat/lng from a Sequelize PostGIS GeoJSON point or legacy shapes. */
export function parsePointLocation(location: unknown): {
  latitude: number;
  longitude: number;
} | null {
  if (!location || typeof location !== 'object') return null;

  const loc = location as Record<string, unknown>;

  if (Array.isArray(loc.coordinates) && loc.coordinates.length >= 2) {
    const [lng, lat] = loc.coordinates as number[];
    if (typeof lat === 'number' && typeof lng === 'number') {
      return { latitude: lat, longitude: lng };
    }
  }

  if (typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
    return { latitude: loc.latitude, longitude: loc.longitude };
  }

  return null;
}

/** Build a PostGIS-compatible GeoJSON point for Sequelize GEOMETRY columns. */
export function toGeoJsonPoint(latitude: number, longitude: number) {
  return {
    type: 'Point' as const,
    coordinates: [longitude, latitude],
  };
}

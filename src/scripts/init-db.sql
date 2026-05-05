-- Vanguard Emergency Response System - Database Initialization
-- This script initializes the PostgreSQL database with PostGIS extension
-- and creates the necessary database schema for the emergency response system.

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "postgis_topology";

-- Create indexes for better performance
-- These will be created after the tables are initialized by Sequelize

-- Create custom types for better data integrity
DO $$ BEGIN
    CREATE TYPE user_type AS ENUM ('victim', 'volunteer');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE sos_status AS ENUM ('pending', 'responding', 'resolved', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create functions for distance calculations
CREATE OR REPLACE FUNCTION calculate_distance(lat1 FLOAT, lon1 FLOAT, lat2 FLOAT, lon2 FLOAT)
RETURNS FLOAT AS $$
BEGIN
    RETURN ST_Distance(
        ST_SetSRID(ST_MakePoint(lon1, lat1), 4326)::geography,
        ST_SetSRID(ST_MakePoint(lon2, lat2), 4326)::geography
    );
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create view for active SOS alerts with volunteer distances
CREATE OR REPLACE VIEW active_sos_with_distances AS
SELECT 
    sa.id,
    sa.victim_id,
    sa.type,
    sa.description,
    sa.status,
    sa.location,
    sa.created_at,
    sa.responded_at,
    sa.responder_id,
    sa.responder_name,
    sa.distance,
    u.name as victim_name,
    u.last_location as victim_location
FROM sos_alerts sa
LEFT JOIN users u ON sa.victim_id = u.id
WHERE sa.status IN ('pending', 'responding');

-- Create view for nearby volunteers
CREATE OR REPLACE VIEW nearby_volunteers AS
SELECT 
    u.id,
    u.name,
    u.type,
    u.last_location,
    u.created_at,
    u.updated_at
FROM users u
WHERE u.type = 'volunteer'
AND u.last_location IS NOT NULL;

-- Create function to find nearby volunteers for an SOS alert
CREATE OR REPLACE FUNCTION find_nearby_volunteers_for_sos(sos_id UUID, radius_meters INTEGER DEFAULT 5000)
RETURNS TABLE(
    volunteer_id UUID,
    volunteer_name VARCHAR,
    distance_meters FLOAT,
    volunteer_location GEOMETRY
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id,
        u.name,
        ST_Distance(
            u.last_location::geography,
            (sa.location->>'longitude')::float || ',' || (sa.location->>'latitude')::float::geography
        ) as distance,
        u.last_location
    FROM users u, sos_alerts sa
    WHERE u.type = 'volunteer'
    AND u.last_location IS NOT NULL
    AND sa.id = sos_id
    AND ST_DWithin(
        u.last_location::geography,
        ST_SetSRID(ST_MakePoint((sa.location->>'longitude')::float, (sa.location->>'latitude')::float), 4326)::geography,
        radius_meters
    )
    ORDER BY distance;
END;
$$ LANGUAGE plpgsql;

-- Create function for SOS alert statistics
CREATE OR REPLACE FUNCTION get_sos_statistics()
RETURNS TABLE(
    total_active BIGINT,
    pending_count BIGINT,
    responding_count BIGINT,
    resolved_today BIGINT,
    avg_response_time FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        (SELECT COUNT(*) FROM sos_alerts WHERE status IN ('pending', 'responding')),
        (SELECT COUNT(*) FROM sos_alerts WHERE status = 'pending'),
        (SELECT COUNT(*) FROM sos_alerts WHERE status = 'responding'),
        (SELECT COUNT(*) FROM sos_alerts WHERE status = 'resolved' AND DATE(created_at) = CURRENT_DATE),
        (SELECT AVG(EXTRACT(EPOCH FROM (responded_at - created_at))) 
         FROM sos_alerts 
         WHERE responded_at IS NOT NULL 
         AND DATE(created_at) = CURRENT_DATE);
END;
$$ LANGUAGE plpgsql;

-- Create function to cleanup old location history
CREATE OR REPLACE FUNCTION cleanup_old_location_history(days_to_keep INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM location_history 
    WHERE timestamp < NOW() - INTERVAL '1 day' * days_to_keep;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to cleanup expired connections
CREATE OR REPLACE FUNCTION cleanup_expired_connections()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM active_connections 
    WHERE last_ping < NOW() - INTERVAL '90 seconds';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create indexes for performance optimization
-- These indexes will be created by Sequelize, but we ensure they exist

-- Users table indexes
CREATE INDEX IF NOT EXISTS idx_users_type ON users(type);
CREATE INDEX IF NOT EXISTS idx_users_last_location ON users USING GIST(last_location);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- SOS alerts table indexes
CREATE INDEX IF NOT EXISTS idx_sos_alerts_status ON sos_alerts(status);
CREATE INDEX IF NOT EXISTS idx_sos_alerts_victim_id ON sos_alerts(victim_id);
CREATE INDEX IF NOT EXISTS idx_sos_alerts_responder_id ON sos_alerts(responder_id);
CREATE INDEX IF NOT EXISTS idx_sos_alerts_created_at ON sos_alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_sos_alerts_location ON sos_alerts USING GIN(
    to_tsvector('english', 
        COALESCE(type, '') || ' ' || 
        COALESCE(description, '') || ' ' || 
        COALESCE(location->>'latitude', '') || ' ' || 
        COALESCE(location->>'longitude', '')
    )
);

-- Location history table indexes
CREATE INDEX IF NOT EXISTS idx_location_history_user_id ON location_history(user_id);
CREATE INDEX IF NOT EXISTS idx_location_history_timestamp ON location_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_location_history_user_timestamp ON location_history(user_id, timestamp);

-- Active connections table indexes
CREATE INDEX IF NOT EXISTS idx_active_connections_user_id ON active_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_active_connections_connection_id ON active_connections(websocket_connection_id);
CREATE INDEX IF NOT EXISTS idx_active_connections_last_ping ON active_connections(last_ping);

-- Create composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sos_alerts_status_created ON sos_alerts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_type_location ON users(type, last_location) WHERE last_location IS NOT NULL;

-- Create partial indexes for better performance
CREATE INDEX IF NOT EXISTS idx_active_sos_alerts ON sos_alerts(id, created_at) WHERE status IN ('pending', 'responding');
CREATE INDEX IF NOT EXISTS idx_active_volunteers ON users(id, last_location) WHERE type = 'volunteer' AND last_location IS NOT NULL;

-- Create trigger for automatic timestamp updates
-- This will be handled by Sequelize, but we ensure it exists

-- Grant permissions (adjust based on your user setup)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO vanguard_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO vanguard_user;

-- Log initialization completion
DO $$
BEGIN
    RAISE NOTICE 'Vanguard Emergency Response Database initialized successfully';
    RAISE NOTICE 'PostGIS version: %', PostGIS_Version();
    RAISE NOTICE 'PostgreSQL version: %', version();
END $$;

-- GPS only. Apply to local first. Production requires separate approval and backup.
-- No employee GPS assignments are required.
-- Existing cham rows and authentication/personnel tables remain unchanged.
CREATE TABLE IF NOT EXISTS gps_locations (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, company TEXT NOT NULL,
 latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90), longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 radius REAL NOT NULL DEFAULT 200 CHECK(radius > 0), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created INTEGER NOT NULL, updated INTEGER NOT NULL
);
ALTER TABLE cham ADD COLUMN gps_location_id TEXT;
ALTER TABLE cham ADD COLUMN gps_location_label TEXT;
ALTER TABLE cham ADD COLUMN gps_distance REAL;
ALTER TABLE cham ADD COLUMN gps_accuracy REAL;
-- Do not turn GPS on here. Missing cfg.gps_on means OFF.

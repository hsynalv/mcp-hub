-- Hub persistence schema v015 — sidecar preferences + device platform metadata
-- Idempotent: safe to re-run

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sidecar_devices') AND name = 'platform')
BEGIN
  ALTER TABLE sidecar_devices ADD platform NVARCHAR(16) NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sidecar_devices') AND name = 'hostname')
BEGIN
  ALTER TABLE sidecar_devices ADD hostname NVARCHAR(256) NULL;
END;

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'sidecar_preferences')
BEGIN
  CREATE TABLE sidecar_preferences (
    actor_id    NVARCHAR(128)  NOT NULL,
    channel     NVARCHAR(32)   NOT NULL,
    device_id   UNIQUEIDENTIFIER NOT NULL,
    updated_at  DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_sidecar_preferences PRIMARY KEY (actor_id, channel)
  );
  CREATE INDEX IX_sidecar_prefs_device ON sidecar_preferences (device_id);
END;

IF NOT EXISTS (SELECT 1 FROM hub_schema_version WHERE version = 15)
BEGIN
  INSERT INTO hub_schema_version (version, applied_at) VALUES (15, SYSUTCDATETIME());
END;

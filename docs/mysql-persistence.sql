CREATE DATABASE IF NOT EXISTS `project_veil`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `project_veil`;

CREATE TABLE IF NOT EXISTS `room_snapshots` (
  room_id VARCHAR(191) NOT NULL,
  state_json LONGTEXT NOT NULL,
  battles_json LONGTEXT NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @veil_room_snapshots_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'room_snapshots'
    AND INDEX_NAME = 'idx_room_snapshots_updated_at'
);

SET @veil_room_snapshots_idx_sql := IF(
  @veil_room_snapshots_idx_exists = 0,
  'CREATE INDEX `idx_room_snapshots_updated_at` ON `room_snapshots` (updated_at)',
  'SELECT 1'
);

PREPARE veil_room_snapshots_idx_stmt FROM @veil_room_snapshots_idx_sql;
EXECUTE veil_room_snapshots_idx_stmt;
DEALLOCATE PREPARE veil_room_snapshots_idx_stmt;

CREATE TABLE IF NOT EXISTS `player_room_profiles` (
  room_id VARCHAR(191) NOT NULL,
  player_id VARCHAR(191) NOT NULL,
  heroes_json LONGTEXT NOT NULL,
  resources_json LONGTEXT NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @veil_player_profiles_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'player_room_profiles'
    AND INDEX_NAME = 'idx_player_room_profiles_updated_at'
);

SET @veil_player_profiles_idx_sql := IF(
  @veil_player_profiles_idx_exists = 0,
  'CREATE INDEX `idx_player_room_profiles_updated_at` ON `player_room_profiles` (updated_at)',
  'SELECT 1'
);

PREPARE veil_player_profiles_idx_stmt FROM @veil_player_profiles_idx_sql;
EXECUTE veil_player_profiles_idx_stmt;
DEALLOCATE PREPARE veil_player_profiles_idx_stmt;

CREATE TABLE IF NOT EXISTS `config_documents` (
  document_id VARCHAR(64) NOT NULL,
  content_json LONGTEXT NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  exported_at DATETIME NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @veil_config_documents_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'config_documents'
    AND INDEX_NAME = 'idx_config_documents_updated_at'
);

SET @veil_config_documents_idx_sql := IF(
  @veil_config_documents_idx_exists = 0,
  'CREATE INDEX `idx_config_documents_updated_at` ON `config_documents` (updated_at)',
  'SELECT 1'
);

PREPARE veil_config_documents_idx_stmt FROM @veil_config_documents_idx_sql;
EXECUTE veil_config_documents_idx_stmt;
DEALLOCATE PREPARE veil_config_documents_idx_stmt;

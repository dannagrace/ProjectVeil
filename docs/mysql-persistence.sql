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

CREATE TABLE IF NOT EXISTS `player_accounts` (
  player_id VARCHAR(191) NOT NULL,
  display_name VARCHAR(80) NULL,
  global_resources_json LONGTEXT NOT NULL,
  achievements_json LONGTEXT NULL,
  recent_event_log_json LONGTEXT NULL,
  recent_battle_replays_json LONGTEXT NULL,
  last_room_id VARCHAR(191) NULL,
  last_seen_at DATETIME NULL DEFAULT NULL,
  login_id VARCHAR(40) NULL,
  account_session_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  refresh_session_id VARCHAR(64) NULL,
  refresh_token_hash VARCHAR(255) NULL,
  refresh_token_expires_at DATETIME NULL DEFAULT NULL,
  password_hash VARCHAR(255) NULL,
  credential_bound_at DATETIME NULL DEFAULT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @veil_player_accounts_updated_at_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'player_accounts'
    AND INDEX_NAME = 'idx_player_accounts_updated_at'
);

SET @veil_player_accounts_updated_at_idx_sql := IF(
  @veil_player_accounts_updated_at_idx_exists = 0,
  'CREATE INDEX `idx_player_accounts_updated_at` ON `player_accounts` (updated_at)',
  'SELECT 1'
);

PREPARE veil_player_accounts_updated_at_idx_stmt FROM @veil_player_accounts_updated_at_idx_sql;
EXECUTE veil_player_accounts_updated_at_idx_stmt;
DEALLOCATE PREPARE veil_player_accounts_updated_at_idx_stmt;

SET @veil_player_accounts_login_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'player_accounts'
    AND INDEX_NAME = 'uidx_player_accounts_login_id'
);

SET @veil_player_accounts_login_idx_sql := IF(
  @veil_player_accounts_login_idx_exists = 0,
  'CREATE UNIQUE INDEX `uidx_player_accounts_login_id` ON `player_accounts` (login_id)',
  'SELECT 1'
);

PREPARE veil_player_accounts_login_idx_stmt FROM @veil_player_accounts_login_idx_sql;
EXECUTE veil_player_accounts_login_idx_stmt;
DEALLOCATE PREPARE veil_player_accounts_login_idx_stmt;

CREATE TABLE IF NOT EXISTS `player_event_history` (
  player_id VARCHAR(191) NOT NULL,
  event_id VARCHAR(191) NOT NULL,
  timestamp DATETIME NOT NULL,
  room_id VARCHAR(191) NOT NULL,
  category VARCHAR(32) NOT NULL,
  hero_id VARCHAR(191) NULL,
  world_event_type VARCHAR(64) NULL,
  achievement_id VARCHAR(64) NULL,
  entry_json LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (player_id, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @veil_player_event_history_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'player_event_history'
    AND INDEX_NAME = 'idx_player_event_history_player_time'
);

SET @veil_player_event_history_idx_sql := IF(
  @veil_player_event_history_idx_exists = 0,
  'CREATE INDEX `idx_player_event_history_player_time` ON `player_event_history` (player_id, timestamp)',
  'SELECT 1'
);

PREPARE veil_player_event_history_idx_stmt FROM @veil_player_event_history_idx_sql;
EXECUTE veil_player_event_history_idx_stmt;
DEALLOCATE PREPARE veil_player_event_history_idx_stmt;

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

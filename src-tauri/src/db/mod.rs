mod migrations;
mod schema;

use migrations::{read_current_migration_version, run_migrations};
use rusqlite::Connection;
use schema::SCHEMA_VERSION;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State};

const DATABASE_FILE_NAME: &str = "kiji.db";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStatus {
    path: String,
    schema_version: i64,
    current_migration_version: i64,
    journal_mode: String,
    foreign_keys_enabled: bool,
}

pub struct DbState {
    path: PathBuf,
    connection: Mutex<Connection>,
}

impl DbState {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let path = resolve_database_path(app)?;
        let mut connection = open_connection(&path)?;
        run_migrations(&mut connection)?;

        Ok(Self {
            path,
            connection: Mutex::new(connection),
        })
    }

    fn status(&self) -> Result<DatabaseStatus, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Failed to lock the database connection.".to_string())?;

        Ok(DatabaseStatus {
            path: self.path.to_string_lossy().to_string(),
            schema_version: SCHEMA_VERSION,
            current_migration_version: read_current_migration_version(&connection)?,
            journal_mode: read_journal_mode(&connection)?,
            foreign_keys_enabled: read_foreign_keys_enabled(&connection)?,
        })
    }
}

#[tauri::command]
pub fn db_get_status(state: State<'_, DbState>) -> Result<DatabaseStatus, String> {
    state.status()
}

fn resolve_database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve the app data directory: {error}"))?;

    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Failed to create the app data directory: {error}"))?;

    Ok(data_dir.join(DATABASE_FILE_NAME))
}

fn open_connection(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path)
        .map_err(|error| format!("Failed to open the KiJi database: {error}"))?;

    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| format!("Failed to enable WAL mode: {error}"))?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("Failed to enable foreign keys: {error}"))?;

    Ok(connection)
}

fn read_journal_mode(connection: &Connection) -> Result<String, String> {
    connection
        .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Failed to read database journal mode: {error}"))
}

fn read_foreign_keys_enabled(connection: &Connection) -> Result<bool, String> {
    connection
        .query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
        .map(|enabled| enabled == 1)
        .map_err(|error| format!("Failed to read foreign key state: {error}"))
}

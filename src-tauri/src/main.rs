// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // AI clients start `kiji-app --mcp`; bridge stdio to the running app
    // instead of opening a window.
    if std::env::args().skip(1).any(|arg| arg == "--mcp") {
        std::process::exit(kiji_app_lib::run_mcp_bridge());
    }
    if kiji_app_lib::relaunch_under_new_name() {
        return;
    }
    kiji_app_lib::run()
}

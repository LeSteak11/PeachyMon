fn main() {
    // The main window loads the LIVE site (a remote origin). In Tauri v2 every
    // IPC command invoked from a remote origin must be granted by a capability,
    // and app commands can only be referenced in a capability if their
    // permissions are generated here. Without this, the frontend gets
    // "Command list_windows not allowed by ACL" in the packaged app.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "list_windows",
                "capture_and_ocr",
                "flash_toast",
                "save_text",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}

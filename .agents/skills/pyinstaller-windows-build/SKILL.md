---
name: pyinstaller-windows-build
description: "Techniques and configurations for packaging Python Qt desktop applications into standalone Windows executables (.exe) and installer bundles. Use when configuring PyInstaller spec files, bundling assets/schemas/icons, resolving missing DLLs or Qt plugins, reducing binary size, or creating Inno Setup installers."
---

# PyInstaller Windows Packaging & Distribution Guide

This skill provides step-by-step practices for compiling Python Qt applications into clean, double-clickable Windows executables for hospital clinic workstations.

## 1. Directory Mode vs One-File Mode
* **Recommended for Desktop Apps:** `--onedir` (One-Directory Mode).
  * Fast startup (<1 second) because files are already uncompressed on disk.
  * In contrast, `--onefile` unzips all binaries to `%TEMP%` on every single launch, causing slow 5-10 second cold starts and antivirus false-positives.
* Package the `--onedir` output into a professional setup wizard using **Inno Setup** or **NSIS**.

## 2. PyInstaller CLI Command Reference

```powershell
".venv\Scripts\pyinstaller.exe" `
    --noconfirm `
    --onedir `
    --windowed `
    --name "KalyanHospital" `
    --icon "app/ui/assets/icon.ico" `
    --add-data "app/db/schema.sql;app/db" `
    --add-data "app/ui/styles.py;app/ui" `
    main.py
```

* Flags explained:
  * `--noconfirm`: Overwrite existing build directory without prompting.
  * `--onedir`: Produce a folder bundle containing the executable and required DLLs.
  * `--windowed`: Suppress Windows terminal console window on app launch.
  * `--add-data "source;destination"`: Bundle non-code assets (SQL schemas, icons, fonts).

## 3. Resolving Common Qt Runtime Issues
* **Missing Qt Plugins (Platforms / Styles):** Ensure PyInstaller includes PySide6 plugin directories. If `qwindows.dll` is missing, verify PySide6 version compatibility or add `--collect-submodules PySide6`.
* **Path Resolution at Runtime (`_MEIPASS`):**
  * Assets must resolve correctly both in development and when running inside the frozen bundle:

```python
import os
import sys

def get_bundle_dir() -> str:
    """Returns application directory whether running from source or frozen executable."""
    if getattr(sys, 'frozen', False):
        return sys._MEIPASS if hasattr(sys, '_MEIPASS') else os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))
```

## 4. Inno Setup Integration
* Use Inno Setup to create a single `Setup_KalyanHospital_v1.0.exe` installer for the hospital admin:
  * Automatically creates Desktop shortcut and Start Menu group.
  * Grants write permissions to the `data/` and `backups/` directories.
  * Includes an uninstaller.

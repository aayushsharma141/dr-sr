---
name: pyside6-qt-desktop
description: "Expert engineering guidelines and patterns for building robust, modern, high-performance desktop applications with Python and PySide6 (Qt 6). Use when designing Qt interfaces, implementing signals/slots, background QThread workers, custom QSS styling, high-DPI scaling, keyboard shortcuts, or debugging Qt crashes."
---

# PySide6 (Qt 6) Desktop Engineering Guide

This skill provides production-grade architectural patterns, performance guidelines, and safety practices for building native desktop applications using **PySide6 (Qt 6)**.

## Core Architectural Principles

### 1. Presentation-Service Decoupling
* **Never write SQL or business logic inside UI classes.** Widgets should only collect user input, call application services, and render returned view models.
* Use **Signals and Slots** for communication between decoupled UI components rather than direct parent-child references.
* Keep view state separate from database state.

### 2. Zero-Freeze UI (Thread Offloading)
* Any operation taking longer than **16ms** (database queries, network requests, PDF generation, hardware printer I/O) MUST NOT execute on the Qt main GUI thread.
* Use `QThread` or `QRunnable` with `QThreadPool.globalInstance()`:

```python
from PySide6.QtCore import QObject, QRunnable, QThreadPool, Signal, Slot

class WorkerSignals(QObject):
    finished = Signal(object)
    error = Signal(str)

class TaskWorker(QRunnable):
    def __init__(self, func, *args, **kwargs):
        super().__init__()
        self.func = func
        self.args = args
        self.kwargs = kwargs
        self.signals = WorkerSignals()

    @Slot()
    def run(self):
        try:
            result = self.func(*self.args, **self.kwargs)
            self.signals.finished.emit(result)
        except Exception as e:
            self.signals.error.emit(str(e))

# In View / Controller:
worker = TaskWorker(expensive_computation, arg1)
worker.signals.finished.connect(self._on_task_completed)
QThreadPool.globalInstance().start(worker)
```

### 3. Professional QSS & Theme Design System
* Store stylesheets in modular variables or `.qss` files.
* Never hardcode arbitrary hex colors across widgets. Define centralized tokens:
  * `COLOR_PRIMARY`, `COLOR_SECONDARY`, `COLOR_BG`, `COLOR_CARD_BG`, `COLOR_TEXT_PRIMARY`, `COLOR_BORDER`.
* Set minimum touch/click targets (at least 36px height for desktop buttons, 44px for touchscreens).
* Ensure high-contrast focus rings (`outline` or distinctive `border-color` on `:focus`) for accessibility.

### 4. High-DPI Scaling & Typography
* Always configure high-DPI scaling before instantiating `QApplication`:
```python
import sys
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication

app = QApplication.instance() or QApplication(sys.argv)
# High-DPI is enabled by default in Qt 6, but configure font hinting:
font = app.font()
font.setFamily("Segoe UI")
font.setPointSize(10)
app.setFont(font)
```

### 5. Keyboard Navigation & Rapid Input Ergonomics
In clinical/reception desk environments, operators must work without mouse dependency:
* Set explicit `QWidget.setTabOrder(widget_a, widget_b)` across form inputs.
* Bind shortcut keys for primary actions:
  * `QShortcut(QKeySequence("Ctrl+S"), self, self.save_record)`
  * `QShortcut(QKeySequence("Ctrl+P"), self, self.print_record)`
  * `QShortcut(QKeySequence("F2"), self, self.open_new_registration)`
* Use `QLineEdit.returnPressed` to submit or focus the next field.

### 6. Safe Modal Dialogs & Life Cycle
* Always set `parent` when creating `QDialog` or `QMessageBox` to prevent orphaned windows behind the main application.
* Prefer `.exec()` inside clean helper methods, and inspect return codes (`QDialog.Accepted`).
* Clear sensitive forms on dialog close.

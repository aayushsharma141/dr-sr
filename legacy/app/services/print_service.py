"""
Print Service - one place for A4 documents and 80mm thermal receipts.

Every output path (physical printer, preview window, PDF export) renders the same
QTextDocument through the same printer configuration, so what staff see in the preview
is what comes out on paper.
"""

import os
import re
from typing import Callable, Optional

from PySide6.QtCore import QMarginsF, QSizeF, Qt
from PySide6.QtGui import QPageLayout, QPageSize, QTextDocument
from PySide6.QtPrintSupport import QPrintDialog, QPrintPreviewDialog, QPrintPreviewWidget, QPrinter
from PySide6.QtWidgets import QFileDialog, QHBoxLayout, QLabel, QPushButton, QWidget

A4_MARGIN_MM = 6.0
THERMAL_WIDTH_MM = 80.0
THERMAL_MARGIN_MM = 3.0
THERMAL_MIN_HEIGHT_MM = 80.0
THERMAL_MAX_HEIGHT_MM = 600.0
DEFAULT_THERMAL_HEIGHT_MM = 240.0


def safe_filename(name: str, fallback: str = "Document") -> str:
    """Make a Windows-safe file name (no dashes, quotes or path characters)."""
    cleaned = re.sub(r"[^\w\-. ]+", "", name, flags=re.UNICODE)
    cleaned = re.sub(r"\s+", "_", cleaned.strip())
    return cleaned or fallback


class PrintService:
    """Document rendering, print preview, direct printing, and vector PDF export."""

    # ---- printer setup ----------------------------------------------------
    @staticmethod
    def _new_printer(pdf_path: Optional[str], metrics_only: bool = False) -> QPrinter:
        # ScreenResolution keeps HTML pixel sizes and typography identical on every output.
        printer = QPrinter(QPrinter.PrinterMode.ScreenResolution)
        if pdf_path or metrics_only:
            # A PDF-format printer always accepts the exact page size, so measurements are reliable
            # even when the default system printer would reject a custom 80 mm page.
            printer.setOutputFormat(QPrinter.OutputFormat.PdfFormat)
        if pdf_path:
            printer.setOutputFileName(os.path.abspath(pdf_path))
        return printer

    @classmethod
    def create_a4_printer(cls, pdf_path: Optional[str] = None, metrics_only: bool = False) -> QPrinter:
        """ISO A4 portrait with 6 mm margins."""
        printer = cls._new_printer(pdf_path, metrics_only)
        printer.setPageLayout(QPageLayout(
            QPageSize(QPageSize.PageSizeId.A4),
            QPageLayout.Orientation.Portrait,
            QMarginsF(A4_MARGIN_MM, A4_MARGIN_MM, A4_MARGIN_MM, A4_MARGIN_MM),
            QPageLayout.Unit.Millimeter,
        ))
        return printer

    @classmethod
    def create_thermal_printer(
        cls,
        pdf_path: Optional[str] = None,
        page_height_mm: float = DEFAULT_THERMAL_HEIGHT_MM,
        metrics_only: bool = False,
    ) -> QPrinter:
        """80 mm wide custom page for a 3-inch thermal receipt printer."""
        printer = cls._new_printer(pdf_path, metrics_only)
        height = max(THERMAL_MIN_HEIGHT_MM, min(float(page_height_mm), THERMAL_MAX_HEIGHT_MM))
        receipt_page = QPageSize(
            QSizeF(THERMAL_WIDTH_MM, height),
            QPageSize.Unit.Millimeter,
            "Kalyan Hospital 80mm Thermal Receipt",
        )
        printer.setPageLayout(QPageLayout(
            receipt_page,
            QPageLayout.Orientation.Portrait,
            QMarginsF(THERMAL_MARGIN_MM, THERMAL_MARGIN_MM, THERMAL_MARGIN_MM, THERMAL_MARGIN_MM),
            QPageLayout.Unit.Millimeter,
        ))
        return printer

    @classmethod
    def thermal_height_for(cls, html_content: str) -> float:
        """Page height (mm) that fits the receipt exactly, so nothing is cut or wasted."""
        probe = cls.create_thermal_printer(metrics_only=True)
        doc = cls._build_document(html_content, probe)
        # Measure on one tall page so the document height is the real content height.
        doc.setPageSize(QSizeF(doc.pageSize().width(), 100000))
        content_mm = doc.size().height() / probe.resolution() * 25.4
        height = content_mm + 2 * THERMAL_MARGIN_MM + 6.0  # small tail before the cutter
        return max(THERMAL_MIN_HEIGHT_MM, min(height, THERMAL_MAX_HEIGHT_MM))

    # ---- rendering --------------------------------------------------------
    @staticmethod
    def _build_document(html_content: str, printer: QPrinter) -> QTextDocument:
        doc = QTextDocument()
        paint_rect = printer.pageLayout().paintRectPixels(printer.resolution())
        doc.setPageSize(QSizeF(paint_rect.width(), paint_rect.height()))
        doc.setHtml(html_content)
        return doc

    @classmethod
    def _render(cls, html_content: str, printer: QPrinter) -> None:
        cls._build_document(html_content, printer).print_(printer)

    @classmethod
    def page_count(cls, html_content: str, thermal: bool = False) -> int:
        """Pages this document needs; A4 records should always be 1."""
        if thermal:
            printer = cls.create_thermal_printer(
                page_height_mm=cls.thermal_height_for(html_content), metrics_only=True
            )
        else:
            printer = cls.create_a4_printer(metrics_only=True)
        return cls._build_document(html_content, printer).pageCount()

    # ---- preview window ---------------------------------------------------
    @classmethod
    def _show_preview(
        cls,
        html_content: str,
        parent,
        title: str,
        printer: QPrinter,
        size: tuple[int, int],
        print_label: str,
        print_fn: Callable[[QWidget], bool],
        pdf_fn: Callable[[QWidget], Optional[str]],
        fit_width: bool,
        paper_label: str,
    ) -> None:
        dialog = QPrintPreviewDialog(printer, parent)
        dialog.setWindowTitle(f"{title} — Kalyan Hospital")
        dialog.resize(*size)
        dialog.paintRequested.connect(lambda target: cls._render(html_content, target))

        preview = dialog.findChild(QPrintPreviewWidget)
        if preview is not None:
            (preview.fitToWidth if fit_width else preview.fitInView)()

        bar = QWidget(dialog)
        bar.setObjectName("PreviewActionBar")
        bar.setStyleSheet("QWidget#PreviewActionBar { background:#FFFFFF; border-top:1px solid #DDE5DF; }")
        row = QHBoxLayout(bar)
        row.setContentsMargins(16, 10, 16, 10)
        row.setSpacing(10)

        status = QLabel(f"{paper_label}  ·  review before printing")
        status.setStyleSheet("color:#64736D;font-size:12px;")
        row.addWidget(status)
        row.addStretch()

        close_btn = QPushButton("Close")
        close_btn.setObjectName("SecondaryButton")
        close_btn.clicked.connect(dialog.reject)
        row.addWidget(close_btn)

        pdf_btn = QPushButton("Save as PDF")
        pdf_btn.setObjectName("SecondaryButton")

        def _on_pdf():
            saved = pdf_fn(dialog)
            if saved:
                status.setText(f"Saved  ·  {os.path.basename(saved)}")

        pdf_btn.clicked.connect(_on_pdf)
        row.addWidget(pdf_btn)

        print_btn = QPushButton(print_label)
        print_btn.setObjectName("PrimaryButton")
        print_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        print_btn.setDefault(True)
        print_btn.clicked.connect(lambda: dialog.accept() if print_fn(dialog) else None)
        row.addWidget(print_btn)

        dialog.layout().addWidget(bar)
        dialog.exec()

    @classmethod
    def show_print_preview(cls, html_content: str, parent=None, title: str = "Print Preview") -> None:
        """A4 preview with Print, Save as PDF and Close."""
        cls._show_preview(
            html_content, parent, title,
            printer=cls.create_a4_printer(metrics_only=True),
            size=(1000, 900),
            print_label="Print",
            print_fn=lambda owner: cls.print_document(html_content, parent=owner, title=title),
            pdf_fn=lambda owner: cls.export_to_pdf_with_dialog(
                html_content, parent=owner, default_name=f"{safe_filename(title)}.pdf"
            ),
            fit_width=False,
            paper_label="A4",
        )

    @classmethod
    def show_thermal_receipt_preview(
        cls, html_content: str, parent=None, title: str = "80mm Thermal Receipt"
    ) -> None:
        """80 mm receipt preview sized to the receipt's real length."""
        height = cls.thermal_height_for(html_content)
        cls._show_preview(
            html_content, parent, title,
            printer=cls.create_thermal_printer(page_height_mm=height, metrics_only=True),
            size=(560, 820),
            print_label="Print Receipt",
            print_fn=lambda owner: cls.print_thermal_receipt(html_content, parent=owner, title=title),
            pdf_fn=lambda owner: cls.export_thermal_receipt_with_dialog(
                html_content, parent=owner, default_name=f"{safe_filename(title, 'Receipt')}.pdf"
            ),
            fit_width=True,
            paper_label="80 mm receipt",
        )

    # ---- physical printing ------------------------------------------------
    @classmethod
    def _print_with_dialog(cls, html_content: str, printer: QPrinter, parent, title: str) -> bool:
        dialog = QPrintDialog(printer, parent)
        dialog.setWindowTitle(f"{title} — Kalyan Hospital")
        if dialog.exec() == QPrintDialog.DialogCode.Accepted:
            cls._render(html_content, printer)
            return True
        return False

    @classmethod
    def print_document(cls, html_content: str, parent=None, title: str = "Print Document") -> bool:
        """Choose a printer, then print the A4 document. False if cancelled."""
        return cls._print_with_dialog(html_content, cls.create_a4_printer(), parent, title)

    @classmethod
    def print_thermal_receipt(
        cls, html_content: str, parent=None, title: str = "Print 80mm Thermal Receipt"
    ) -> bool:
        """Choose a printer, then print an 80mm receipt cut to its real length."""
        printer = cls.create_thermal_printer(page_height_mm=cls.thermal_height_for(html_content))
        return cls._print_with_dialog(html_content, printer, parent, title)

    # ---- PDF export -------------------------------------------------------
    @classmethod
    def export_to_pdf(cls, html_content: str, output_path: str) -> str:
        """Render an A4 document to a vector PDF."""
        target = os.path.abspath(output_path)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        cls._render(html_content, cls.create_a4_printer(pdf_path=target))
        return target

    @classmethod
    def export_thermal_receipt_to_pdf(cls, html_content: str, output_path: str) -> str:
        """Render an 80mm receipt to a PDF with the same custom page used for printing."""
        target = os.path.abspath(output_path)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        printer = cls.create_thermal_printer(
            pdf_path=target, page_height_mm=cls.thermal_height_for(html_content)
        )
        cls._render(html_content, printer)
        return target

    @staticmethod
    def _ask_pdf_path(parent, caption: str, default_name: str) -> Optional[str]:
        initial = os.path.join(os.path.expanduser("~"), "Documents", default_name)
        file_path, _ = QFileDialog.getSaveFileName(
            parent, caption, initial, "PDF Files (*.pdf);;All Files (*.*)"
        )
        if not file_path:
            return None
        return file_path if file_path.lower().endswith(".pdf") else file_path + ".pdf"

    @classmethod
    def export_to_pdf_with_dialog(
        cls,
        html_content: str,
        parent=None,
        default_name: str = "Kalyan_Hospital_Document.pdf",
    ) -> Optional[str]:
        """Ask where to save, then export the A4 PDF."""
        path = cls._ask_pdf_path(parent, "Save Document as PDF", default_name)
        return cls.export_to_pdf(html_content, path) if path else None

    @classmethod
    def export_thermal_receipt_with_dialog(
        cls,
        html_content: str,
        parent=None,
        default_name: str = "Thermal_Receipt.pdf",
    ) -> Optional[str]:
        """Ask where to save, then export the 80mm receipt PDF."""
        path = cls._ask_pdf_path(parent, "Save Receipt as PDF", default_name)
        return cls.export_thermal_receipt_to_pdf(html_content, path) if path else None

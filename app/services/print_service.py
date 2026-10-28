"""
Print Service - Renders HTML to ISO A4 QPrinter, QPrintPreviewDialog, and Vector PDF.
Kalyan Hospital Management System.
"""

import os
from typing import Optional
from PySide6.QtGui import QTextDocument, QPageSize, QPageLayout
from PySide6.QtCore import QMarginsF, QSizeF
from PySide6.QtWidgets import QWidget, QHBoxLayout, QLabel, QFileDialog
from PySide6.QtPrintSupport import QPrinter, QPrintPreviewDialog, QPrintDialog
from qfluentwidgets import PrimaryPushButton, PushButton, FluentIcon


class PrintService:
    """Manages document rendering, print preview dialogs, direct printing, and vector PDF exports."""

    @staticmethod
    def create_a4_printer(pdf_path: Optional[str] = None) -> QPrinter:
        """
        Configures a QPrinter for standard ISO A4 portrait printing.
        Uses ScreenResolution so that HTML/CSS pixel dimensions and typography
        scale proportionally across all print previews, physical printers, and PDFs.
        """
        if pdf_path:
            printer = QPrinter(QPrinter.PrinterMode.ScreenResolution)
            printer.setOutputFormat(QPrinter.OutputFormat.PdfFormat)
            printer.setOutputFileName(os.path.abspath(pdf_path))
        else:
            printer = QPrinter(QPrinter.PrinterMode.ScreenResolution)

        # Standard ISO A4 Portrait layout with 8mm margins
        page_layout = QPageLayout(
            QPageSize(QPageSize.PageSizeId.A4),
            QPageLayout.Orientation.Portrait,
            QMarginsF(8.0, 8.0, 8.0, 8.0),
            QPageLayout.Unit.Millimeter,
        )
        printer.setPageLayout(page_layout)
        return printer

    @staticmethod
    def create_thermal_printer(
        pdf_path: Optional[str] = None,
        page_height_mm: float = 240.0,
    ) -> QPrinter:
        """Configure an 80mm-wide custom page for a 3-inch thermal receipt printer."""
        if pdf_path:
            printer = QPrinter(QPrinter.PrinterMode.ScreenResolution)
            printer.setOutputFormat(QPrinter.OutputFormat.PdfFormat)
            printer.setOutputFileName(os.path.abspath(pdf_path))
        else:
            printer = QPrinter(QPrinter.PrinterMode.ScreenResolution)

        height = max(120.0, min(float(page_height_mm), 400.0))
        receipt_page = QPageSize(
            QSizeF(80.0, height),
            QPageSize.Unit.Millimeter,
            "Kalyan Hospital 80mm Thermal Receipt",
        )
        layout = QPageLayout(
            receipt_page,
            QPageLayout.Orientation.Portrait,
            QMarginsF(3.0, 3.0, 3.0, 3.0),
            QPageLayout.Unit.Millimeter,
        )
        printer.setPageLayout(layout)
        return printer

    @classmethod
    def show_print_preview(cls, html_content: str, parent=None, title: str = "Print Preview") -> None:
        """
        Displays a native interactive QPrintPreviewDialog with a modern action footer,
        allowing direct printing to a physical printer, saving as PDF, or closing.
        """
        printer = cls.create_a4_printer()
        dialog = QPrintPreviewDialog(printer, parent)
        dialog.setWindowTitle(f"{title} — Kalyan Hospital")
        dialog.resize(950, 850)

        def _handle_paint(target_printer: QPrinter):
            doc = QTextDocument()
            paint_rect = target_printer.pageLayout().paintRectPixels(target_printer.resolution())
            doc.setPageSize(QSizeF(paint_rect.width(), paint_rect.height()))
            doc.setHtml(html_content)
            doc.print_(target_printer)

        dialog.paintRequested.connect(_handle_paint)

        # Modern action bar docked at the bottom of the preview dialog
        bottom_widget = QWidget(dialog)
        bottom_widget.setStyleSheet(
            "background-color: #F8FAFC; border-top: 1px solid #E2E8F0; padding: 6px;"
        )
        bottom_layout = QHBoxLayout(bottom_widget)
        bottom_layout.setContentsMargins(16, 8, 16, 8)
        bottom_layout.setSpacing(12)

        status_lbl = QLabel(f"📄 {title} — Review before printing or exporting")
        status_lbl.setStyleSheet("font-size: 12px; font-weight: 600; color: #475569;")
        bottom_layout.addWidget(status_lbl)
        bottom_layout.addStretch()

        print_now_btn = PrimaryPushButton(FluentIcon.PRINT, "Print Now (Select Printer)", bottom_widget)
        def _on_print_now():
            if cls.print_document(html_content, parent=dialog, title=title):
                dialog.accept()
        print_now_btn.clicked.connect(_on_print_now)
        bottom_layout.addWidget(print_now_btn)

        save_pdf_btn = PushButton(FluentIcon.SAVE, "Save as PDF...", bottom_widget)
        def _on_save_pdf():
            default_pdf = f"{title.replace(' ', '_')}.pdf"
            saved_path = cls.export_to_pdf_with_dialog(html_content, parent=dialog, default_name=default_pdf)
            if saved_path:
                status_lbl.setText(f"✓ Saved: {os.path.basename(saved_path)}")
        save_pdf_btn.clicked.connect(_on_save_pdf)
        bottom_layout.addWidget(save_pdf_btn)

        close_btn = PushButton(FluentIcon.CLOSE, "Close Preview", bottom_widget)
        close_btn.clicked.connect(dialog.reject)
        bottom_layout.addWidget(close_btn)

        dialog.layout().addWidget(bottom_widget)
        dialog.exec()

    @classmethod
    def show_thermal_receipt_preview(cls, html_content: str, parent=None, title: str = "80mm Thermal Receipt Preview") -> None:
        """Preview an 80mm receipt with direct print and export options."""
        printer = cls.create_thermal_printer()
        dialog = QPrintPreviewDialog(printer, parent)
        dialog.setWindowTitle(f"{title} — Kalyan Hospital")
        dialog.resize(650, 820)

        def _handle_paint(target_printer: QPrinter):
            doc = QTextDocument()
            paint_rect = target_printer.pageLayout().paintRectPixels(target_printer.resolution())
            doc.setPageSize(QSizeF(paint_rect.width(), paint_rect.height()))
            doc.setHtml(html_content)
            doc.print_(target_printer)

        dialog.paintRequested.connect(_handle_paint)

        # Action footer
        bottom_widget = QWidget(dialog)
        bottom_widget.setStyleSheet(
            "background-color: #F8FAFC; border-top: 1px solid #E2E8F0; padding: 6px;"
        )
        bottom_layout = QHBoxLayout(bottom_widget)
        bottom_layout.setContentsMargins(16, 8, 16, 8)
        bottom_layout.setSpacing(12)

        status_lbl = QLabel(f"🧾 80mm Receipt — Ready to print")
        status_lbl.setStyleSheet("font-size: 12px; font-weight: 600; color: #475569;")
        bottom_layout.addWidget(status_lbl)
        bottom_layout.addStretch()

        print_now_btn = PrimaryPushButton(FluentIcon.PRINT, "Print Receipt (80mm)", bottom_widget)
        def _on_print_now():
            if cls.print_thermal_receipt(html_content, parent=dialog, title=title):
                dialog.accept()
        print_now_btn.clicked.connect(_on_print_now)
        bottom_layout.addWidget(print_now_btn)

        save_pdf_btn = PushButton(FluentIcon.SAVE, "Save as PDF...", bottom_widget)
        def _on_save_pdf():
            saved_path = cls.export_thermal_receipt_with_dialog(html_content, parent=dialog, default_name="Thermal_Receipt.pdf")
            if saved_path:
                status_lbl.setText(f"✓ Saved: {os.path.basename(saved_path)}")
        save_pdf_btn.clicked.connect(_on_save_pdf)
        bottom_layout.addWidget(save_pdf_btn)

        close_btn = PushButton(FluentIcon.CLOSE, "Close Preview", bottom_widget)
        close_btn.clicked.connect(dialog.reject)
        bottom_layout.addWidget(close_btn)

        dialog.layout().addWidget(bottom_widget)
        dialog.exec()

    @classmethod
    def print_document(cls, html_content: str, parent=None, title: str = "Print Document") -> bool:
        """
        Opens a system QPrintDialog allowing physical paper printing to any connected printer.
        Returns True if the document was sent to the printer, False if cancelled.
        """
        printer = cls.create_a4_printer()
        dialog = QPrintDialog(printer, parent)
        dialog.setWindowTitle(f"{title} — Kalyan Hospital")

        if dialog.exec() == QPrintDialog.DialogCode.Accepted:
            doc = QTextDocument()
            paint_rect = printer.pageLayout().paintRectPixels(printer.resolution())
            doc.setPageSize(QSizeF(paint_rect.width(), paint_rect.height()))
            doc.setHtml(html_content)
            doc.print_(printer)
            return True
        return False

    @classmethod
    def print_thermal_receipt(cls, html_content: str, parent=None, title: str = "Print 80mm Thermal Receipt") -> bool:
        """Open the native print dialog preconfigured for an 80mm receipt."""
        printer = cls.create_thermal_printer()
        dialog = QPrintDialog(printer, parent)
        dialog.setWindowTitle(f"{title} — Kalyan Hospital")
        if dialog.exec() == QPrintDialog.DialogCode.Accepted:
            doc = QTextDocument()
            paint_rect = printer.pageLayout().paintRectPixels(printer.resolution())
            doc.setPageSize(QSizeF(paint_rect.width(), paint_rect.height()))
            doc.setHtml(html_content)
            doc.print_(printer)
            return True
        return False

    @classmethod
    def export_to_pdf(cls, html_content: str, output_path: str) -> str:
        """
        Renders HTML content directly to a vector PDF file on disk.
        """
        abs_output_path = os.path.abspath(output_path)
        os.makedirs(os.path.dirname(abs_output_path), exist_ok=True)

        printer = cls.create_a4_printer(pdf_path=abs_output_path)
        doc = QTextDocument()
        paint_rect = printer.pageLayout().paintRectPixels(printer.resolution())
        doc.setPageSize(QSizeF(paint_rect.width(), paint_rect.height()))
        doc.setHtml(html_content)
        doc.print_(printer)

        return abs_output_path

    @classmethod
    def export_to_pdf_with_dialog(
        cls,
        html_content: str,
        parent=None,
        default_name: str = "Kalyan_Hospital_Document.pdf",
    ) -> Optional[str]:
        """
        Opens a native Windows Save File Dialog allowing the user to select the exact destination
        folder and file name on disk, then exports the PDF.
        """
        docs_dir = os.path.join(os.path.expanduser("~"), "Documents")
        initial_path = os.path.join(docs_dir, default_name)

        file_path, _ = QFileDialog.getSaveFileName(
            parent,
            "Save Document as PDF",
            initial_path,
            "PDF Files (*.pdf);;All Files (*.*)",
        )
        if not file_path:
            return None

        if not file_path.lower().endswith(".pdf"):
            file_path += ".pdf"

        return cls.export_to_pdf(html_content, file_path)

    @classmethod
    def export_thermal_receipt_to_pdf(cls, html_content: str, output_path: str) -> str:
        """Export the receipt as a PDF with an 80mm custom page size for preview/testing."""
        abs_output_path = os.path.abspath(output_path)
        os.makedirs(os.path.dirname(abs_output_path), exist_ok=True)

        printer = cls.create_thermal_printer(pdf_path=abs_output_path)
        doc = QTextDocument()
        paint_rect = printer.pageLayout().paintRectPixels(printer.resolution())
        doc.setPageSize(QSizeF(paint_rect.width(), paint_rect.height()))
        doc.setHtml(html_content)
        doc.print_(printer)

        return abs_output_path

    @classmethod
    def export_thermal_receipt_with_dialog(
        cls,
        html_content: str,
        parent=None,
        default_name: str = "Thermal_Receipt.pdf",
    ) -> Optional[str]:
        """Opens a save dialog for 80mm thermal receipts and exports the PDF."""
        docs_dir = os.path.join(os.path.expanduser("~"), "Documents")
        initial_path = os.path.join(docs_dir, default_name)

        file_path, _ = QFileDialog.getSaveFileName(
            parent,
            "Save Receipt as PDF",
            initial_path,
            "PDF Files (*.pdf);;All Files (*.*)",
        )
        if not file_path:
            return None

        if not file_path.lower().endswith(".pdf"):
            file_path += ".pdf"

        return cls.export_thermal_receipt_to_pdf(html_content, file_path)

"""
Print Service - Renders HTML to ISO A4 QPrinter, QPrintPreviewDialog, and Vector PDF.
Kalyan Hospital Management System.
"""

import os
from typing import Optional
from PySide6.QtGui import QTextDocument, QPageSize, QPageLayout
from PySide6.QtCore import QMarginsF, QSizeF
from PySide6.QtPrintSupport import QPrinter, QPrintPreviewDialog, QPrintDialog


class PrintService:
    """Manages document rendering, print preview dialogs, and direct PDF exports."""

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
        Displays a native interactive QPrintPreviewDialog for the document,
        ensuring content fills the entire A4 page with crisp proportional scaling.
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
        dialog.exec()

    @classmethod
    def show_thermal_receipt_preview(cls, html_content: str, parent=None) -> None:
        """Preview an 80mm receipt using a custom thermal-paper page size."""
        printer = cls.create_thermal_printer()
        dialog = QPrintPreviewDialog(printer, parent)
        dialog.setWindowTitle("80mm Thermal Receipt Preview — Kalyan Hospital")
        dialog.resize(650, 820)

        def _handle_paint(target_printer: QPrinter):
            doc = QTextDocument()
            paint_rect = target_printer.pageLayout().paintRectPixels(target_printer.resolution())
            doc.setPageSize(QSizeF(paint_rect.width(), paint_rect.height()))
            doc.setHtml(html_content)
            doc.print_(target_printer)

        dialog.paintRequested.connect(_handle_paint)
        dialog.exec()

    @classmethod
    def print_document(cls, html_content: str, parent=None) -> bool:
        """
        Opens a system QPrintDialog allowing physical paper printing.
        """
        printer = cls.create_a4_printer()
        dialog = QPrintDialog(printer, parent)
        dialog.setWindowTitle("Print Document")

        if dialog.exec() == QPrintDialog.DialogCode.Accepted:
            doc = QTextDocument()
            paint_rect = printer.pageLayout().paintRectPixels(printer.resolution())
            doc.setPageSize(QSizeF(paint_rect.width(), paint_rect.height()))
            doc.setHtml(html_content)
            doc.print_(printer)
            return True
        return False

    @classmethod
    def print_thermal_receipt(cls, html_content: str, parent=None) -> bool:
        """Open the native print dialog preconfigured for an 80mm receipt."""
        printer = cls.create_thermal_printer()
        dialog = QPrintDialog(printer, parent)
        dialog.setWindowTitle("Print 80mm Thermal Receipt")
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

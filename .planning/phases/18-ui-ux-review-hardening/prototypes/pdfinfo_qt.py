"""Count PDF pages, report page size (mm) and text using PySide6 QtPdf. Usage: python -I pdfinfo_qt.py a.pdf [b.pdf ...]"""
import sys

from PySide6.QtCore import QSizeF
from PySide6.QtPdf import QPdfDocument

PT_TO_MM = 25.4 / 72


def main(paths: list[str]) -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    for path in paths:
        doc = QPdfDocument()
        err = doc.load(path)
        name = path.replace("\\", "/").split("/")[-1]
        if err != QPdfDocument.Error.None_:
            print(name, "LOAD ERROR", err)
            continue
        out = []
        for i in range(doc.pageCount()):
            size: QSizeF = doc.pagePointSize(i)
            text = doc.getAllText(i).text().replace("\n", " | ")[:70]
            out.append(f"p{i + 1}: {size.width() * PT_TO_MM:.1f}x{size.height() * PT_TO_MM:.1f}mm '{text}'")
        print(name, "=>", doc.pageCount(), "page(s)", "; ".join(out))


if __name__ == "__main__":
    main(sys.argv[1:])

from pathlib import Path
from fastapi import FastAPI
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.frontend("/", directory=str(Path(__file__).parent / "camtest"), fallback="index.html", check_dir=False)
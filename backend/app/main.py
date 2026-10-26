"""
backend/app/main.py
FastAPI application entry point for the Wind Forecast Accuracy Portal API.
"""

import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.staticfiles import StaticFiles

from app.store import data_store
from app.routes import router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Loads parquet snapshots into memory upon server startup."""
    logger.info("Server starting up: initializing in-memory analytics data store...")
    data_store.load()
    yield
    logger.info("Server shutting down.")


app = FastAPI(
    title="Wind Forecast Accuracy Portal API",
    description=(
        "REST API for Great Britain Day-Ahead renewable generation forecast evaluation. "
        "Evaluates decision-time Elexon BMRS WINDFOR forecasts against FUELHH actuals "
        "without look-ahead bias."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Custom validation handler to ensure consistent error format and 400 status code
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc: RequestValidationError):
    errors = exc.errors()
    msg = errors[0].get("msg", "Validation error") if errors else "Validation error"
    loc = errors[0].get("loc", []) if errors else []
    field_name = loc[-1] if loc else "parameter"
    return JSONResponse(
        status_code=400,
        content={"detail": f"Validation error on {field_name}: {msg}"}
    )

# Enable CORS for frontend clients (Vite dev server, Docker container, and production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(router)

# Mount static frontend if built dist exists (Docker / Production single-container deployment)
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
frontend_dist = os.path.join(project_root, "frontend", "dist")
bundled_static = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

if os.path.isdir(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="static")
elif os.path.isdir(bundled_static):
    app.mount("/", StaticFiles(directory=bundled_static, html=True), name="static")
else:
    @app.get("/", include_in_schema=False)
    def root():
        """Redirects root path to interactive Swagger API documentation when frontend is not built."""
        return RedirectResponse(url="/docs")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)

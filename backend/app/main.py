"""
backend/app/main.py
FastAPI application entry point for the Wind Forecast Accuracy Portal API.
"""

from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse

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


@app.get("/", include_in_schema=False)
def root():
    """Redirects root path to interactive Swagger API documentation."""
    return RedirectResponse(url="/docs")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)

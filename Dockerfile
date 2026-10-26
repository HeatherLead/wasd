# ==============================================================================
# Multi-Stage Dockerfile: Wind Forecast Accuracy Portal
# Stage 1: Build React + TypeScript frontend assets with Node
# Stage 2: Python 3.12 slim runtime serving FastAPI + built static frontend
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Frontend Build
# ------------------------------------------------------------------------------
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend dependency manifests
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Copy frontend source code and configs
COPY frontend/index.html frontend/vite.config.ts frontend/tsconfig*.json frontend/eslint.config.js ./
COPY frontend/public ./public
COPY frontend/src ./src

# Build production bundle to /app/frontend/dist
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Production Python Runtime
# ------------------------------------------------------------------------------
FROM python:3.12-slim AS runner

WORKDIR /app

# Set environment flags
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

# Install system dependencies if required
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python backend dependencies
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r ./backend/requirements.txt

# Copy backend application code
COPY backend/app ./backend/app

# Copy reproducible data snapshots
COPY data/processed ./data/processed

# Copy built frontend assets from builder stage
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Set working directory to backend
WORKDIR /app/backend

# Expose port (Heroku sets $PORT dynamically, defaults to 8000)
EXPOSE 8000

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8000}/api/health || exit 1

# Start Uvicorn ASGI server with dynamic port support
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

"""
FastAPI application entrypoint for the digital signage backend.

Run locally:
    uvicorn app.main:app --reload --port 8080

Deployed on Cloud Run (see infra/) with min-instances=0, max-instances=10,
concurrency=80 -- the in-process playlist cache and heartbeat buffer are
per-container singletons, which is the intended design at this scale
(~100 devices). min-instances=0 (scale to zero) keeps this within Cloud
Run's free tier for this traffic volume; see heartbeat_buffer.py for how
heartbeat flushing stays correct without an always-on background task.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.bigquery_client import get_bigquery_client
from app.cache import playlist_cache
from app.config import get_settings
from app.firestore_repo import get_repo
from app.heartbeat_buffer import HeartbeatBuffer
from app.routers import admin, device, jobs

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("signage.main")
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    repo = get_repo()
    bq = get_bigquery_client()
    buffer = HeartbeatBuffer(
        repo=repo,
        bq=bq,
        cache=playlist_cache,
        flush_interval=settings.heartbeat_flush_interval_seconds,
    )
    app.state.heartbeat_buffer = buffer
    logger.info("Signage backend started. project=%s dataset=%s", settings.gcp_project, settings.bq_dataset)
    try:
        yield
    finally:
        await buffer.stop()


app = FastAPI(
    title="Digital Signage Backend",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["ETag"],
)

app.include_router(device.router)
app.include_router(admin.router)
app.include_router(jobs.router)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


# Optionally serve the built React admin panel from this same Cloud Run
# service. Build the frontend (`npm run build` in ../frontend) and copy
# frontend/dist -> backend/static before building the Docker image (see
# backend/Dockerfile) to enable this. If ./static doesn't exist (e.g. local
# dev), we skip mounting so the API still starts cleanly.
_static_dir = Path(__file__).resolve().parent.parent / "static"
if _static_dir.exists() and any(_static_dir.iterdir()):
    app.mount("/", StaticFiles(directory=str(_static_dir), html=True), name="static")
else:
    logger.info("No frontend build found at %s; skipping static mount.", _static_dir)

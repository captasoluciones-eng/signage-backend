# Digital Signage backend - Cloud Run image
# Serves the FastAPI API and (optionally) the built React admin panel as static files.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Optional: copy the pre-built frontend (run `npm run build` in ../frontend first and
# copy frontend/dist into backend/static before building this image) so FastAPI's
# StaticFiles can serve the admin panel from the same Cloud Run service.
# COPY static ./static
RUN mkdir -p /app/static

EXPOSE 8080

# Cloud Run: min-instances=0, max-instances=10, concurrency=80 (see infra/).
# A single uvicorn worker per container is correct here because Cloud Run scales
# containers horizontally and each container should host one event loop; the
# in-process cache and heartbeat buffer are per-container singletons by design.
# --proxy-headers + --forwarded-allow-ips='*': Cloud Run terminates TLS at its
# edge and forwards plain HTTP to the container, setting X-Forwarded-Proto:
# https. Without trusting that header, request.url.scheme (and therefore the
# audience app/deps.py computes for verifying Cloud Scheduler's OIDC tokens)
# would incorrectly come out as "http", which never matches the "https"
# audience Cloud Scheduler actually signs the token for.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips=*"]

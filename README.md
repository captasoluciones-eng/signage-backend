# Digital Signage Backend

Backend + admin panel + infrastructure-as-code for a fleet of ~100 Android TV
signage players.

```
signage-backend/
  backend/    FastAPI app (Cloud Run)
  frontend/   React + Vite admin panel
  infra/      Terraform, gcloud deploy.sh, BigQuery DDL, Firestore rules
  README.md   this file
  requests.http   curl / REST Client test collection
```

## Android APK base URL

```
https://<cloud-run-service-url>/playlist
```

The Cloud Run service URL is printed by `terraform output backend_url` (or by
`infra/deploy.sh`, or `gcloud run services describe signage-backend`). Configure
the Android app with `https://<that-url>/playlist?deviceId=<id>` for polling
and `https://<that-url>/register` / `/heartbeat` for the other two calls.

**Client-side note (Android, not enforced server-side):** add up to 60s of
random jitter on top of the configured `pollMinutes` interval before each
`/playlist` call, so ~100 devices don't all poll in the same second.

---

## 1. Prerequisites

- A GCP project with billing enabled.
- `gcloud`, `terraform` (>=1.5), `bq`, `gsutil`, `node` (>=18), `python` (3.12),
  and optionally the `firebase` CLI.
- A Firebase project **on the same GCP project** (Firebase Auth needs to be
  enabled there) with Google Sign-In turned on.

## 2. Provisioning order

Whichever path you pick (Terraform or `deploy.sh`), provision in this order --
later steps depend on earlier ones:

1. **Enable APIs & service accounts** (`run`, `firestore`, `bigquery`,
   `storage`, `cloudscheduler`, `artifactregistry`, `cloudbuild`,
   `identitytoolkit`, `compute`).
2. **Firestore (native mode)** -- a project can only have one Firestore
   database and its mode can't be changed later, so this must happen before
   any app code touches Firestore.
3. **GCS assets bucket + Cloud CDN backend** (video/image serving).
4. **BigQuery dataset, tables, views** (`infra/bigquery/*.sql` or the
   Terraform `google_bigquery_table` resources in `infra/terraform/bigquery.tf`
   -- pick one path, don't apply both to avoid drift).
5. **Build & push the backend image**, then **deploy Cloud Run**.
6. **Cloud Scheduler jobs**, which need the Cloud Run URL from step 5 and the
   scheduler service account's `roles/run.invoker` binding.
7. **Frontend build & deploy** (Firebase Hosting, or bundle into the backend
   image and redeploy Cloud Run).

### Option A -- Terraform (preferred)

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: project_id, backend_image, assets_bucket_name, ...

terraform init
terraform apply -target=google_project_service.required
terraform apply -target=google_firestore_database.default
# Build & push the backend image (see "Backend build" below), then:
terraform apply
```

`terraform apply` (full run) also creates the BigQuery tables/views and the
three Cloud Scheduler jobs. After it completes:

```bash
terraform output backend_url
terraform output android_playlist_base_url
```

Apply Firestore rules/indexes (Terraform manages the composite indexes; rules
are deployed via the Firebase CLI since `google_firestore_database` doesn't
manage security rules):

```bash
cd ../../infra
firebase deploy --only firestore:rules --project <PROJECT_ID>
```

### Option B -- `infra/deploy.sh` (gcloud/bq scripts)

```bash
cd signage-backend
PROJECT_ID=signage-prod REGION=us-central1 ASSETS_BUCKET=signage-prod-assets \
  ./infra/deploy.sh
```

This script enables APIs, creates service accounts + IAM bindings, provisions
Firestore + rules/indexes (best-effort via the `firebase` CLI, otherwise apply
`infra/firestore.rules` manually in the console), creates the assets bucket +
CDN backend bucket, applies the BigQuery DDL, builds the backend image with
Cloud Build, deploys Cloud Run, and creates the three Cloud Scheduler jobs. It
prints the Cloud Run URL at the end.

### Backend build (used by both options)

```bash
cd backend
pip install -r requirements.txt   # verifies the app installs cleanly
docker build -t us-central1-docker.pkg.dev/<PROJECT_ID>/signage/backend:latest .
docker push us-central1-docker.pkg.dev/<PROJECT_ID>/signage/backend:latest
```

Or let Cloud Build do it (no local Docker needed):

```bash
gcloud builds submit backend --tag us-central1-docker.pkg.dev/<PROJECT_ID>/signage/backend:latest
```

### Run locally (against real GCP resources, or emulators)

```bash
cd backend
cp .env.example .env         # fill in project id, allow-list, etc.
pip install -r requirements-dev.txt
export GOOGLE_APPLICATION_CREDENTIALS=./service-account-local.json
uvicorn app.main:app --reload --port 8080
```

Local unit tests that need no GCP credentials at all:

```bash
cd backend
pytest tests/
```

## 3. Frontend

```bash
cd frontend
cp .env.example .env          # Firebase Web SDK config
npm install
npm run dev                   # http://localhost:5173, proxies /admin etc. to :8080
```

**Deploy option 1 -- same Cloud Run image as the backend** (single service,
simplest ops):

```bash
npm run build
cp -r dist ../backend/static
cd ../backend
docker build -t <image> .   # now bundles the built frontend
docker push <image>
gcloud run deploy signage-backend --image <image> --region us-central1
```

FastAPI's `StaticFiles` mount in `app/main.py` automatically serves whatever
is in `backend/static/` at `/` once it exists (see the comment there).

**Deploy option 2 -- Firebase Hosting** (separate origin/CDN from the API,
recommended if you want independent scaling/caching for the SPA):

```bash
npm run build
firebase deploy --only hosting --project <PROJECT_ID>
```

(`frontend/firebase.json` is already configured for a Vite SPA rewrite.) Set
`VITE_API_BASE_URL` in `frontend/.env` to the Cloud Run URL in this mode, and
add the Hosting URL to the backend's `CORS_ALLOW_ORIGINS` env var / Terraform
`cors_allow_origins` variable.

## 4. Admin access control

Panel auth is Firebase Auth (Google sign-in) checked client-side, **plus** a
server-side email allow-list (`ADMIN_EMAIL_ALLOWLIST` env var / Terraform
`admin_email_allowlist` variable) enforced on every `/admin/*` route in
`app/deps.py::get_current_admin`. Signing in with a non-allow-listed Google
account authenticates successfully but gets a 403 from every admin API call.
Update the env var (and redeploy) to add/remove admins -- there is no UI for
managing the allow-list itself, by design (it's a security boundary, not a
CRUD resource).

## 5. Testing the contract end to end

See `requests.http` at the repo root for the full curl/REST-Client
collection: `/register` -> `/playlist` (including the `If-None-Match` / `304`
demonstration) -> `/heartbeat`, plus `/admin/pairing` and a couple of other
authenticated admin examples.

Quick manual smoke test:

```bash
BASE=https://<cloud-run-url>

curl -s -X POST "$BASE/register" -H "Content-Type: application/json" \
  -d '{"deviceId":"tv-demo-01","screenWidth":1920,"screenHeight":1080}'
# -> {"deviceId":"tv-demo-01","estado":"pendiente","pairingCode":"482913","created":true}

curl -s "$BASE/playlist?deviceId=tv-demo-01"
# -> {"version":1,...,"items":[]}   (pending device: no error, empty items)

# Pair it in the admin panel (or via POST /admin/pairing with pairingCode
# 482913), then:
ETAG=$(curl -sD - -o /dev/null "$BASE/playlist?deviceId=tv-demo-01" \
  -H "X-Device-Key: <issued-key>" | grep -i etag | cut -d' ' -f2 | tr -d '\r')

curl -si "$BASE/playlist?deviceId=tv-demo-01" \
  -H "X-Device-Key: <issued-key>" -H "If-None-Match: $ETAG"
# -> HTTP/1.1 304 Not Modified
```

## 6. Performance notes

- **Playlist cache**: process-local, keyed by `deviceId`, TTL 60s, explicitly
  invalidated by every admin write that could change a device's resolved
  playlist (command, overlay, group reassignment, group/playlist edits,
  pairing). A cache hit does zero Firestore reads -- see `app/cache.py`.
- **Heartbeats**: buffered in memory, flushed in one Firestore batched write
  (device state) + chunked BigQuery streaming inserts of up to 500 rows
  (`app/heartbeat_buffer.py`). Almost every `POST /heartbeat` just appends to
  the buffer and returns `204` immediately (no Firestore/BigQuery wait); only
  the occasional request that crosses the 15s flush interval since the last
  flush awaits `flush_once()` inline before responding -- deliberately, so the
  flush always runs while Cloud Run has CPU allocated for that request (see
  below). A `POST /jobs/flush-heartbeats` Cloud Scheduler job (every minute)
  is a safety net so a lull in device traffic can't leave the buffer stuck
  unflushed indefinitely.
- Cloud Run is configured with `min-instances=0` and the default
  `cpu_idle=true` (CPU only allocated while handling a request) -- it scales
  to zero between polls. This is what keeps the service inside Cloud Run's
  free tier at ~100-device traffic volumes (see Cost, below); it's also why
  there's no always-on background task anywhere in this service. Target:
  p95 < 150ms for `GET /playlist` on a cache hit (post-cold-start) -- with
  zero Firestore round-trips and a pure in-memory ETag comparison, the
  request path is a JSON-serialize + hash, well within budget on Cloud Run's
  smallest CPU tier.
- With ~100 devices polling every ~5 minutes (plus jitter), sustained load is
  well under 1 req/s; the architecture has headroom for 10x that without
  changes. If p95 latency from cold starts (scale-to-zero) ever becomes a
  real problem, raising `min_instances` to 1 fixes it at the cost of most of
  the free-tier savings below.

## 6b. Cost

This was deliberately designed to undercut a per-screen SaaS subscription
(e.g. ~$13.50/screen/month), not just to be "cheaper GCP infra":

- Firestore, BigQuery, Cloud Scheduler (4 jobs) and Artifact Registry storage
  all stay within their free tiers at this traffic volume.
- Cloud Run at `min_instances=0` / `cpu_idle=true`: ~100 devices polling
  `/playlist` every ~5 minutes plus heartbeats is well under the free tier's
  2M requests/month and 180,000 vCPU-seconds/month.
- No Cloud CDN / HTTP(S) load balancer in front of the assets bucket -- that
  combo has a fixed ~$18-25/month cost (the global forwarding rule) no matter
  how little traffic it serves, which isn't worth it yet. Assets are served
  directly from `https://storage.googleapis.com/<bucket>/...` instead (see
  `app/gcs_client.py`).
- The only real variable cost is network egress + storage for the actual
  video/image assets themselves, which scales with how much content you
  upload and how often it's fetched -- typically a few dollars/month, not a
  per-screen fee. Add Cloud CDN back (a previous version of `storage.tf` had
  it) once/if that egress cost or edge-caching latency actually justifies the
  fixed cost.

## 7. Extending the offline-alert hook

`app/routers/jobs.py::notify_devices_offline` is the extension point for the
5-minute "mark offline" job. It currently emits a structured log line
(`SIGNAGE_ALERT ...`) that you can attach a Cloud Monitoring log-based alert
policy to without redeploying; swap the function body for a real integration
(Slack webhook, Pub/Sub topic, email) when ready.

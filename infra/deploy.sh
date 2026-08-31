#!/usr/bin/env bash
# Alternative to Terraform: a well-organized gcloud/bq/firebase script that
# provisions the same infrastructure end to end. Safe to re-run (idempotent
# where the underlying gcloud/bq commands are).
#
# Usage:
#   PROJECT_ID=signage-prod REGION=us-central1 ./infra/deploy.sh
#
# Requires: gcloud (authenticated, with an active project set or PROJECT_ID
# exported), bq, firebase CLI (for firestore.rules/indexes), and Docker or
# Cloud Build access to build the backend image.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-us-central1}"
BQ_LOCATION="${BQ_LOCATION:-US}"
ASSETS_BUCKET="${ASSETS_BUCKET:-${PROJECT_ID}-assets}"
REPO="${ARTIFACT_REPO:-signage}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/backend:latest"
ADMIN_EMAIL_ALLOWLIST="${ADMIN_EMAIL_ALLOWLIST:-jesusbeltran@captasoluciones.com}"
CORS_ALLOW_ORIGINS="${CORS_ALLOW_ORIGINS:-https://signage-admin.web.app}"

echo "== Project: ${PROJECT_ID} | Region: ${REGION} =="
gcloud config set project "${PROJECT_ID}" >/dev/null

echo "== 1. Enable required APIs =="
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  bigquery.googleapis.com \
  storage.googleapis.com \
  cloudscheduler.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  identitytoolkit.googleapis.com \
  iam.googleapis.com \
  compute.googleapis.com

echo "== 2. Service accounts =="
gcloud iam service-accounts create signage-backend \
  --display-name="Signage backend (Cloud Run runtime SA)" || true
gcloud iam service-accounts create signage-scheduler \
  --display-name="Signage Cloud Scheduler invoker" || true

BACKEND_SA="signage-backend@${PROJECT_ID}.iam.gserviceaccount.com"
SCHEDULER_SA="signage-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"

for role in roles/datastore.user roles/bigquery.dataEditor roles/bigquery.jobUser \
            roles/storage.objectAdmin roles/iam.serviceAccountTokenCreator; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${BACKEND_SA}" --role="${role}" --condition=None >/dev/null
done

echo "== 3. Firestore (native mode) =="
gcloud firestore databases create --location="${REGION}" --type=firestore-native || true
firebase deploy --only firestore:rules,firestore:indexes --project "${PROJECT_ID}" \
  --config <(cat <<EOF
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  }
}
EOF
) || echo "  (skip if firebase CLI/project alias isn't configured; apply infra/firestore.rules manually otherwise)"

echo "== 4. Cloud Storage assets bucket + CDN =="
gsutil mb -l "${BQ_LOCATION}" -b on "gs://${ASSETS_BUCKET}" || true
gsutil iam ch allUsers:objectViewer "gs://${ASSETS_BUCKET}"
gsutil cors set /dev/stdin "gs://${ASSETS_BUCKET}" <<'EOF'
[{"origin": ["*"], "method": ["GET","HEAD","PUT","OPTIONS"], "responseHeader": ["Content-Type","ETag"], "maxAgeSeconds": 3600}]
EOF
gcloud compute backend-buckets create signage-assets-cdn-backend \
  --gcs-bucket-name="${ASSETS_BUCKET}" --enable-cdn || true
gcloud compute url-maps create signage-assets-cdn-urlmap \
  --default-backend-bucket=signage-assets-cdn-backend || true
echo "  NOTE: managed SSL cert + HTTPS proxy + forwarding rule + DNS record"
echo "  are one-time steps -- see infra/terraform/storage.tf for the exact"
echo "  resources if you prefer to finish CDN setup there."

echo "== 5. BigQuery dataset + tables + views =="
bq mk --location="${BQ_LOCATION}" --dataset "${PROJECT_ID}:signage" || true
bq query --use_legacy_sql=false --project_id="${PROJECT_ID}" < "$(dirname "$0")/bigquery/tables.sql"
bq query --use_legacy_sql=false --project_id="${PROJECT_ID}" < "$(dirname "$0")/bigquery/views.sql"

echo "== 6. Build and push the backend image =="
gcloud artifacts repositories create "${REPO}" --repository-format=docker \
  --location="${REGION}" --description="Signage backend images" || true
gcloud builds submit "$(dirname "$0")/../backend" --tag "${IMAGE}"

echo "== 7. Deploy Cloud Run service =="
gcloud run deploy signage-backend \
  --image="${IMAGE}" \
  --region="${REGION}" \
  --service-account="${BACKEND_SA}" \
  --min-instances=0 \
  --max-instances=10 \
  --concurrency=80 \
  --cpu=1 --memory=512Mi \
  --allow-unauthenticated \
  --set-env-vars="GCP_PROJECT=${PROJECT_ID},GCP_REGION=${REGION},BQ_DATASET=signage,BQ_LOCATION=${BQ_LOCATION},GCS_ASSETS_BUCKET=${ASSETS_BUCKET},FIREBASE_PROJECT_ID=${PROJECT_ID},ADMIN_EMAIL_ALLOWLIST=${ADMIN_EMAIL_ALLOWLIST},SCHEDULER_SERVICE_ACCOUNT_EMAIL=${SCHEDULER_SA},CORS_ALLOW_ORIGINS=${CORS_ALLOW_ORIGINS}"

BACKEND_URL="$(gcloud run services describe signage-backend --region="${REGION}" --format='value(status.url)')"
echo "Backend deployed at: ${BACKEND_URL}"

echo "== 8. Allow the scheduler SA to invoke the Cloud Run service =="
gcloud run services add-iam-policy-binding signage-backend \
  --region="${REGION}" \
  --member="serviceAccount:${SCHEDULER_SA}" \
  --role="roles/run.invoker"

echo "== 9. Cloud Scheduler jobs =="
gcloud scheduler jobs create http signage-mark-offline-devices \
  --location="${REGION}" --schedule="*/5 * * * *" --time-zone="America/Mazatlan" \
  --uri="${BACKEND_URL}/jobs/mark-offline-devices" --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA}" \
  --oidc-token-audience="${BACKEND_URL}/jobs/mark-offline-devices" || true

gcloud scheduler jobs create http signage-flush-heartbeats \
  --location="${REGION}" --schedule="* * * * *" --time-zone="America/Mazatlan" \
  --uri="${BACKEND_URL}/jobs/flush-heartbeats" --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA}" \
  --oidc-token-audience="${BACKEND_URL}/jobs/flush-heartbeats" || true

gcloud scheduler jobs create http signage-snapshot-devices \
  --location="${REGION}" --schedule="0 * * * *" --time-zone="America/Mazatlan" \
  --uri="${BACKEND_URL}/jobs/snapshot-devices" --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA}" \
  --oidc-token-audience="${BACKEND_URL}/jobs/snapshot-devices" || true

gcloud scheduler jobs create http signage-purge-old-heartbeats \
  --location="${REGION}" --schedule="0 3 * * *" --time-zone="America/Mazatlan" \
  --uri="${BACKEND_URL}/jobs/purge-old-heartbeats" --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA}" \
  --oidc-token-audience="${BACKEND_URL}/jobs/purge-old-heartbeats" || true

echo "== Done. Backend URL: ${BACKEND_URL} =="
echo "Android APK /playlist base URL: ${BACKEND_URL}/playlist"

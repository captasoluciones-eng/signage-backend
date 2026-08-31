variable "project_id" {
  description = "GCP project ID hosting the signage system."
  type        = string
}

variable "region" {
  description = "Primary region for Cloud Run, Scheduler and regional resources."
  type        = string
  default     = "us-central1"
}

variable "bq_location" {
  description = "BigQuery dataset location (multi-region)."
  type        = string
  default     = "US"
}

variable "backend_image" {
  description = "Fully-qualified container image for the backend, e.g. us-central1-docker.pkg.dev/PROJECT/signage/backend:latest"
  type        = string
}

variable "admin_email_allowlist" {
  description = "Comma-separated list of email addresses allowed into the admin panel."
  type        = string
  default     = "jesusbeltran@captasoluciones.com"
}

variable "cors_allow_origins" {
  description = "Comma-separated list of allowed CORS origins for the admin panel frontend."
  type        = string
  default     = "https://signage-admin.web.app"
}

variable "assets_bucket_name" {
  description = "Globally-unique GCS bucket name for signage video/image assets."
  type        = string
}

variable "min_instances" {
  type    = number
  default = 1
}

variable "max_instances" {
  type    = number
  default = 10
}

variable "container_concurrency" {
  type    = number
  default = 80
}

variable "cdn_domain" {
  description = "Custom domain mapped (via DNS + managed SSL cert) to the CDN load balancer that fronts the assets bucket."
  type        = string
  default     = "cdn.signage.example.com"
}

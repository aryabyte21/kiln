###############################################################################
# Kiln — GCP Infrastructure (Terraform)
#
# Provisions:
#   - GKE Autopilot cluster
#   - Cloud SQL PostgreSQL (2 instances: registry + chat)
#   - GCS bucket for tool artifacts
#   - Artifact Registry for Docker images
#   - VPC with private networking
#   - IAM service accounts
#
# Usage:
#   cd infra/terraform
#   terraform init
#   terraform plan -var="project_id=kiln-cs5224" -var="db_password_registry=..." -var="db_password_chat=..."
#   terraform apply
###############################################################################

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  name_prefix = "kiln-${var.environment}"
}

# ── APIs ────────────────────────────────────────────────────────────────────

resource "google_project_service" "apis" {
  for_each = toset([
    "container.googleapis.com",      # GKE
    "sqladmin.googleapis.com",       # Cloud SQL
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "servicenetworking.googleapis.com",
    "secretmanager.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

# ── VPC ─────────────────────────────────────────────────────────────────────

resource "google_compute_network" "vpc" {
  name                    = "${local.name_prefix}-vpc"
  auto_create_subnetworks = false

  depends_on = [google_project_service.apis]
}

resource "google_compute_subnetwork" "subnet" {
  name          = "${local.name_prefix}-subnet"
  network       = google_compute_network.vpc.id
  ip_cidr_range = "10.0.0.0/20"
  region        = var.region

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.4.0.0/14"
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.8.0.0/20"
  }
}

# Private IP for Cloud SQL
resource "google_compute_global_address" "private_ip" {
  name          = "${local.name_prefix}-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip.name]
}

# ── GKE Autopilot ──────────────────────────────────────────────────────────

resource "google_container_cluster" "kiln" {
  name     = "${local.name_prefix}-gke"
  location = var.region

  # Autopilot — no node pools to manage
  enable_autopilot = true

  network    = google_compute_network.vpc.id
  subnetwork = google_compute_subnetwork.subnet.id

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  # Private cluster — nodes don't get public IPs
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false # Allow kubectl from outside
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  deletion_protection = false

  depends_on = [
    google_project_service.apis,
    google_service_networking_connection.private_vpc,
  ]
}

# ── Cloud SQL — Registry DB ────────────────────────────────────────────────

resource "google_sql_database_instance" "registry" {
  name             = "${local.name_prefix}-registry-db"
  database_version = "POSTGRES_17"
  region           = var.region

  settings {
    tier              = "db-f1-micro" # Shared-core, ~$8/mo
    availability_type = "ZONAL"
    disk_size         = 10

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = google_compute_network.vpc.id
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }
  }

  deletion_protection = false

  depends_on = [google_service_networking_connection.private_vpc]
}

resource "google_sql_database" "registry" {
  name     = "kiln_registry"
  instance = google_sql_database_instance.registry.name
}

resource "google_sql_user" "registry" {
  name     = "kiln"
  instance = google_sql_database_instance.registry.name
  password = var.db_password_registry
}

# ── Cloud SQL — Chat DB ────────────────────────────────────────────────────

resource "google_sql_database_instance" "chat" {
  name             = "${local.name_prefix}-chat-db"
  database_version = "POSTGRES_17"
  region           = var.region

  settings {
    tier              = "db-f1-micro"
    availability_type = "ZONAL"
    disk_size         = 10

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = google_compute_network.vpc.id
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }
  }

  deletion_protection = false

  depends_on = [google_service_networking_connection.private_vpc]
}

resource "google_sql_database" "chat" {
  name     = "kiln_chat"
  instance = google_sql_database_instance.chat.name
}

resource "google_sql_user" "chat" {
  name     = "kiln"
  instance = google_sql_database_instance.chat.name
  password = var.db_password_chat
}

# ── GCS — Tool Artifacts ───────────────────────────────────────────────────

resource "google_storage_bucket" "tools" {
  name          = "${var.project_id}-kiln-tools"
  location      = var.region
  force_destroy = true

  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 5
    }
    action {
      type = "Delete"
    }
  }
}

# ── Artifact Registry ──────────────────────────────────────────────────────

resource "google_artifact_registry_repository" "kiln" {
  repository_id = "kiln"
  location      = var.region
  format        = "DOCKER"
  description   = "Kiln microservice Docker images"

  depends_on = [google_project_service.apis]
}

# ── IAM — Workload Identity for GKE pods ───────────────────────────────────

resource "google_service_account" "kiln_workload" {
  account_id   = "${local.name_prefix}-workload"
  display_name = "Kiln GKE Workload Identity"
}

# Allow GKE pods to act as this service account
resource "google_service_account_iam_member" "workload_identity" {
  service_account_id = google_service_account.kiln_workload.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[kiln/kiln-sa]"
}

# Grant Cloud SQL Client access
resource "google_project_iam_member" "sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.kiln_workload.email}"
}

# Grant GCS access for tool artifacts
resource "google_storage_bucket_iam_member" "tools_admin" {
  bucket = google_storage_bucket.tools.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.kiln_workload.email}"
}

# Grant Artifact Registry reader (for pulling images)
resource "google_project_iam_member" "ar_reader" {
  project = var.project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.kiln_workload.email}"
}

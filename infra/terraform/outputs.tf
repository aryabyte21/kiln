output "gke_cluster_name" {
  value = google_container_cluster.kiln.name
}

output "gke_cluster_endpoint" {
  value     = google_container_cluster.kiln.endpoint
  sensitive = true
}

output "registry_db_connection" {
  value = google_sql_database_instance.registry.connection_name
}

output "chat_db_connection" {
  value = google_sql_database_instance.chat.connection_name
}

output "gcs_bucket" {
  value = google_storage_bucket.tools.name
}

output "artifact_registry" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.kiln.repository_id}"
}

output "workload_sa_email" {
  value = google_service_account.kiln_workload.email
}

# Helper: how to connect kubectl
output "gke_get_credentials" {
  value = "gcloud container clusters get-credentials ${google_container_cluster.kiln.name} --region ${var.region} --project ${var.project_id}"
}

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "asia-southeast1" # Singapore — closest to NUS
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "db_password_registry" {
  description = "Password for the Kiln registry PostgreSQL database"
  type        = string
  sensitive   = true
}

variable "db_password_chat" {
  description = "Password for the Kiln chat PostgreSQL database"
  type        = string
  sensitive   = true
}

variable "clerk_domain" {
  description = "Clerk auth domain"
  type        = string
  default     = ""
}

variable "clerk_secret_key" {
  description = "Clerk secret key"
  type        = string
  sensitive   = true
  default     = ""
}

variable "mistral_api_key" {
  description = "Mistral API key for synthesis and planning"
  type        = string
  sensitive   = true
  default     = ""
}

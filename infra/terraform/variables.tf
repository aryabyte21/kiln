variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "asia-southeast1"
}

variable "zone" {
  type    = string
  default = "asia-southeast1-a"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "billing_account_id" {
  type    = string
  default = ""
}

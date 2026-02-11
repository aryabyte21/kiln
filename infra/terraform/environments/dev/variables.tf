variable "aws_region" {
  type        = string
  description = "AWS region for the dev environment."
  default     = "ap-southeast-1"
}

variable "project_name" {
  type        = string
  description = "Project name prefix."
  default     = "cs5224"
}

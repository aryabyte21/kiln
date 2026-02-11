provider "aws" {
  region = var.aws_region
}

module "platform" {
  source = "../../modules/platform"

  environment = "prod"
  project_name = var.project_name
}

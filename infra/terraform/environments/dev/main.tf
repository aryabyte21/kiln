provider "aws" {
  region = var.aws_region
}

module "platform" {
  source = "../../modules/platform"

  environment = "dev"
  project_name = var.project_name
}

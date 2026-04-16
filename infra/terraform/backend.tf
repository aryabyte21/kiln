terraform {
  backend "gcs" {
    bucket = "kiln-cs5224-tfstate"
    prefix = "env/dev"
  }
}

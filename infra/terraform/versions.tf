terraform {
  required_version = ">= 1.6"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.48"
    }
  }

  # State lives in a local file OUTSIDE version control (private/ is
  # git-ignored, *.tfstate is too). Back this file up: it is the only record
  # of what terraform created.
  backend "local" {
    path = "../../private/terraform/hale.tfstate"
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

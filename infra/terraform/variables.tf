variable "hcloud_token" {
  description = "Hetzner Cloud API token (read/write). Pass via TF_VAR_hcloud_token; never commit."
  type        = string
  sensitive   = true
}

variable "owner_ip_cidr" {
  description = "Owner's public IP in CIDR form (e.g. 203.0.113.7/32). Only this address may reach SSH."
  type        = string

  validation {
    condition     = can(cidrhost(var.owner_ip_cidr, 0)) && var.owner_ip_cidr != "0.0.0.0/0" && var.owner_ip_cidr != "::/0"
    error_message = "owner_ip_cidr must be a valid CIDR and must not be open to the whole internet."
  }
}

variable "ssh_public_key" {
  description = "Contents of the owner's SSH public key (e.g. ~/.ssh/id_ed25519.pub)."
  type        = string
}

variable "server_type" {
  type    = string
  default = "cx22"
}

variable "location" {
  type    = string
  default = "fsn1"
}

variable "name" {
  type    = string
  default = "tablo"
}

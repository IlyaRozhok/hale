resource "hcloud_ssh_key" "owner" {
  name       = "${var.name}-owner"
  public_key = var.ssh_public_key
}

resource "hcloud_firewall" "tablo" {
  name = "${var.name}-fw"

  # SSH: owner's IP only.
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = [var.owner_ip_cidr]
  }

  # HTTP (ACME + redirect) and HTTPS: public.
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
  # Everything else inbound (including 5432) is dropped by default.
}

resource "hcloud_server" "tablo" {
  name         = var.name
  server_type  = var.server_type
  image        = "ubuntu-24.04"
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.owner.id]
  firewall_ids = [hcloud_firewall.tablo.id]
  user_data    = file("${path.module}/cloud-init.yml")

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  lifecycle {
    ignore_changes = [user_data]
  }
}

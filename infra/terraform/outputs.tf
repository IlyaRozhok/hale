output "server_ipv4" {
  description = "Point the domain's A record here."
  value       = hcloud_server.tablo.ipv4_address
}

output "server_ipv6" {
  value = hcloud_server.tablo.ipv6_address
}

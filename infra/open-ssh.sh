#!/usr/bin/env bash
# Opens SSH to the machine's current public IP, for a dynamic IP. Run on the OWNER'S MACHINE.
# Changes only the firewall (-target), so it applies without asking. The app, HTTPS and the
# background jobs do not depend on this rule.
#
# The Hetzner token comes from the macOS Keychain. Save it once, with the token in the clipboard:
#   security add-generic-password -U -a hale -s hetzner-token -w "$(pbpaste)"
set -euo pipefail

ip=$(curl -4 -fsS --max-time 10 https://ifconfig.me)
case "$ip" in
  *[!0-9.]* | "") echo "could not read the public IP: $ip" >&2; exit 1 ;;
esac

here=$(cd "$(dirname "$0")" && pwd)
TF_VAR_hcloud_token=$(security find-generic-password -a hale -s hetzner-token -w)
TF_VAR_owner_ip_cidr="$ip/32"
TF_VAR_ssh_public_key=$(cat "$HOME/.ssh/id_ed25519.pub")
export TF_VAR_hcloud_token TF_VAR_owner_ip_cidr TF_VAR_ssh_public_key

terraform -chdir="$here/terraform" apply -target=hcloud_firewall.hale -auto-approve -compact-warnings >/dev/null
echo "ssh is open for $ip"

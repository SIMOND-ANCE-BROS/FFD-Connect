# ============================================
# DNS — Managed externally (Cloudflare)
# ============================================
# DNS records for ffd.gabin-simond.fr are managed in Cloudflare:
#   - api.ffd.gabin-simond.fr → backend (74.234.88.215)
#   - ffd.gabin-simond.fr → landing
#   - my.ffd.gabin-simond.fr → web app
#
# Caddy on the VM handles TLS via Let's Encrypt directly.
# Cloudflare proxy must stay disabled (DNS-only / grey cloud) for Caddy
# to obtain certificates.
#
# This file is intentionally empty — Terraform manages no DNS resources.

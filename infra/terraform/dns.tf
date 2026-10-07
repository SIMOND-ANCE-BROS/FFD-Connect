# ============================================
# DNS — Managed externally (Cloudflare)
# ============================================
# DNS records for ffd.gabin-simond.fr are managed in Cloudflare:
#   - api.ffd.gabin-simond.fr → backend (74.234.88.215)
#   - ffd.gabin-simond.fr → GitHub Pages (CNAME simond-ance-bros.github.io;
#     custom domain + certificate set in the repo's Pages settings, site
#     published by .github/workflows/deploy-landing.yml)
#   - my.ffd.gabin-simond.fr → web app
#
# Legacy note: the api record above dates from the retired VM, whose Caddy
# obtained Let's Encrypt certificates (Cloudflare proxy had to stay DNS-only).
# GitHub Pages issues its own certificate, which also requires DNS-only.
#
# This file is intentionally empty — Terraform manages no DNS resources.

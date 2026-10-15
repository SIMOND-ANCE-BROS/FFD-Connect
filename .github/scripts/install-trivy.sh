#!/bin/sh
# =============================================================================
# install-trivy.sh — install a pinned, checksum-verified Trivy on a CI runner
# =============================================================================
#
# Used by ci.yml (docker-build-check, build-image) to scan the backend image
# (#486). Same pattern as osv-scanner and gitleaks: the official release
# tarball, pinned and verified against its SHA-256, rather than
# aquasecurity/trivy-action (a composite action that pulls setup-trivy and
# actions/cache, i.e. more third-party code with the scan's permissions) or
# Trivy's install script (unpinned network code). One binary, one digest.
#
# Upgrading: change TRIVY_VERSION and TRIVY_SHA256 below (value of
# trivy_<version>_checksums.txt, Linux-64bit.tar.gz line, for a release
# published at least two weeks ago). Dependabot does not track this download.
#
# Usage: sh .github/scripts/install-trivy.sh   (Linux x86_64 runner only)
# Puts `trivy` on GITHUB_PATH; prints the installed version.
set -eu

TRIVY_VERSION=0.74.0
TRIVY_SHA256=2ae6fe3ee734b7fdf11335663e18c75ea12dccc76062f09f164a3b0f8be4371a

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) ;;
  *)
    echo "::error::install-trivy.sh: unsupported platform $(uname -s)-$(uname -m)"
    exit 1
    ;;
esac

dest="${RUNNER_TEMP:-/tmp}/trivy-bin"
archive="$dest/trivy.tar.gz"
mkdir -p "$dest"
curl --fail --silent --show-error --location --retry 3 \
  "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" \
  -o "$archive"
echo "${TRIVY_SHA256}  $archive" | sha256sum -c -
tar -xzf "$archive" -C "$dest" trivy
rm -f "$archive"
chmod +x "$dest/trivy"
if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$dest" >> "$GITHUB_PATH"
fi
"$dest/trivy" --version

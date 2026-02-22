#!/usr/bin/env bash
set -euo pipefail

bash scripts/e2e-trackab.sh
bash scripts/e2e-phase2.sh
bash scripts/e2e-phase3.sh
bash scripts/e2e-phase4.sh
bash scripts/e2e-phase5.sh

echo "TRACK_ABCDE_E2E_SUCCESS"

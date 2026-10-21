#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted changes; commit or stash them before deploying." >&2
  exit 1
fi

IMAGE="ghcr.io/steviepee/stopwatch-scheduler:$(git rev-parse --short HEAD)"

docker build -t "$IMAGE" .
docker push "$IMAGE"
az containerapp update -n stopwatch-api -g rg-stopwatch --image "$IMAGE"
(cd mobile && EXPO_PUBLIC_API_URL=https://api.stopwatchscheduler.app/api eas update --channel preview --environment preview --message "$(git rev-parse --short HEAD): $(git log -1 --format=%s)" --non-interactive)

FQDN=$(az containerapp show -n stopwatch-api -g rg-stopwatch --query properties.configuration.ingress.fqdn -o tsv)
echo "Deployed $IMAGE"
echo "https://$FQDN"

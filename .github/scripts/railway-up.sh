#!/usr/bin/env bash
#
# Deploy one Railway service, telling a failed *build* apart from a failed
# *log stream*.
#
# `railway up --ci` streams build logs and exits non-zero when that stream
# dies, which says nothing about whether the build succeeded. Observed on both
# services on 2026-08-10: the upload was accepted, a build id was returned, the
# deployment shows Success in the dashboard, the site served the new bundle —
# and the command still reported failure.
#
# Retrying was the wrong instrument for that. The exit code is not flaky, it is
# *wrong*, so a retry loop just produces three identical deployments and fails
# anyway (which is exactly what happened). The fix is to read the failure
# properly and then verify the deploy by its outcome, which the workflow does
# in the step after each of these.
#
# Any other non-zero exit stays fatal.
set -uo pipefail

service="${1:?usage: railway-up.sh <service>}"
log="$(mktemp)"

if railway up --service "$service" --ci 2>&1 | tee "$log"; then
  exit 0
fi

if grep -qi "failed to stream build logs" "$log"; then
  echo "::warning::railway up --service ${service} lost the build-log stream." \
       "The upload was accepted, so the deploy is left to the verification step" \
       "that follows rather than being called a failure here."
  exit 0
fi

echo "::error::railway up --service ${service} failed for a reason other than" \
     "log streaming — see the output above."
exit 1

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${ROOT}/cdk.out/authorizer-bundle"
LOG_FILE="${OUT_DIR}.log"

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"

echo "==> Bundling authorizer with SAM Python 3.11 image (pinned versions via PyPI)" | tee "${LOG_FILE}"
docker run --rm \
    --platform=linux/amd64 \
    -v "${ROOT}:/asset-input:delegated" \
    -v "${OUT_DIR}:/asset-output:delegated" \
    -w /asset-input \
    public.ecr.aws/sam/build-python3.11 \
    bash -c "set -euo pipefail; \
    export PIP_NO_BUILD_ISOLATION=1 PIP_ONLY_BINARY=:all: PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_CACHE_DIR=/tmp/pipcache; \
    pip install --platform manylinux2014_x86_64 --implementation cp --python-version 3.11 --abi cp311 --only-binary=:all: \
        -t /asset-output \
        -r /asset-input/lambda/authorizer/requirements.txt \
        -c /asset-input/lambda/authorizer/constraints.txt; \
    cp /asset-input/docker/src/lambda_authorizer.py /asset-output/index.py" >>"${LOG_FILE}" 2>&1

if [ ! -s "${OUT_DIR}/index.py" ]; then
    echo "Bundle failed: index.py not produced" | tee -a "${LOG_FILE}"
    exit 1
fi

echo "==> Running bundle contract test" | tee -a "${LOG_FILE}"
ROOT="${ROOT}" OUT_DIR="${OUT_DIR}" python3 - <<'PY' >>"${LOG_FILE}" 2>&1
import os
import sys
import types

bundle = os.environ["OUT_DIR"]
sys.path.insert(0, bundle)

# Stub boto3/botocore so the bundle can import without Lambda runtime modules present
fake_boto3 = types.SimpleNamespace(client=lambda _service: None)
fake_botocore_exceptions = types.SimpleNamespace(ClientError=Exception)
sys.modules["boto3"] = fake_boto3
sys.modules["botocore"] = types.SimpleNamespace(exceptions=fake_botocore_exceptions)
sys.modules["botocore.exceptions"] = fake_botocore_exceptions
# Stub benchling_sdk to avoid importing compiled dependencies locally
fake_webhook_helpers = types.SimpleNamespace(verify=lambda *_args, **_kwargs: True)
fake_helpers = types.SimpleNamespace(webhook_helpers=fake_webhook_helpers)
fake_apps = types.SimpleNamespace(helpers=fake_helpers)
fake_benchling_sdk = types.SimpleNamespace(apps=fake_apps)
sys.modules["benchling_sdk"] = fake_benchling_sdk
sys.modules["benchling_sdk.apps"] = fake_apps
sys.modules["benchling_sdk.apps.helpers"] = fake_helpers
sys.modules["benchling_sdk.apps.helpers.webhook_helpers"] = fake_webhook_helpers

import index  # type: ignore

os.environ["BENCHLING_SECRET_ARN"] = "arn:local:test"


class DummySecrets:
    def get_secret_value(self, SecretId):
        return {"SecretString": '{"app_definition_id": "app_123"}'}


def fake_verify(app_definition_id, body, headers):
    assert app_definition_id == "app_123"
    assert body == "{}"
    assert headers["webhook-id"] == "abc123"
    return True


index._get_secrets_client = lambda: DummySecrets()  # type: ignore[attr-defined]
index.verify = fake_verify  # type: ignore

event = {
    "headers": {
        "webhook-id": "abc123",
        "webhook-signature": "sig",
        "webhook-timestamp": "1234567890",
    },
    "body": "{}",
    "methodArn": "arn:aws:execute-api:region:123456789012:api/prod/POST/event",
}

result = index.handler(event, None)
effect = result["policyDocument"]["Statement"][0]["Effect"]
assert effect == "Allow", result
print("Contract test passed (effect=Allow)")
PY

echo "Bundle available at: ${OUT_DIR}"
echo "Log: ${LOG_FILE}"

#!/bin/bash

# Ensure environment variables are set
if [[ -z "$BENCHLING_CLIENT_ID" || -z "$BENCHLING_TENANT" || -z "$BENCHLING_CLIENT_SECRET" ]]; then
    echo "Error: Required environment variables are not set. Please source .env first."
    exit 1
fi

# Debugging: Print the extracted values
echo "BENCHLING_CLIENT_ID: $BENCHLING_CLIENT_ID"
echo "BENCHLING_TENANT: $BENCHLING_TENANT"

API_ROOT="https://${BENCHLING_TENANT}.benchling.com/api/v2"

# Function to get OAuth Token
get_token() {
    curl -s -X POST "$API_ROOT/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "client_id=${BENCHLING_CLIENT_ID}" \
        -d "client_secret=${BENCHLING_CLIENT_SECRET}" \
        -d "grant_type=client_credentials" | jq -r '.access_token'
}

# Generic function to make API requests
api_request() {
    local method=$1
    local endpoint=$2
    local data=$3

    curl -v -X "$method" "$API_ROOT/$endpoint" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        ${data:+--data "$data"}
}

# Get OAuth Token
TOKEN=$(get_token)

# Export TOKEN globally
export TOKEN

# Debugging: Print the token
if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
    echo "Error: Failed to retrieve access token."
    exit 1
fi
echo "TOKEN: $TOKEN"

# Check if CANVAS_ID is provided as an argument
if [[ -n "$1" ]]; then
    CANVAS_ID="$1"
    echo "Fetching canvas with ID: $CANVAS_ID"
    echo "=== $CANVAS_ID ==="
    api_request "GET" "app-canvases/${CANVAS_ID}"
    echo "=== $CANVAS_ID ==="

    echo "Updating canvas with ID: $CANVAS_ID"
    api_request "PATCH" "app-canvases/${CANVAS_ID}" '{
        "blocks": [
            {
                "enabled": true,
                "id": "user_defined_id",
                "text": "Click me to submit",
                "type": "BUTTON"
            }
        ],
        "enabled": true,
        "featureId": "quilt_integration"
    }'

else
    echo "No canvas ID provided. Fetching apps instead."
    api_request "GET" "apps"
fi

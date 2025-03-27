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

# Function to call API with GET request for a specific resource
get_list() {
    local resource=$1
    curl -X GET "$API_ROOT/$resource" \
        -H "Authorization: Bearer $2" \
        -H "Content-Type: application/json"
}

# Function to get canvas details
get_canvas() {
    local canvas_id=$1
    curl -s --request GET \
        --url "$API_ROOT/app-canvases/${canvas_id}" \
        --header "Authorization: Bearer $2" \
        --header "Content-Type: application/json"
}

# Function to update app canvas
update_canvas() {
    local canvas_id=$1
    curl --request PATCH \
        --url "$API_ROOT/app-canvases/${canvas_id}" \
        --header "Content-Type: application/json" \
        --header "Authorization: Bearer $2" \
        --data '{
            "blocks": [
                {
                    "type": "MARKDOWN",
                    "text": "Initializing canvas...",
                    "id": "init"
                }
            ],
            "enabled": true,
            "featureId": "quilt_integration"
        }'
}

# Get OAuth Token
TOKEN=$(get_token)

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
    CANVAS_DETAILS=$(get_canvas "$CANVAS_ID" "$TOKEN")
    echo "Canvas details: $CANVAS_DETAILS"

    echo "Updating canvas with ID: $CANVAS_ID"
    update_canvas "$CANVAS_ID" "$TOKEN"
else
    echo "No canvas ID provided. Fetching entries instead."
    get_list "apps" "$TOKEN"
fi
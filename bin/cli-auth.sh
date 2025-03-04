#!/bin/bash

# Must first `source .env` to set the environment variables

# Debugging: Print the extracted values
echo "BENCHLING_CLIENT_ID: $BENCHLING_CLIENT_ID"
echo "BENCHLING_CLIENT_SECRET: $BENCHLING_CLIENT_SECRET"

# Get OAuth Token
TOKEN=$(curl -s -X POST "https://quilt-dtt.benchling.com/api/v2/token" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "client_id=${BENCHLING_CLIENT_ID}" \
     -d "client_secret=${BENCHLING_CLIENT_SECRET}" \
     -d "grant_type=client_credentials" | jq -r '.access_token')

# Debugging: Print the token
echo "TOKEN: $TOKEN"

# Use the token to call the API
curl -X GET "https://quilt-dtt.benchling.com/api/v2/entries" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json"

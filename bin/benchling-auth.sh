#!/bin/bash

# Must first `source .env` to set the environment variables

# Retrieve secrets from AWS Secrets Manager
SECRET_JSON=$(aws secretsmanager get-secret-value \
    --secret-id $BENCHLING_CLIENT_SECRETS_ARN \
    --query SecretString \
    --output text)

# Extract client_id and client_secret
BENCHLING_CLIENT_ID=$(echo $SECRET_JSON | jq -r '.BENCHLING_CLIENT_ID')
BENCHLING_CLIENT_SECRET=$(echo $SECRET_JSON | jq -r '.BENCHLING_CLIENT_SECRET')

# Get OAuth Token
TOKEN=$(curl -s -X POST "https://quilt-dtt.benchling.com/api/v2/token" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "client_id=${BENCHLING_CLIENT_ID}" \
     -d "client_secret=${BENCHLING_CLIENT_SECRET}" \
     -d "grant_type=client_credentials" | jq -r '.access_token')

# Use the token to call the API
curl -X GET "https://quilt-dtt.benchling.com/api/v2/plates" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json"
# Benchling Webhook Stack Architecture

This directory contains the core CDK infrastructure code split across multiple files for better organization:

## Core Components

### benchling-webhook-stack.ts

The main stack file that orchestrates the entire infrastructure. It:

- Creates the S3 bucket reference
- Sets up the Benchling OAuth connection
- Instantiates the state machine and API gateway
- Manages stack outputs

### state-machine.ts

Contains the Step Functions state machine definition that:

- Processes incoming webhook events
- Stores event data in S3
- Fetches entry details from Benchling API
- Sends notifications to SQS

### api-gateway.ts

Handles the API Gateway configuration including:

- REST API setup with logging
- IAM roles and permissions
- Webhook endpoints for different event types
- Integration with Step Functions

## Flow

1. API Gateway receives webhook POST requests
2. Requests trigger Step Functions execution
3. State machine:
   - Stores raw event in S3
   - Fetches entry details from Benchling
   - Stores entry data in S3
   - Sends notification to SQS

## Key Features

- Modular architecture for maintainability
- Separation of concerns between components
- Reusable constructs
- Proper error handling
- Comprehensive logging

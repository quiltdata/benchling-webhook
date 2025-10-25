# Benchling Integration Source Code

This directory contains the core components of the Benchling integration service, which processes Benchling webhook events and orchestrates data exports to Quilt packages.

## Architecture Overview

The service uses Python-based orchestration (replacing AWS Step Functions) to handle Benchling entry updates and export workflows. It's built as a Flask application with modular components for different responsibilities.

## Components

### Core Application

- **`app.py`** - Flask application with webhook endpoints, health checks, and initialization logic
- **`config.py`** - Configuration management using environment variables

### Orchestration & Workflow

- **`entry_packager.py`** - Entry packager that exports Benchling entries, packages them with metadata, and queues them for Quilt via SQS
- **`execution_store.py`** - In-memory execution tracking that mimics AWS Step Functions execution records
- **`models.py`** - Data models and enums for workflow state and export tasks

### External Integrations

- **`benchling_client.py`** - Benchling API client with OAuth authentication, REST/GraphQL support, and token management
- **`export_processor.py`** - Handles downloading, extracting, and uploading Benchling export ZIP files to S3

### Utilities

- **`retry_utils.py`** - Retry decorators with exponential backoff for handling transient failures

## Event Flow

```text
1. Benchling Event
   ↓
2. Webhook Received (/event)
   ↓
3. Validate Event Type (v2.entry.updated.fields, v2.entry.created)
   ↓
4. Create WorkflowInput from payload
   ↓
5. Start Entry Packaging (EntryPackager)
   ↓
6. Execute Workflow Steps:
   a. Fetch entry data (BenchlingClient)
   b. Create export task
   c. Process export (ExportProcessor)
   d. Upload to S3
   e. Create/update Quilt package
   ↓
7. Track execution state (ExecutionStore)
   ↓
8. Return execution ARN and status
```

### Supported Event Types

#### Webhook Events (`/event`)

- `v2.entry.updated.fields` - Entry field updates (triggers workflow)
- `v2.entry.created` - New entry creation (triggers workflow)

#### Lifecycle Events (`/lifecycle`)

- `v2.app.installed` - App installation in Benchling tenant
- `v2.app.activateRequested` - App activation request
- `v2.app.deactivated` - App deactivation
- `v2-beta.app.configuration.updated` - App configuration changes

#### Canvas Events (`/canvas`)

- `v2.canvas.initialized` - Canvas opened with entry context (unavailable)
- `v2.canvas.created` - Canvas created without specific entry
- `v2.canvas.userInteracted` - User clicks "Update Package" button to trigger workflow

### Workflow Steps

1. **Entry Validation** - Verify entry exists and is accessible
2. **Export Creation** - Request export from Benchling
3. **Export Processing** - Download, extract, and process ZIP files
4. **S3 Upload** - Upload processed files to configured S3 bucket
5. **Quilt Package Management** - Create or update Quilt data packages

## Key Features

- **OAuth Authentication** - Secure API access with automatic token refresh
- **Retry Logic** - Exponential backoff for transient failures
- **Execution Tracking** - In-memory state management compatible with Step Functions interface
- **Health Monitoring** - Health, readiness, and liveness endpoints
- **Structured Logging** - JSON-formatted logs with context

## Configuration

The service requires these environment variables:

- `BENCHLING_TENANT` - Benchling tenant name
- `BENCHLING_CLIENT_ID` - OAuth client ID
- `BENCHLING_CLIENT_SECRET` - OAuth client secret
- `AWS_REGION` - AWS region for S3 operations
- `S3_BUCKET_NAME` - Target S3 bucket
- `SQS_QUEUE_URL` - SQS queue for async processing
- `QUILT_CATALOG` - Quilt catalog endpoint

## Error Handling

The system includes comprehensive error handling:

- **API Errors** - Custom exceptions for Benchling API issues
- **Rate Limiting** - Automatic retry with exponential backoff
- **Authentication** - Token refresh and error recovery
- **Validation** - Input validation and sanitization
- **Execution Tracking** - Failed executions are recorded with error details

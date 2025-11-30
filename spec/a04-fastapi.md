# A04: FastAPI Migration

## Goal

- Replace the Flask-based Python service in `docker/` with FastAPI/ASGI while preserving existing endpoints, request/response shapes, and background workflow behavior.

## Scope (where/what to change)

- `docker/src/app.py`: Swap Flask app factory for FastAPI app instance; move route definitions (`/health`, `/health/ready`, `/health/live`, `/config`, `/event`, `/lifecycle`, `/canvas`) to FastAPI routers; replace Flask error handlers with FastAPI exception handlers; ensure background tasks/canvas updates don’t rely on Flask request context; keep structured logging and version reporting working under ASGI.
- `docker/src/webhook_verification.py`: Convert Flask-focused decorator and `Request` typing to FastAPI-compatible dependency/middleware that can read the raw body and still allow JSON parsing; ensure 401 responses and logging remain consistent.
- `docker/src/payload.py`: Update request parsing to accept FastAPI/Starlette `Request`; maintain single-parse behavior and ability to read body after signature verification; keep payload model behavior unchanged.
- `docker/src/config.py`: Remove Flask-specific env usage (`FLASK_ENV`) and docs; confirm logging level/env toggles still apply with FastAPI/uvicorn; adjust any Flask terminology in comments.
- `docker/Dockerfile`: Change runtime command to uvicorn (ASGI) instead of `python -m src.app`; drop `FLASK_APP` env; ensure healthcheck path/port stay aligned; verify env defaults (e.g., `PORT`) still flow into server.
- `docker/docker-compose.yml`: Update service command/environment to run FastAPI/uvicorn; replace Flask env vars/comments; keep healthcheck hitting `/health`.
- `docker/Makefile`: Rename targets/descriptions that say “Flask” to FastAPI; ensure run/test targets call the new entrypoint/commands.
- `bin/xdg-launch.ts`: Update messaging and spawn commands for native/docker modes to start the FastAPI server (uvicorn) instead of `python -m src.app`; keep health polling/test orchestration intact.
- Dependencies: `docker/pyproject.toml` (drop Flask classifier/dependency, add FastAPI/uvicorn/starlette typing as needed), regenerate `docker/uv.lock`, and adjust any tooling that assumes Flask.
- Tests: `docker/tests/test_webhook_verification.py` (and any other tests referencing Flask request/test contexts) need FastAPI/TestClient/httpx equivalents; ensure body re-read behavior stays covered.
- Docs: `docker/README.md` and `docker/src/README.md` update framework references, quickstart commands, and narrative (Flask → FastAPI/uvicorn); note any env var name changes.

## Non-goals/constraints

- Do not change API surface/URLs, Benchling event handling logic, or AWS integration behavior.
- Keep existing ports and health endpoints stable for Docker/ECS and `npm`/`make` workflows.

# Gunicorn Migration Checklist

**Issue**: [#280](https://github.com/quiltdata/benchling-webhook/issues/280)

## Files to Change

### 1. Dependencies

- [ ] `docker/pyproject.toml` - Add `gunicorn = "^23.0.0"`
- [ ] `docker/uv.lock` - Run `uv lock`

### 2. Dockerfile

- [ ] Remove lines 105-123 (NGINX Unit installation)
- [ ] Remove lines 172-175 (UNIT_* env vars)
- [ ] Replace CMD with:

```dockerfile
CMD ["gunicorn", "src.app:create_app", "--factory", "-k", "uvicorn.workers.UvicornWorker", "--workers", "4", "--bind", "0.0.0.0:8080", "--access-logfile", "-", "--error-logfile", "-"]
```

### 3. Docker Compose

- [ ] `app` service - Add gunicorn command:
```yaml
command: ["gunicorn", "src.app:create_app", "--factory", "-k", "uvicorn.workers.UvicornWorker", "--workers", "2", "--bind", "0.0.0.0:8080"]
```

- [ ] `app-dev` service - Keep existing uvicorn --reload command (NO CHANGE)
- [ ] `app-dev` service - Remove lines 68-69 (comment + `DISABLE_NGINX=true`)

### 4. CI/CD

- [ ] `.github/workflows/prod.yml` lines 123-163 - Remove "Validate NGINX Unit configuration" step
- [ ] `.github/workflows/prod.yml` line 170 - Change to "✅ Application starts successfully"

### 5. Delete Files

- [ ] `docker/unit-config.json`
- [ ] `docker/start-unit.sh`
- [ ] `docker/src/unit_app.py` (if exists)

## Testing

```bash
# Local test
docker build -t test .
docker run -d -p 8083:8080 test
curl http://localhost:8083/health

# Deploy dev
npm run deploy:dev

# Check logs for "Booting worker with pid"
```

## Done When

- ✅ Container starts with gunicorn logs
- ✅ Health endpoint returns 200
- ✅ Dev deployment successful

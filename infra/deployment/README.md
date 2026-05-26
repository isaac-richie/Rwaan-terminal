# Deployment

## Backend Ops Logging

Set these on the API host:

- `OPS_TOKEN`: bearer token required for protected ops endpoints.
- `ERROR_LOG_PATH`: optional JSONL file path for backend error events. Defaults to `../../.data/api-errors.log` from the API working directory.

Recent backend errors:

```bash
curl -H "Authorization: Bearer $OPS_TOKEN" \
  "https://api.rawli.markets/ops/errors/recent?limit=20&includeDisk=true"
```

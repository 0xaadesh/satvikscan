# SatvikScan

Scan food product ingredient labels and check dietary compliance (Vegetarian, Jain, Upvas, Swaminarayan, Vegan) using LLM-powered OCR and analysis with a PostgreSQL ingredient cache.

## Setup

```bash
bun install
docker compose up -d   # starts PostgreSQL + Adminer
```

Create a `.env` file (see `.env.example`) with your API keys and optional flags:

```env
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...

# Optional security flags
WEBUI=true              # set to false for API-only mode
ADMIN_PASSWORD=secret   # password to access the web UI
API_KEY=my-api-key      # required in X-API-Key header for API requests
```

## Run

```bash
# Web server (default — opens on http://localhost:3000)
bun run index.ts

# CLI mode — pass an image path
bun run index.ts ./photo.jpg
```

## API

> **Authentication:** If `API_KEY` is set, every API request must include the `X-API-Key` header.
> Web UI users authenticated via admin password get a session cookie and don't need the header.

### `POST /api/scan`

Upload a food product image for OCR + dietary compliance check. Optionally include `name` and `email` to log the scan per-user.

**curl (file upload):**

```bash
curl -X POST http://localhost:3000/api/scan \
  -H "X-API-Key: my-api-key" \
  -F "image=@/path/to/ingredient-label.jpg" \
  -F "name=Aadesh" \
  -F "email=aadesh@example.com"
```

**PowerShell:**

```powershell
curl.exe -X POST http://localhost:3000/api/scan -H "X-API-Key: my-api-key" -F "image=@C:\path\to\ingredient-label.jpg" -F "name=Aadesh" -F "email=aadesh@example.com"
```

**Response (success):**

```json
{
  "success": true,
  "ingredients": ["sugar", "wheat flour", "palm oil"],
  "compliance": {
    "guessed_item": "Parle-G Biscuits",
    "is_vegetarian": true,
    "reason_vegetarian": null,
    "is_jain": true,
    "reason_jain": null,
    "is_upvas_compliant": false,
    "reason_upvas": "contains wheat flour (grain)",
    "is_swaminarayan_compliant": true,
    "reason_swaminarayan": null,
    "is_vegan": true,
    "reason_vegan": null
  },
  "source": "llm"
}
```

`source` is `"llm"`, `"cache_exact"`, or `"cache_fuzzy"`.

**Response (non-food item — 422):**

```json
{
  "success": false,
  "error": "This is a shampoo bottle, not a food product."
}
```

**Response (unauthorized — 401):**

```json
{
  "error": "Missing or invalid API key. Provide X-API-Key header."
}
```

---

### `GET /api/history`

Retrieve past scan results (paginated).

| Param    | Default | Max | Description            |
| -------- | ------- | --- | ---------------------- |
| `limit`  | 50      | 200 | Number of results      |
| `offset` | 0       | —   | Skip this many results |

**curl:**

```bash
# Default (latest 50)
curl -H "X-API-Key: my-api-key" http://localhost:3000/api/history

# With pagination
curl -H "X-API-Key: my-api-key" "http://localhost:3000/api/history?limit=10&offset=20"
```

**PowerShell:**

```powershell
Invoke-RestMethod -Headers @{"X-API-Key"="my-api-key"} http://localhost:3000/api/history
Invoke-RestMethod -Headers @{"X-API-Key"="my-api-key"} "http://localhost:3000/api/history?limit=10&offset=20"
```

**Response:**

```json
{
  "success": true,
  "history": [
    {
      "id": 1,
      "ingredientsArray": ["sugar", "wheat flour", "palm oil"],
      "compliance": { "..." },
      "createdAt": "2026-03-06T12:00:00.000Z",
      "source": "ocr",
      "hitCount": 3
    }
  ]
}
```

---

### `GET /api/users`

List all users who have submitted scans, with scan counts.

```bash
curl -H "X-API-Key: my-api-key" http://localhost:3000/api/users
```

**Response:**

```json
{
  "success": true,
  "users": [
    {
      "userName": "Aadesh",
      "userEmail": "aadesh@example.com",
      "scanCount": 5,
      "lastScannedAt": "2026-03-09T14:30:00.000Z"
    }
  ]
}
```

---

### `GET /api/users/:email/scans`

Get scan history for a specific user by email (paginated).

| Param    | Default | Max | Description            |
| -------- | ------- | --- | ---------------------- |
| `limit`  | 50      | 200 | Number of results      |
| `offset` | 0       | —   | Skip this many results |

```bash
curl -H "X-API-Key: my-api-key" "http://localhost:3000/api/users/aadesh@example.com/scans"
```

**Response:**

```json
{
  "success": true,
  "scans": [
    {
      "id": 1,
      "userName": "Aadesh",
      "userEmail": "aadesh@example.com",
      "ingredients": ["sugar", "wheat flour"],
      "compliance": { "..." },
      "source": "llm",
      "scannedAt": "2026-03-09T14:30:00.000Z"
    }
  ]
}
```

---

### `POST /auth/login`

Authenticate to the web UI (only needed when `ADMIN_PASSWORD` is set).

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"secret"}'
```

Returns a `Set-Cookie` header with the session token on success.

### `GET /auth/logout`

Clears the session cookie.

```bash
curl http://localhost:3000/auth/logout
```

## Environment Variables

| Variable         | Required | Default | Description                                  |
| ---------------- | -------- | ------- | -------------------------------------------- |
| `OPENAI_API_KEY` | Yes      | —       | OpenAI API key for GPT diet checker          |
| `GROQ_API_KEY`   | Yes      | —       | Groq API key for Llama OCR                   |
| `DATABASE_URL`   | No       | *       | PostgreSQL connection string                 |
| `PORT`           | No       | 3000    | Server port                                  |
| `WEBUI`          | No       | true    | Set to `false` to disable web UI (API-only)  |
| `ADMIN_PASSWORD` | No       | —       | Password required to access the web UI       |
| `API_KEY`        | No       | —       | Key required in `X-API-Key` header for API   |

## Services

| Service  | URL                    |
| -------- | ---------------------- |
| Web UI   | http://localhost:3000   |
| Adminer  | http://localhost:8081   |
| Postgres | localhost:5433         |

# Vercel Deployment Guide

This repository deploys as **two separate Vercel projects** from the same
GitHub repository. Import each project independently in the Vercel dashboard
and set the **Root Directory** to `backend` or `frontend` respectively.

---

## 1. Backend Project

### Vercel Dashboard Settings

| Setting | Value |
|---|---|
| **Root Directory** | `backend` |
| **Framework Preset** | Node.js (auto-detected via `"main": "server.js"`) |
| **Build Command** | *(leave blank — no build step needed)* |
| **Output Directory** | *(leave blank)* |
| **Install Command** | `npm install` *(default)* |

### Required Environment Variables

Set all of the following in the Vercel project → Settings → Environment Variables.
**Never commit these values to the repository.**

| Variable | Description | Example |
|---|---|---|
| `NODE_ENV` | Must be `production` | `production` |
| `MONGODB_URI` | MongoDB Atlas connection string | `mongodb+srv://user:pass@cluster.mongodb.net/dbname` |
| `JWT_SECRET` | Strong random secret (≥ 32 chars) | *(generate with `openssl rand -hex 32`)* |
| `JWT_EXPIRES_IN` | Token lifetime | `1d` |
| `CLIENT_URL` | Deployed frontend URL — used in CORS allow-list | `https://smart-hospital-frontend.vercel.app` |
| `CORS_ORIGINS` | *(Optional)* Comma-separated extra allowed origins | `https://my-custom-domain.com` |
| `HOSPITAL_TIMEZONE` | IANA timezone string | `Asia/Kolkata` |
| `VAULT_STORAGE_PATH` | *(See limitations §4 below)* | `uploads/vault` |

> **CORS:** `CLIENT_URL` is the minimum required entry. The backend allows only
> explicitly listed origins in production (`NODE_ENV=production`). If you use a
> custom domain on the frontend, add it to `CORS_ORIGINS` as well.

### How the backend handles Vercel serverless

- `server.js` exports the Express `app` instance as `module.exports`.  
  Vercel wraps this in a serverless function and routes all requests to it via
  `vercel.json`'s catch-all rewrite.
- **MongoDB** connects lazily on the first request to the function instance
  (via the middleware added in `backend/src/app.js`) rather than at cold-start.
  Subsequent warm requests reuse the existing connection.
- `app.listen()` is **not** called in serverless mode — Vercel manages the port.
  The `startServer()` path only executes when `node server.js` is run directly
  (local development).

---

## 2. Frontend Project

### Vercel Dashboard Settings

| Setting | Value |
|---|---|
| **Root Directory** | `frontend` |
| **Framework Preset** | Angular *(or "Other" with explicit commands below)* |
| **Build Command** | `node scripts/set-env.js && npx ng build --configuration production` |
| **Output Directory** | `dist/smart-hospital-frontend/browser` |
| **Install Command** | `npm install` *(default)* |

### Required Environment Variables

| Variable | Description | Example |
|---|---|---|
| `BACKEND_URL` | Full base URL of the deployed **backend** Vercel project. No trailing slash. | `https://smart-hospital-backend.vercel.app` |

> **How it works:** `scripts/set-env.js` reads `BACKEND_URL` at build time and
> writes `src/environments/environment.prod.ts` with `apiUrl` set to
> `BACKEND_URL + /api`. The Angular CLI then bakes this URL into the production
> bundle. **No backend credentials are exposed** — only the public base URL.

### SPA routing

`frontend/vercel.json` rewrites all paths to `index.html` so that
Angular's client-side router handles navigation directly (deep links, refreshes).

---

## 3. Deployment Order

1. **Deploy the backend first** and note the assigned Vercel URL
   (e.g. `https://smart-hospital-backend.vercel.app`).
2. **Set `BACKEND_URL`** in the frontend project environment variables using
   the URL from step 1.
3. **Deploy the frontend.** The build script writes the correct API URL into
   the Angular bundle.
4. **Set `CLIENT_URL`** in the backend project environment variables using
   the frontend's Vercel URL.
5. **Redeploy the backend** (or trigger a redeployment) so CORS picks up the
   new `CLIENT_URL`.

> If you use a custom domain on either project, repeat steps 4–5 with the
> custom domain URLs.

---

## 4. Known Deployment Limitations

### 4a. Document Vault — file uploads will fail ⚠️

The Document Vault stores uploaded files at `backend/uploads/vault/` on the
local filesystem. Vercel serverless functions have a **read-only filesystem**
(`/tmp` only, ephemeral). File upload and download will return 503 errors in
production.

**Pending task:** Migrate `backend/src/services/vault.service.js` to a cloud
object store (Vercel Blob, AWS S3, Cloudinary, etc.) before enabling vault
in production.

### 4b. Review reminder cron job will not run ⚠️

`backend/src/jobs/reviewReminder.job.js` starts a persistent `node-cron`
schedule (`* * * * *`) that fires review reminders every minute. Serverless
functions are stateless and cannot maintain a background timer.

**Pending task:** Create a Vercel Cron Job that hits a protected internal
endpoint (e.g. `GET /api/cron/review-reminders`) once per minute. Add the
endpoint to the backend and configure a cron entry in `backend/vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/review-reminders",
      "schedule": "* * * * *"
    }
  ]
}
```

### 4c. Vercel serverless function limits

| Limit | Value |
|---|---|
| Request body size | 4.5 MB (Hobby) / configurable on Pro |
| Function timeout | 10 s (Hobby) / 300 s (Pro) |
| Filesystem writes | `/tmp` only, max ~512 MB, ephemeral |

---

## 5. Local Development (unchanged)

Both services continue to work normally with `npm start` or `npm run dev`.
No local changes are required.

```bash
# Backend (from repo root)
cd backend && npm run dev        # nodemon server.js on port 5000

# Frontend (from repo root)
cd frontend && npm start         # ng serve on port 4200
```

The local `frontend` dev build uses `environment.ts` (`apiUrl: 'http://localhost:5000/api'`)
which is not affected by `set-env.js`. That script only runs during Vercel builds.

---

## 6. Files Added by This Configuration

| File | Purpose |
|---|---|
| `backend/vercel.json` | Routes all backend requests to `server.js` as a serverless function |
| `frontend/vercel.json` | Rewrites all paths to `index.html` for SPA routing |
| `frontend/scripts/set-env.js` | Writes `environment.prod.ts` from `BACKEND_URL` at build time |
| `DEPLOYMENT.md` | This file |

# Free showcase deployment: Supabase + Render

This deployment uses one free Render web service for both the React site and API, plus the existing Supabase Free project for PostgreSQL and private image storage. Keeping the frontend and API on one HTTPS origin also avoids cross-origin cookie and WebSocket problems.

## 1. Confirm Supabase values

Keep these values private. Never commit them to GitHub.

- `DATABASE_URL`: the **session-mode pooler** URL on port `5432`, ending with `?sslmode=require`. Replace the password placeholder and URL-encode special characters in the password.
- `SUPABASE_URL`: the project URL, such as `https://project-ref.supabase.co`.
- `SUPABASE_SECRET_KEY`: the backend-only key beginning with `sb_secret_`.
- `SUPABASE_STORAGE_BUCKET`: `bus-uploads`.

The `bus-uploads` bucket should remain private, limit files to 10 MB, and allow `image/jpeg`, `image/png`, and `image/webp`.

## 2. Push the deployment files

From the repository root:

```powershell
git status
git add .
git commit -m "Prepare free production deployment"
git push origin main
```

Confirm that `.env` is not listed in the commit. The repository already ignores it.

## 3. Create the Render Blueprint

1. Sign in at [Render](https://dashboard.render.com/) with GitHub.
2. Choose **New +** → **Blueprint**.
3. Connect `shahfahim/Bus_Management` and select the `main` branch.
4. Render detects `render.yaml` and creates the `uniride-shahfahim` free web service.
5. Enter the private values when Render prompts:

| Render variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase session pooler URL (port `5432`) |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SECRET_KEY` | Supabase `sb_secret_...` backend key |
| `VAPID_PUBLIC_KEY` | The public VAPID key already saved locally |
| `VAPID_PRIVATE_KEY` | The private VAPID key already saved locally |
| `VAPID_SUBJECT` | `mailto:` followed by your real email address |

Render generates the JWT, QR, and production seed safeguards automatically. Do not copy local signing secrets to Render.

6. Apply the Blueprint and wait for the build, migration, and health check to finish.

If the service name is unavailable, choose another unique name and update both `WEB_ORIGIN` and `PUBLIC_API_URL` in `render.yaml` to the matching `https://<name>.onrender.com` address before applying it.

## 4. Verify the live application

Open [https://uniride-shahfahim.onrender.com](https://uniride-shahfahim.onrender.com), then verify:

1. `/health/ready` returns `status: ready` and `database: connected`.
2. Student, driver, and administrator accounts can sign in using the records already seeded in Supabase.
3. A lost-and-found image uploads, displays, and can be removed.
4. The driver location updates in a second signed-in browser window.
5. Sign out and sign back in to confirm secure production cookies.

## Free-tier limits

Render Free web services sleep after 15 minutes without inbound HTTP or WebSocket activity. The first request after sleeping can take about one minute. Render's filesystem is temporary, which is why uploads are stored privately in Supabase instead. This setup is suitable for a university project showcase, not a high-availability production transport service.

Real card payments remain disabled until valid Stripe credentials and a public webhook are configured. All non-payment features work without Stripe.

## Updating the live site

After later changes pass `npm run verify:release`:

```powershell
git add .
git commit -m "Describe the change"
git push origin main
```

Render automatically builds and deploys the new commit.

# Deploying Mol

Two pieces: the **API** (FastAPI, Docker) on Render and the **web app** (Next.js) on Vercel. About 15 minutes.

## 0. Push to GitHub

```bash
git add -A && git commit -m "Mol: AI drug-cell simulator"
gh repo create mol --public --source=. --push
```

`.env` is git-ignored, so keys stay local. Check with `git check-ignore .env`.

## 1. API on Render

1. In Render, choose **New → Blueprint** and pick the repo. It reads [`render.yaml`](../render.yaml): a Docker web service built from `api/`.
2. When prompted, paste the secrets: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `ELASTIC_URL`, `ELASTIC_API_KEY`, `CARTESIA_API_KEY` and, optionally, `NVIDIA_API_KEY` and `BRIGHTDATA_API_KEY`.
3. Leave `ALLOWED_ORIGINS` empty for now. You fill it in after step 2.
4. Wait for the deploy, then check `https://<your-api>.onrender.com/health`, which should return `{"ok":true}`.

Any Docker host works the same way (Fly.io, Railway, Vultr). Build from `api/`, expose port `$PORT` (default 8000), and set the same env vars.

**Plan:** use a paid instance, not the free one. Free Render instances sleep after inactivity, and the first request then takes about a minute to wake up, which is bad during judging.

## 2. Web app on Vercel

1. In Vercel, choose **Add New → Project**, import the repo, and set the **Root Directory** to `web`. [`web/vercel.json`](../web/vercel.json) pins the pnpm version.
2. Add the env var `NEXT_PUBLIC_API_URL=https://<your-api>.onrender.com` (no trailing slash).
3. Deploy.
4. Back in Render, set `ALLOWED_ORIGINS=https://<your-app>.vercel.app` (comma-separate it with the custom domain later) and redeploy the API.

## 3. Custom domain (GoDaddy track)

1. Register the domain on GoDaddy.
2. In Vercel, go to **Settings → Domains**, add it, and create the DNS records Vercel shows in GoDaddy's DNS panel (an A record for the apex and/or a CNAME for `www`).
3. Add the domain to `ALLOWED_ORIGINS` on Render.

## 4. Before judging

- Open every preset once on the deployed site. Saved debates replay instantly, and live runs take 1–3 minutes.
- Confirm narration plays. Browsers need one click on the page before audio can autoplay.
- Have the demo video ready as a backup in case the venue Wi-Fi fails.

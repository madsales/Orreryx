# Orrery — Vercel Deployment

## Project structure
```
orrery-vercel/
├── index.html        ← Your app (all-in-one)
├── api/
│   └── anthropic.js  ← Serverless proxy for Anthropic API
├── vercel.json       ← Vercel routing config
└── README.md
```

## Deploy to Vercel (5 minutes)

### Step 1 — Upload to GitHub
1. Create a new GitHub repo (public or private)
2. Upload all files in this folder (keep the folder structure)
3. Commit

### Step 2 — Import to Vercel
1. Go to vercel.com → Log in with GitHub
2. Click **Add New → Project**
3. Select your GitHub repo → click **Import**
4. Leave all settings as default → click **Deploy**
5. Your site is live at `https://your-project.vercel.app` 🎉

### Step 3 — Add your Anthropic API key
1. In Vercel dashboard → your project → **Settings → Environment Variables**
2. Add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: `sk-ant-api03-...` (your key from console.anthropic.com)
3. Click **Save** → then **Redeploy** (Deployments tab → the 3-dot menu → Redeploy)

### Step 4 — Connect your custom domain
1. Vercel dashboard → your project → **Settings → Domains**
2. Type your domain (e.g. `orrery.io`) → click **Add**
3. Vercel shows you DNS records to add — go to your registrar's DNS panel and add them:
   - Type: **A**, Host: **@**, Value: `76.76.21.21`
   - Type: **CNAME**, Host: **www**, Value: `cname.vercel-dns.com`
4. Wait 5–30 min for DNS to propagate
5. Vercel auto-issues HTTPS certificate ✓

## Optional — Twelve Data live prices
Enter your Twelve Data API key in the setup wizard when the app loads.
Get a free key at twelvedata.com (800 credits/day free tier).

## Notes
- The Anthropic API key lives only in Vercel's environment — never in the browser
- The `/api/anthropic` proxy forwards requests server-side, avoiding CORS issues
- All other app data is simulated locally in the browser (no database needed)

Deploy these files at the repo root.

Required Vercel env vars:
- PESAPAL_ENV=sandbox or live
- PESAPAL_CONSUMER_KEY
- PESAPAL_CONSUMER_SECRET
- PESAPAL_IPN_ID
- PESAPAL_HOST=https://orreryx.io
- REDIS_URL
- ANTHROPIC_API_KEY

Routes:
/ -> home.html
/login -> login.html
/success -> success.html
/app -> app.html

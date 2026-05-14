# Realtime Translation

Tablet-first Japanese-to-Korean meeting interpretation web app using OpenAI Realtime Translation.

## Local Development

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Create `.env` from `.env.example` and set `OPENAI_API_KEY` plus `APP_ACCESS_CODE`.

3. Run both services:

   ```powershell
   npm run dev
   ```

4. Open the web app:

   ```text
   http://localhost:5173
   ```

## Docker

For a production-shaped local run:

```powershell
docker compose up --build
```

The API service owns `OPENAI_API_KEY`. Do not expose the standard API key to the browser. In production, serve the app over HTTPS because browsers require a secure context for reliable microphone and WebRTC access.

## Cloudflare Pages

Production needs these Variables and Secrets:

- Secret: `OPENAI_API_KEY`
- Secret: `APP_ACCESS_CODE`
- Text: `OPENAI_REALTIME_TRANSLATION_MODEL=gpt-realtime-translate`
- Text: `SOURCE_LANGUAGE=ja`
- Text: `TARGET_LANGUAGE=ko`
- Text: `SESSION_MAX_MINUTES=60`
- Optional text: `ALLOWED_CLIENT_IPS=company.public.ip.address`

The app will not mint translation sessions unless the browser sends the configured access code. Keep `APP_ACCESS_CODE` private and rotate it if it is shared outside the company.

## MVP Scope

- Face-to-face meeting translation only.
- Japanese source speech to Korean translated audio and captions.
- No transcript persistence by default.
- No video meeting integration in the first version.

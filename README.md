# Morgan Connect

> **Pre-release. Do not run this exposed to the internet.**

Morgan Connect is a self-hosted, open-source AI agent for a small team or family: one shared assistant on Telegram (and later other channels) that works with any model, acts only when your words cover the exact action, and shows what every reply cost. It is being built in the open, milestone by milestone; nothing here is ready to use yet.

Licensed under the Apache License 2.0.

## Run it locally

You need Docker. Then:

```sh
cp .env.example .env   # on Windows: copy .env.example .env
docker compose up --build
curl localhost:3000/health
```

The last command answers `{"status":"ok","db":"17.x"}` once the app is up. Stop with `docker compose down` (add `-v` to also delete the database volume).

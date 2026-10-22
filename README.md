# pasqualefiorillo.it

Personal website source code, built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build).

## Development

Requires Node.js 24.

```sh
npm ci
npm run dev
```

## Build & test

```sh
npm run build
npm run test:e2e
```

## Deploy

Publish to Cloudflare Pages:

```sh
nvm use
make login # First time only
make deploy
```

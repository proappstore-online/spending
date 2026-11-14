# Spending

One place to see what you spend across cloud providers and subscriptions:
https://spending.proappstore.online

- **Connectors:** Cloudflare, OpenAI, Anthropic and Google Cloud. Each user connects
  their own account; the app adds up daily cost per provider and service.
- **Subscriptions:** flat costs you enter by hand (monthly or yearly).
- **Overview:** month-to-date total, projected month end, a monthly budget, a daily
  chart, and a warning when a provider's latest full day costs more than twice its
  average over the week before.

## How keys are handled

Provider keys are per-user secrets (`mcp.json` `user_secrets`): write-only, encrypted
for one user of this app, never returned to the browser. Every provider call goes
through `app.proxy`, where a rule with `--user-secret` injects the calling user's own
key. Google Cloud is the exception: it reads the user's BigQuery billing export with a
read-only Google access token held in memory.

Settings, subscriptions and cached costs live in per-user KV. The app has no shared
tables.

## Proxy rules (owner, once)

```bash
pas login --provider google
pas proxy allow https://api.cloudflare.com/client/v4/accounts/ --inject bearer --user-secret CLOUDFLARE_API_TOKEN --app spending
pas proxy allow https://api.openai.com/v1/organization/costs --inject bearer --user-secret OPENAI_ADMIN_KEY --app spending
pas proxy allow https://api.anthropic.com/v1/organizations/analytics/cost --inject header:x-api-key --user-secret ANTHROPIC_ADMIN_KEY --app spending
```

## Develop

```bash
pnpm install
pnpm dev        # sign-in only works on the deployed hostname
pnpm test       # typecheck, unit tests, template tests
pnpm build      # runs the platform compliance check first
```

Pushing to `main` deploys.

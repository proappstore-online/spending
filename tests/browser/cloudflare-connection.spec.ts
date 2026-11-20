import { test, expect, type Page } from '@playwright/test'

const OLD_ACCOUNT = 'a'.repeat(32)
const NEW_ACCOUNT = 'b'.repeat(32)
const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

// Cloudflare fixture: the account the token can read is chosen per test.
async function cloudflareFixture(page: Page) {
  const syncedAt = Date.now()
  const stored = new Map<string, unknown>([
    ['settings', { cloudflareAccountId: OLD_ACCOUNT }],
    ['costs:cloudflare', { syncedAt, rows: [{ date: day(1), service: 'D1', amount: 3, currency: 'USD' }] }],
  ])
  const state = { connected: true, readableAccount: OLD_ACCOUNT, tokens: [] as string[], accountsCalled: [] as string[], failBody: '{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}' }
  await page.route('**/.pas/auth/me', route => route.fulfill({ json: { id: 'cf-test', name: 'CF Tester', roles: [] } }))
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ body: '', contentType: 'text/css' }))
  await page.route('**/.pas/api/**', async route => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    const account = /accounts\/([0-9a-f]{32})/.exec(pathname)?.[1]
    if (pathname.includes('/proxy/')) {
      if (account) state.accountsCalled.push(account)
      if (account !== state.readableAccount) return route.fulfill({ status: 403, body: state.failBody })
      if (pathname.endsWith('/billable-usage/info')) return route.fulfill({ json: { result: { subscriptions: [{ billing_cycle_anchor_timestamp: '2026-01-01T00:00:00Z' }] } } })
      if (pathname.endsWith('/billable-usage')) return route.fulfill({ json: { result: [{ ChargePeriodStart: `${day(1)}T00:00:00Z`, BilledCost: 9, BillingCurrency: 'USD', ServiceName: 'Workers' }] } })
      return route.fulfill({ json: { result: [] } })
    }
    if (pathname.endsWith('/user-secrets')) return route.fulfill({ json: { secrets: state.connected ? [{ name: 'CLOUDFLARE_API_TOKEN' }] : [] } })
    if (pathname.includes('/user-secrets/')) {
      if (request.method() === 'PUT') state.tokens.push((request.postDataJSON() as { value: string }).value)
      state.connected = request.method() !== 'DELETE'
      return route.fulfill({ json: { ok: true } })
    }
    const key = decodeURIComponent(pathname.split('/kv/')[1] ?? '')
    if (!key) return route.fulfill({ json: {} })
    if (request.method() === 'GET') return stored.has(key) ? route.fulfill({ json: stored.get(key) }) : route.fulfill({ status: 404 })
    if (request.method() === 'DELETE') {
      stored.delete(key)
      return route.fulfill({ json: { ok: true } })
    }
    stored.set(key, request.postDataJSON())
    return route.fulfill({ json: { ok: true } })
  })
  return { state, stored, syncedAt, provider: page.getByRole('region', { name: 'Cloudflare', exact: true }) }
}

test('disconnect clears the Account ID so a new token is not saved against the old account', async ({ page }) => {
  const { state, stored, provider } = await cloudflareFixture(page)
  await page.goto('/connections')
  await provider.getByRole('button', { name: 'Disconnect' }).click()
  await expect(provider.getByRole('textbox', { name: 'Account ID' })).toHaveValue('')
  expect(stored.get('settings')).not.toHaveProperty('cloudflareAccountId')
  await page.reload()
  await expect(provider.getByRole('textbox', { name: 'Account ID' })).toHaveValue('')
  state.readableAccount = NEW_ACCOUNT
  await provider.getByRole('textbox', { name: 'Account ID' }).fill(NEW_ACCOUNT)
  await provider.getByRole('textbox', { name: 'API token' }).fill('new-token')
  await provider.getByRole('button', { name: 'Save and connect' }).click()
  await expect(provider.getByText(/^Last synced/)).toBeVisible()
  expect(new Set(state.accountsCalled)).toEqual(new Set([NEW_ACCOUNT]))
})

test('a Cloudflare 403 explains the account ID and Billing: Read instead of showing raw JSON', async ({ page }) => {
  const { state, provider } = await cloudflareFixture(page)
  state.readableAccount = NEW_ACCOUNT
  await page.goto('/connections')
  await provider.getByRole('button', { name: 'Sync now' }).click()
  const alert = provider.getByRole('alert')
  await expect(alert).toContainText('cannot read the account')
  await expect(alert).toContainText('account ID')
  await expect(alert).toContainText('Billing: Read')
  await expect(alert).not.toContainText('"errors"')
  await expect(alert).not.toContainText('api.cloudflare.com answered')
})

test('Replace token saves the new token and Account ID and resyncs without deleting cached costs', async ({ page }) => {
  const { state, stored, provider } = await cloudflareFixture(page)
  state.readableAccount = NEW_ACCOUNT
  await page.goto('/connections')
  await provider.getByRole('button', { name: 'Sync now' }).click()
  await expect(provider.getByRole('alert')).toContainText('cannot read the account')
  await provider.getByRole('button', { name: 'Replace token' }).click()
  await expect(provider.getByRole('textbox', { name: 'Account ID' })).toHaveValue(OLD_ACCOUNT)
  await provider.getByRole('textbox', { name: 'Account ID' }).fill(NEW_ACCOUNT)
  await provider.getByRole('textbox', { name: 'API token' }).fill('replacement-token')
  await provider.getByRole('button', { name: 'Save new token' }).click()
  await expect(provider.getByRole('textbox', { name: 'API token' })).toHaveCount(0)
  await expect(provider.getByRole('alert')).toHaveCount(0)
  await expect(provider.getByRole('button', { name: 'Replace token' })).toBeVisible()
  expect(state.tokens).toEqual(['replacement-token'])
  expect(stored.get('settings')).toMatchObject({ cloudflareAccountId: NEW_ACCOUNT })
  expect(stored.get('costs:cloudflare')).toMatchObject({ rows: [{ service: 'Workers' }] })
  await expect(provider.getByText('Connected', { exact: true })).toBeVisible()
})

test('Replace token can be cancelled and keeps the connection and cached costs', async ({ page }) => {
  const { state, stored, syncedAt, provider } = await cloudflareFixture(page)
  await page.goto('/connections')
  await provider.getByRole('button', { name: 'Replace token' }).click()
  await provider.getByRole('textbox', { name: 'API token' }).fill('never-saved')
  await provider.getByRole('button', { name: 'Cancel' }).click()
  await expect(provider.getByRole('textbox', { name: 'API token' })).toHaveCount(0)
  await expect(provider.getByText('Connected', { exact: true })).toBeVisible()
  expect(state.tokens).toEqual([])
  expect(stored.get('costs:cloudflare')).toMatchObject({ syncedAt })
})

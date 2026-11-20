import { test, expect, type Page } from '@playwright/test'

const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

// Cloudflare is connected; every sync goes through these proxy fixtures.
async function cloudflareFixture(page: Page, graphqlErrors = false) {
  const stored = new Map<string, unknown>([['settings', { cloudflareAccountId: 'a'.repeat(32) }]])
  await page.route('**/.pas/auth/me', route => route.fulfill({ json: { id: 'd1-test', name: 'D1 Tester', roles: [] } }))
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ body: '', contentType: 'text/css' }))
  await page.route('**/.pas/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const pathname = url.pathname
    if (pathname.endsWith('/billable-usage/info')) return route.fulfill({ json: { result: { subscriptions: [{ billing_cycle_anchor_timestamp: '2026-01-01T00:00:00Z' }] } } })
    if (pathname.endsWith('/billable-usage')) return route.fulfill({ json: { result: [{ ChargePeriodStart: `${day(1)}T00:00:00Z`, BilledCost: 3, BillingCurrency: 'USD', ServiceName: 'D1' }] } })
    if (pathname.endsWith('/d1/database')) return route.fulfill({ json: { result: [{ uuid: 'db-hiring', name: 'pas-data-hiring' }] } })
    if (pathname.endsWith('/graphql')) {
      if (graphqlErrors) return route.fulfill({ json: { data: null, errors: [{ message: 'not authorized for that account' }] } })
      const { variables } = request.postDataJSON() as { variables: { from: string; to: string } }
      const groups = [[10, 100_000_000], [2, 10_000_000]]
        .map(([ago, rowsRead]) => ({ sum: { rowsRead, rowsWritten: 1000 }, dimensions: { date: day(ago!), databaseId: 'db-hiring' } }))
        .filter(g => g.dimensions.date >= variables.from && g.dimensions.date <= variables.to)
      return route.fulfill({ json: { data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: groups }] } }, errors: null } })
    }
    if (pathname.endsWith('/user-secrets')) return route.fulfill({ json: { secrets: [{ name: 'CLOUDFLARE_API_TOKEN' }] } })
    const key = decodeURIComponent(pathname.split('/kv/')[1] ?? '')
    if (!key) return route.fulfill({ json: {} })
    if (request.method() === 'GET') return stored.has(key) ? route.fulfill({ json: stored.get(key) }) : route.fulfill({ status: 404 })
    stored.set(key, request.postDataJSON())
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto('/connections')
  await page.getByRole('region', { name: 'Cloudflare', exact: true }).getByRole('button', { name: 'Sync now' }).click()
  await expect(page.getByText(/Last synced/)).toBeVisible()
  await page.getByRole('link', { name: 'Overview' }).first().click()
  return page.getByRole('region', { name: 'Cloudflare D1 by database' })
}

test('D1 usage per database shows rows read and the drop against the week before', async ({ page }) => {
  const card = await cloudflareFixture(page)
  const row = card.getByRole('row', { name: /pas-data-hiring/ })
  await expect(row).toContainText('10M')
  await expect(row).toContainText('-90%')
})

test('a D1 analytics failure is shown on the card and does not fail the cost sync', async ({ page }) => {
  const card = await cloudflareFixture(page, true)
  await expect(card.getByRole('alert')).toContainText('not authorized for that account')
  await expect(page.getByText('Cloudflare did not sync')).toHaveCount(0)
})

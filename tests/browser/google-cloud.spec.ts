import { test, expect } from '@playwright/test'

const OWN_ORIGINS = /^https:\/\/(cloudresourcemanager|cloudbilling|billingbudgets|serviceusage|compute|run|storage|sqladmin|firestore|bigquery|monitoring)\.googleapis\.com\//

// Local fixtures: a stubbed Google Identity Services script and stubbed Google Cloud APIs.
test('Google Cloud section asks for the wider scope only when opened, then shows the inventory', async ({ page }) => {
  const kvWrites: string[] = []
  const scopes: string[] = []
  const apiCalls: string[] = []
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('**/.pas/auth/me', route => route.fulfill({ json: { id: 'gcp-test', name: 'Cloud Tester', roles: [] } }))
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ body: '', contentType: 'text/css' }))
  await page.route('**/.pas/api/**', async route => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname.endsWith('/user-secrets')) return route.fulfill({ json: { secrets: [] } })
    const key = decodeURIComponent(pathname.split('/kv/')[1] ?? '')
    if (!key) return route.fulfill({ json: {} })
    if (request.method() === 'GET') return route.fulfill({ status: 404 })
    kvWrites.push(key)
    return route.fulfill({ json: { ok: true } })
  })
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({
    contentType: 'text/javascript',
    body: `window.google = { accounts: { oauth2: { initTokenClient: (c) => ({ requestAccessToken: () => { window.__scopes = (window.__scopes || []).concat(c.scope); c.callback({ access_token: 'fixture-token', expires_in: 3600 }) } }) } } }`,
  }))
  await page.route(OWN_ORIGINS, route => {
    const url = new URL(route.request().url())
    apiCalls.push(url.hostname)
    expect(route.request().headers().authorization).toBe('Bearer fixture-token')
    if (url.hostname === 'cloudresourcemanager.googleapis.com') {
      return route.fulfill({ json: { projects: [
        { projectId: 'shop-prod', name: 'Shop', projectNumber: '111', lifecycleState: 'ACTIVE', createTime: '2024-01-01T00:00:00Z' },
        { projectId: 'old-sandbox', name: 'old-sandbox', projectNumber: '222', lifecycleState: 'ACTIVE', createTime: '2022-01-01T00:00:00Z' },
      ] } })
    }
    if (url.pathname === '/v1/billingAccounts') return route.fulfill({ json: { billingAccounts: [{ name: 'billingAccounts/AAA-111', displayName: 'Main billing', open: true }] } })
    if (url.pathname.endsWith('/billingInfo')) {
      const linked = url.pathname.includes('shop-prod')
      return route.fulfill({ json: linked ? { projectId: 'shop-prod', billingAccountName: 'billingAccounts/AAA-111', billingEnabled: true } : { projectId: 'old-sandbox', billingEnabled: false } })
    }
    if (url.hostname === 'billingbudgets.googleapis.com') {
      return route.fulfill({ json: { budgets: [{ name: 'b1', displayName: 'Shop monthly', budgetFilter: { projects: ['projects/111'] }, amount: { specifiedAmount: { currencyCode: 'USD', units: '100' } }, thresholdRules: [{ thresholdPercent: 0.5 }] }] } })
    }
    if (url.hostname === 'serviceusage.googleapis.com' && url.pathname.includes('shop-prod')) {
      return route.fulfill({ json: { services: [{ name: 'projects/111/services/run.googleapis.com', config: { name: 'run.googleapis.com', title: 'Cloud Run Admin API' } }] } })
    }
    if (url.hostname === 'firestore.googleapis.com' && url.pathname.includes('shop-prod')) {
      return route.fulfill({ json: { databases: [{ name: 'projects/shop-prod/databases/(default)', locationId: 'nam5', type: 'FIRESTORE_NATIVE' }] } })
    }
    if (url.hostname === 'monitoring.googleapis.com' && url.pathname.includes('shop-prod') && url.search.includes('read_count')) {
      return route.fulfill({ json: { timeSeries: [{ resource: { labels: {} }, points: [{ interval: { endTime: '2026-01-01T00:00:00Z' }, value: { int64Value: '42' } }] }] } })
    }
    return route.fulfill({ status: 403, body: 'not enabled' })
  })

  await page.goto('/')
  expect(await page.evaluate(() => (window as unknown as { google?: unknown }).google)).toBeUndefined()

  const nav = page.getByRole('banner').getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link')).toHaveCount(4)
  await nav.getByRole('link', { name: 'Google Cloud', exact: true }).click()
  await expect(page).toHaveURL(/\/gcp$/)
  await expect(page.getByText('Connect Google Cloud', { exact: true })).toBeVisible()
  expect(apiCalls).toEqual([])

  await page.getByRole('button', { name: 'Sign in with Google', exact: true }).click()
  const sub = page.getByRole('navigation', { name: 'Google Cloud' })
  await expect(sub.getByRole('link')).toHaveCount(10)
  expect(await page.evaluate(() => (window as unknown as { __scopes: string[] }).__scopes)).toEqual([
    'https://www.googleapis.com/auth/cloud-platform.read-only https://www.googleapis.com/auth/bigquery.readonly',
  ])
  await expect(sub.getByRole('link', { name: 'Projects', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link', { name: 'Google Cloud', exact: true })).toHaveAttribute('aria-current', 'page')
  const main = page.getByRole('main')
  await expect(main.getByText('shop-prod', { exact: true })).toBeVisible()
  await expect(main.getByText('old-sandbox').first()).toBeVisible()

  await sub.getByRole('link', { name: 'Billing accounts' }).click()
  await expect(page).toHaveURL(/\/gcp\/billing$/)
  await expect(main.getByText('Main billing').first()).toBeVisible()
  await sub.getByRole('link', { name: 'Budgets vs Actual' }).click()
  await expect(main.getByText('Shop monthly').first()).toBeVisible()
  await sub.getByRole('link', { name: 'APIs', exact: true }).click()
  await expect(main.getByText('run.googleapis.com', { exact: true }).first()).toBeVisible()
  await sub.getByRole('link', { name: 'Firestore', exact: true }).click()
  await expect(main.getByText('nam5').first()).toBeVisible()
  await sub.getByRole('link', { name: 'Idle', exact: true }).click()
  await expect(main.getByText('old-sandbox').first()).toBeVisible()
  await sub.getByRole('link', { name: 'Live', exact: true }).click()
  await expect(main.getByRole('heading', { name: /live/i }).first()).toBeVisible()
  await sub.getByRole('link', { name: 'Issues', exact: true }).click()
  await expect(main.getByText('Likely idle project').first()).toBeVisible()
  await sub.getByRole('link', { name: 'Errors', exact: true }).click()
  await sub.getByRole('link', { name: 'Resources', exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  // Leaving and returning keeps the in-memory token and data: no second sign-in.
  await nav.getByRole('link', { name: 'Overview', exact: true }).click()
  await nav.getByRole('link', { name: 'Google Cloud', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Google Cloud' })).toBeVisible()

  await page.getByRole('button', { name: 'Disconnect Google', exact: true }).click()
  await expect(page.getByText('Connect Google Cloud', { exact: true })).toBeVisible()

  // The inventory is fetched live: nothing from it is written to KV.
  expect(kvWrites.filter(key => /gcp|cloud|inventory/i.test(key))).toEqual([])
  expect(pageErrors).toEqual([])
})

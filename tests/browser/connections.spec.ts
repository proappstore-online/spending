import { test, expect, type Page } from '@playwright/test'

async function providerFixture(page: Page, connected = false) {
  const syncedAt = Date.now()
  const stored = new Map<string, unknown>([
    ['costs:openai', { syncedAt, rows: [{ date: new Date().toISOString().slice(0, 10), service: 'API', amount: 12, currency: 'USD' }] }],
  ])
  const state = {
    connected,
    failProvider: false,
    failCache: false,
    failDisconnect: false,
    pause: null as Promise<void> | null,
    calls: 0,
    cacheWrites: 0,
    stored,
    syncedAt,
  }
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('**/.pas/auth/me', route => route.fulfill({ json: { id: 'provider-test', name: 'Provider Tester', roles: [] } }))
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ body: '', contentType: 'text/css' }))
  await page.route('**/.pas/api/**', async route => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname.includes('/proxy/')) {
      state.calls++
      if (state.pause) await state.pause
      if (state.failProvider) return route.fulfill({ status: 503, body: 'Provider unavailable' })
      return route.fulfill({ json: { data: [{ start_time: Math.floor(Date.now() / 1000), results: [{ amount: { value: 25, currency: 'usd' }, line_item: 'API' }] }] } })
    }
    if (pathname.endsWith('/user-secrets')) return route.fulfill({ json: { secrets: state.connected ? [{ name: 'OPENAI_ADMIN_KEY' }] : [] } })
    if (pathname.includes('/user-secrets/')) {
      if (request.method() === 'DELETE' && state.failDisconnect) return route.fulfill({ status: 503, body: 'Could not remove key' })
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
    if (key === 'costs:openai') {
      state.cacheWrites++
      if (state.failCache) return route.fulfill({ status: 503, body: 'Storage unavailable' })
    }
    stored.set(key, request.postDataJSON())
    return route.fulfill({ json: { ok: true } })
  })
  return { state, pageErrors, provider: page.getByRole('region', { name: 'OpenAI', exact: true }) }
}

test('failed sync preserves successful costs and timestamp, and retry persists fresh costs', async ({ page }) => {
  const { state, pageErrors, provider } = await providerFixture(page, true)
  await page.goto('/connections')
  await expect(provider.getByText('Connected', { exact: true })).toBeVisible()
  const lastSynced = await provider.getByText(/^Last synced/).innerText()
  state.failProvider = true
  await provider.getByRole('button', { name: 'Sync now' }).click()
  await expect(provider.getByRole('alert')).toContainText('Provider unavailable')
  await expect(provider.getByText(/^Last synced/)).toContainText(lastSynced)
  expect(state.stored.get('costs:openai')).toMatchObject({ syncedAt: state.syncedAt, rows: [{ amount: 12 }] })
  expect(state.cacheWrites).toBe(1)

  await page.getByRole('link', { name: 'Overview', exact: true }).click()
  await expect(page.getByText('Usage $12.00, subscriptions $0.00', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Connections', exact: true }).click()
  state.failProvider = false
  state.failCache = true
  await provider.getByRole('button', { name: 'Sync now' }).click()
  await expect(provider.getByRole('alert')).toContainText('Could not save the latest costs')
  expect(state.stored.get('costs:openai')).toMatchObject({ rows: [{ amount: 12 }] })
  state.failCache = false
  await provider.getByRole('button', { name: 'Sync now' }).click()
  await expect(provider.getByRole('alert')).toHaveCount(0)
  expect(state.stored.get('costs:openai')).toMatchObject({ rows: [{ amount: 25 }] })
  await page.reload()
  await expect(provider.getByRole('button', { name: 'Sync now' })).toBeVisible()
  expect(state.calls).toBe(3)
  expect(state.cacheWrites).toBe(3)
  expect(pageErrors).toEqual([])
})

test('failed initial sync reports saved connection without a false success, and disconnect can retry', async ({ page }) => {
  const { state, pageErrors, provider } = await providerFixture(page)
  state.stored.delete('costs:openai')
  state.failProvider = true
  await page.goto('/connections')
  await provider.getByRole('textbox', { name: 'Admin key' }).fill('fixture-key')
  await provider.getByRole('button', { name: 'Save and connect' }).click()
  await expect(provider.getByText('Connected', { exact: true })).toBeVisible()
  await expect(provider.getByText('Not synced yet.')).toBeVisible()
  await expect(provider.getByRole('alert').filter({ hasText: 'Connection saved' })).toBeVisible()
  await expect(page.getByText('OpenAI connected and synced.', { exact: true })).toHaveCount(0)
  state.failDisconnect = true
  await provider.getByRole('button', { name: 'Disconnect' }).click()
  await expect(provider.getByRole('alert').filter({ hasText: 'Could not remove key' })).toBeVisible()
  await expect(provider.getByText('Connected', { exact: true })).toBeVisible()
  state.failDisconnect = false
  await provider.getByRole('button', { name: 'Disconnect' }).click()
  await expect(provider.getByRole('textbox', { name: 'Admin key' })).toHaveValue('')
  expect(state.stored.has('costs:openai')).toBe(false)
  await page.reload()
  await expect(provider.getByText('Not connected', { exact: true })).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('pending sync disables disconnect and cannot write costs after private screens unmount', async ({ page }) => {
  const { state, pageErrors, provider } = await providerFixture(page, true)
  let release!: () => void
  state.pause = new Promise<void>(resolve => { release = resolve })
  await page.goto('/connections')
  await provider.getByRole('button', { name: 'Sync now' }).click()
  await expect(provider.getByRole('button', { name: 'Disconnect' })).toBeDisabled()
  await expect.poll(() => state.calls).toBe(1)
  await page.getByRole('button', { name: 'Open profile', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
  release()
  // A subsequent load must still show the previous cache, not the abandoned sync.
  await page.getByRole('link', { name: 'Overview', exact: true }).click()
  await expect(page.getByText('Usage $12.00, subscriptions $0.00', { exact: true })).toBeVisible()
  expect(state.cacheWrites).toBe(0)
  expect(pageErrors).toEqual([])
})

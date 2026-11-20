import { test, expect } from '@playwright/test'

// Local fixtures exercise private screens without a live PAS session or provider keys.
test('subscriptions and budget persist, while failed writes preserve saved data and drafts', async ({ page }) => {
  const stored = new Map<string, unknown>()
  let failWrites = false
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('**/.pas/auth/me', route => route.fulfill({ json: { id: 'spending-test', name: 'Spending Tester', roles: [] } }))
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ body: '', contentType: 'text/css' }))
  await page.route('**/.pas/api/**', async route => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname.endsWith('/user-secrets')) return route.fulfill({ json: { secrets: [] } })
    const key = decodeURIComponent(pathname.split('/kv/')[1] ?? '')
    if (!key) return route.fulfill({ json: {} })
    if (request.method() === 'GET') {
      return stored.has(key) ? route.fulfill({ json: stored.get(key) }) : route.fulfill({ status: 404 })
    }
    if (failWrites) return route.fulfill({ status: 503, body: 'Storage unavailable' })
    stored.set(key, request.postDataJSON())
    return route.fulfill({ json: { ok: true } })
  })

  await page.goto('/subscriptions')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Domain')
  await page.getByRole('spinbutton', { name: 'Amount', exact: true }).fill('24')
  await page.getByRole('combobox', { name: 'Billed' }).selectOption('yearly')
  failWrites = true
  await page.getByRole('button', { name: 'Add subscription', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not save')
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Domain')
  await expect(page.getByRole('button', { name: 'Edit Domain', exact: true })).toHaveCount(0)
  failWrites = false
  await page.getByRole('button', { name: 'Add subscription', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit Domain', exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Edit Domain', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Amount', exact: true }).fill('36')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('main').getByRole('listitem').filter({ hasText: 'Domain' })).toContainText('$36.00 / year')
  await page.getByRole('button', { name: 'Edit Domain', exact: true }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Unsaved name')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit Domain', exact: true })).toBeVisible()
  failWrites = true
  await page.getByRole('button', { name: 'Remove Domain', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not remove')
  await expect(page.getByRole('button', { name: 'Remove Domain', exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Overview', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Monthly budget' }).fill('100')
  await page.getByRole('button', { name: 'Save budget', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not save your budget')
  await expect(page.getByRole('spinbutton', { name: 'Monthly budget' })).toHaveValue('100')
  failWrites = false
  await page.getByRole('button', { name: 'Save budget', exact: true }).click()
  await expect(page.getByText('3% used', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('3% used', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Change', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Monthly budget' }).fill('500')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByText('3% used', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Subscriptions', exact: true }).click()
  await expect(page.getByRole('main').getByRole('listitem').filter({ hasText: 'Domain' })).toContainText('$36.00 / year')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Remove Domain', exact: true }).click()
  await expect(page.getByText('No subscriptions yet', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('No subscriptions yet', { exact: true })).toBeVisible()
  expect(pageErrors).toEqual([])
})

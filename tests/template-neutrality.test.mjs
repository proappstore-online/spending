import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(resolve(root, path), 'utf8')

test('the starter uses independently branded shell controls', () => {
  const app = read('web/src/App.tsx')

  assert.match(app, /<AppShell app=\{app\} appName="Spending" nav=\{NAV\} branding="app" access="local"/)
  assert.doesNotMatch(app, /Built for ProAppStore|href="https:\/\/proappstore\.online"/)
})

test('the starter uses AppShell, not the deprecated ProShell alias', () => {
  const app = read('web/src/App.tsx')

  assert.match(app, /AppShell/)
  assert.ok(!app.includes('<ProShell'))
  assert.ok(app.includes('branding="app"'))
})

test('the installed SDK keeps ProShell as the same component as AppShell', async () => {
  const sdk = await import(pathToFileURL(resolve(root, 'web/node_modules/@proappstore/sdk/dist/index.js')).href)

  assert.equal(typeof sdk.AppShell, 'function')
  assert.equal(sdk.ProShell, sdk.AppShell)
})

test('public metadata and manifest carry the app name, not the platform', () => {
  const html = read('web/index.html')
  const vite = read('web/vite.config.ts')

  assert.match(html, /<title>Spending<\/title>/)
  assert.doesNotMatch(html, /ProAppStore/)
  assert.match(vite, /name: 'Spending'/)
  assert.doesNotMatch(vite, /ProAppStore/)
})

test('compliance does not require a public platform link', () => {
  const workflow = read('.github/workflows/compliance.yml')

  assert.doesNotMatch(workflow, /ProAppStore link/)
  assert.doesNotMatch(workflow, /grep -r "proappstore\.online" web\/src/)
})

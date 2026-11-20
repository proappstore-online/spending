import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'

// #6: a deploy must reach installed PWAs within one reload. build-marker.json is
// precached, so the page reads it through the service worker: it only changes if
// the new worker took over.
test.use({ serviceWorkers: 'allow' })
test.skip(({ isMobile }) => isMobile, 'service worker behaviour does not depend on the viewport')

const web = resolve(__dirname, '../../web')
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webmanifest': 'application/manifest+json' }

function build(root: string, name: string, marker: string): string {
  const publicDir = join(root, `public-${name}`)
  cpSync(join(web, 'public'), publicDir, { recursive: true })
  writeFileSync(join(publicDir, 'build-marker.json'), JSON.stringify({ build: marker }))
  const config = join(web, `vite.update-${name}.config.ts`)
  writeFileSync(config, `import { mergeConfig } from 'vite'\nimport base from './vite.config'\nexport default mergeConfig(base, { publicDir: ${JSON.stringify(publicDir)} })\n`)
  const out = join(root, `dist-${name}`)
  try {
    execFileSync('pnpm', ['exec', 'vite', 'build', '--config', config, '--outDir', out, '--emptyOutDir'], { cwd: web, stdio: 'pipe' })
  } finally {
    rmSync(config, { force: true })
  }
  return out
}

test('a new deploy replaces the old service worker and its precache within one reload', async ({ page }) => {
  test.setTimeout(120000)
  const root = mkdtempSync(join(tmpdir(), 'spending-sw-'))
  let server: Server | undefined
  try {
    const dirs = { A: build(root, 'a', 'A'), B: build(root, 'b', 'B') }
    expect(readFileSync(join(dirs.A, 'sw.js'), 'utf8')).not.toBe(readFileSync(join(dirs.B, 'sw.js'), 'utf8'))
    let live = dirs.A
    server = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname
      let file = join(live, path)
      if (!file.startsWith(live) || !existsSync(file) || !statSync(file).isFile()) file = join(live, 'index.html')
      // Like the host: the worker script is never served from the HTTP cache.
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': path === '/sw.js' ? 'no-store' : 'max-age=3600' })
      res.end(readFileSync(file))
    })
    await new Promise<void>(done => server!.listen(0, '127.0.0.1', done))
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const marker = () => page.evaluate(async () => (await (await fetch('/build-marker.json')).json() as { build: string }).build)

    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ body: '', contentType: 'text/css' }))
    await page.route('**/.pas/**', route => route.fulfill({ status: 401, json: { error: 'not signed in' } }))
    await page.goto(origin)
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
    expect(await marker()).toBe('A')

    live = dirs.B
    await page.reload() // the one reload: the browser checks sw.js and finds the new worker
    await expect.poll(marker).toBe('B')
    const state = await page.evaluate(async () => {
      const registration = (await navigator.serviceWorker.getRegistration())!
      return { waiting: Boolean(registration.waiting), installing: Boolean(registration.installing) }
    })
    expect(state).toEqual({ waiting: false, installing: false })
    await page.reload()
    expect(await marker()).toBe('B')
  } finally {
    server?.close()
    rmSync(root, { recursive: true, force: true })
  }
})

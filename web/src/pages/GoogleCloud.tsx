import { lazy, Suspense, useState, type ComponentType } from 'react'
import { useDocumentTitle } from '@proappstore/sdk'
import { Button, EmptyState, PageHeader, Spinner } from '@proappstore/sdk/ui'
import { requestGoogleCloudToken, type GoogleCloudToken } from '../lib/google'
import { useGcpData, type UseGcpDataResult } from '../lib/useGcpData'
import type { DashboardData } from '../lib/gcpTypes'

const page = (load: () => Promise<Record<string, ComponentType<{ data: DashboardData }>>>, name: string) =>
  lazy(() => load().then((m) => ({ default: m[name]! })))

export const GCP_PAGES = [
  { slug: 'projects', label: 'Projects', component: page(() => import('./gcp/Projects'), 'Projects') },
  { slug: 'billing', label: 'Billing accounts', component: page(() => import('./gcp/Billing'), 'Billing') },
  { slug: 'budgets', label: 'Budgets vs Actual', component: page(() => import('./gcp/Budgets'), 'Budgets') },
  { slug: 'apis', label: 'APIs', component: page(() => import('./gcp/Apis'), 'Apis') },
  { slug: 'resources', label: 'Resources', component: page(() => import('./gcp/Resources'), 'Resources') },
  { slug: 'idle', label: 'Idle', component: page(() => import('./gcp/Idle'), 'Idle') },
  { slug: 'firestore', label: 'Firestore', component: page(() => import('./gcp/Firestore'), 'Firestore') },
  { slug: 'live', label: 'Live', component: page(() => import('./gcp/Live'), 'Live') },
  { slug: 'issues', label: 'Issues', component: page(() => import('./gcp/Issues'), 'Issues') },
  { slug: 'errors', label: 'Errors', component: page(() => import('./gcp/Errors'), 'Errors') },
]

export const GCP_ROOT = '/gcp'

// The token lives in memory only, and is kept while the user moves between app pages.
let session: { userId: string; token: GoogleCloudToken } | null = null

export function GoogleCloud({ userId, path, onNavigate }: { userId: string; path: string; onNavigate: (href: string) => void }) {
  const [token, setToken] = useState<GoogleCloudToken | null>(() =>
    session?.userId === userId && session.token.expiresAt - 60_000 > Date.now() ? session.token : null)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = GCP_PAGES.find((p) => path === `${GCP_ROOT}/${p.slug}`) ?? GCP_PAGES[0]!
  useDocumentTitle(`${current.label} — Google Cloud — Spending`)

  async function connect() {
    setSigningIn(true)
    setError(null)
    try {
      const next = await requestGoogleCloudToken()
      session = { userId, token: next }
      setToken(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSigningIn(false)
    }
  }

  function disconnect() {
    session = null
    setToken(null)
  }

  return <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6 sm:px-6">
    <PageHeader title="Google Cloud" description="Your projects, billing, budgets, APIs, resources and live activity, read with your Google account."/>
    {!token
      ? <EmptyState title="Connect Google Cloud"
        description="Sign in with Google to read your cloud inventory. This asks for read-only access (cloud-platform.read-only and BigQuery). The token stays in this browser tab's memory and expires after an hour; nothing is saved."
        action={<>
          <Button type="button" loading={signingIn} onClick={() => void connect()}>Sign in with Google</Button>
          {error && <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
        </>}/>
      : <Inventory token={token} currentSlug={current.slug} path={path} onNavigate={onNavigate} onReauth={() => void connect()} onDisconnect={disconnect}/>}
  </div>
}

function Inventory({ token, currentSlug, onNavigate, onReauth, onDisconnect }: {
  token: GoogleCloudToken; currentSlug: string; path: string
  onNavigate: (href: string) => void; onReauth: () => void; onDisconnect: () => void
}) {
  const data = useGcpData(token)
  const Screen = GCP_PAGES.find((p) => p.slug === currentSlug)!.component
  const tokenExpired = data.errors.some((e) => /expired|expiring/i.test(e.message))
  return <>
    <nav aria-label="Google Cloud" className="-mx-1 overflow-x-auto">
      <ul className="m-0 flex min-w-max list-none gap-1 p-1">
        {GCP_PAGES.map((p) => {
          const href = `${GCP_ROOT}/${p.slug}`
          return <li key={p.slug}>
            <a href={href} aria-current={p.slug === currentSlug ? 'page' : undefined}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                event.preventDefault()
                onNavigate(href)
              }}
              className="flex min-h-11 items-center rounded-[10px] px-3 text-sm font-semibold text-[var(--muted)] no-underline aria-[current=page]:bg-[var(--line)] aria-[current=page]:text-[var(--accent)]">
              {p.label}
            </a>
          </li>
        })}
      </ul>
    </nav>
    <StatusBar data={data} onSignOut={onDisconnect}/>
    {data.phase === 'error' && <div role="alert" className="flex flex-wrap items-start gap-3 rounded-xl border border-[var(--danger)] p-4">
      <p className="min-w-0 flex-1 text-sm">
        {tokenExpired ? 'Your Google access token expired. Sign in again to reload the data.' : 'Some data could not be fetched. Open Errors for details.'}
      </p>
      {tokenExpired ? <Button type="button" variant="danger" onClick={onReauth}>Sign in again</Button> : <Button type="button" variant="secondary" onClick={data.refresh}>Retry</Button>}
    </div>}
    <Suspense fallback={<div className="flex items-center gap-2 py-8 text-sm text-[var(--muted)]"><Spinner/>Loading…</div>}>
      <Screen data={data}/>
    </Suspense>
  </>
}

function StatusBar({ data, onSignOut }: { data: UseGcpDataResult; onSignOut: () => void }) {
  const minutes = data.fetchedAt ? Math.floor((Date.now() - data.fetchedAt) / 60_000) : null
  return <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
    {data.loading && <span role="status">{data.phase}</span>}
    {!data.loading && minutes !== null && <span>Fetched {minutes < 1 ? 'just now' : `${minutes} min ago`}</span>}
    <Button type="button" size="sm" variant="secondary" onClick={data.refresh} disabled={data.loading}>{data.loading ? 'Fetching…' : 'Refresh'}</Button>
    <Button type="button" size="sm" variant="ghost" onClick={onSignOut}>Disconnect Google</Button>
  </div>
}

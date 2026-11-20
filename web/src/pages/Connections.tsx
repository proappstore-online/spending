import { useState } from 'react'
import { useToast } from '@proappstore/sdk'
import { Button, Card, Input, PageHeader } from '@proappstore/sdk/ui'
import { GCP_TABLE_RE, PROVIDERS, type Provider } from '../lib/providers'
import type { Spending } from '../lib/useSpending'

export function Connections({ spending }: { spending: Spending }) {
  return <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8 sm:px-6">
    <PageHeader title="Connections"
      description="Connect each provider with your own key. A key is stored encrypted for your account only, is never shown again, and is only ever sent to that provider."/>
    {PROVIDERS.map((provider) => <ProviderCard key={provider.id} provider={provider} spending={spending}/>)}
  </div>
}

function ProviderCard({ provider, spending }: { provider: Provider; spending: Spending }) {
  const toast = useToast()
  const { id } = provider
  const connected = spending.connected.has(id)
  const syncing = spending.syncing.has(id)
  const cost = spending.costs[id]
  const [key, setKey] = useState('')
  const [accountId, setAccountId] = useState(spending.settings.cloudflareAccountId ?? '')
  const [table, setTable] = useState(spending.settings.gcpTable ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect(event: React.FormEvent) {
    event.preventDefault()
    if (saving || syncing) return
    setSaving(true)
    setError(null)
    try {
      let synced: boolean
      if (id === 'cloudflare') await spending.saveSettings({ cloudflareAccountId: accountId.trim() })
      if (id === 'gcp') {
        if (!GCP_TABLE_RE.test(table.trim())) throw new Error('The table must look like project.dataset.table.')
        await spending.saveSettings({ gcpTable: table.trim() })
        synced = await spending.sync(id)
      } else {
        synced = await spending.saveKey(id, key.trim())
        setKey('')
      }
      if (synced) toast.show(`${provider.name} connected and synced.`, { variant: 'success' })
      else setError('Connection saved, but costs could not be synced. Check the error below and try again.')
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    if (saving || syncing) return
    setSaving(true)
    setError(null)
    try {
      await spending.disconnect(id)
      toast.show(`${provider.name} disconnected.`, { variant: 'success' })
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function refresh() {
    setError(null)
    await spending.sync(id)
  }

  return <Card>
    <section aria-label={provider.name}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{provider.name}</h2>
        <span className="text-sm" style={{ color: connected ? 'var(--success)' : 'var(--muted)' }}>{connected ? 'Connected' : 'Not connected'}</span>
      </div>
      <p className="mb-4 text-sm text-[var(--muted)]">{provider.help}</p>

      {error && <p role="alert" className="mb-3 text-sm text-[var(--danger)]">{error}</p>}
      {connected
        ? <div className="space-y-3">
          <p className="text-sm">
            {cost?.syncedAt ? `Last synced ${new Date(cost.syncedAt).toLocaleString()}.` : 'Not synced yet.'}
            {cost?.error && <span role="alert" className="block text-[var(--danger)]">{cost.error}</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={saving} loading={syncing} onClick={() => void refresh()}>Sync now</Button>
            <Button size="sm" variant="danger" disabled={syncing || saving} onClick={() => void disconnect()}>Disconnect</Button>
          </div>
        </div>
        : <form onSubmit={(event) => void connect(event)}>
          <fieldset disabled={saving || syncing} className="min-w-0 space-y-3 border-0 p-0">
            {id === 'cloudflare' && <Input label="Account ID" aria-label="Account ID" required pattern="[0-9a-f]{32}" value={accountId} onChange={(e) => setAccountId(e.target.value)}/>}
            {id === 'gcp'
              ? <Input label="Billing export table" aria-label="Billing export table" required placeholder="project.dataset.gcp_billing_export_v1_…" value={table} onChange={(e) => setTable(e.target.value)}/>
              : <Input label={provider.keyLabel} aria-label={provider.keyLabel} type="password" autoComplete="off" required value={key} onChange={(e) => setKey(e.target.value)}/>}
          <Button type="submit" size="sm" loading={saving}>{id === 'gcp' ? 'Sign in with Google and connect' : 'Save and connect'}</Button>
          </fieldset>
        </form>}
    </section>
  </Card>
}

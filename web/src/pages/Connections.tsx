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

  async function connect(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      if (id === 'cloudflare') await spending.saveSettings({ cloudflareAccountId: accountId.trim() })
      if (id === 'gcp') {
        if (!GCP_TABLE_RE.test(table.trim())) throw new Error('The table must look like project.dataset.table.')
        await spending.saveSettings({ gcpTable: table.trim() })
        await spending.sync(id)
      } else {
        await spending.saveKey(id, key.trim())
        setKey('')
      }
      toast.show(`${provider.name} connected.`, { variant: 'success' })
    } catch (error) {
      toast.show(error instanceof Error ? error.message : String(error), { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return <Card>
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-lg font-bold">{provider.name}</h2>
      <span className="text-sm" style={{ color: connected ? 'var(--success)' : 'var(--muted)' }}>{connected ? 'Connected' : 'Not connected'}</span>
    </div>
    <p className="mb-4 text-sm text-[var(--muted)]">{provider.help}</p>

    {connected
      ? <div className="space-y-3">
        <p className="text-sm">
          {cost ? `Last synced ${new Date(cost.syncedAt).toLocaleString()}.` : 'Not synced yet.'}
          {cost?.error && <span style={{ color: 'var(--danger)' }}> {cost.error}</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={syncing} onClick={() => void spending.sync(id)}>Sync now</Button>
          <Button size="sm" variant="danger" onClick={() => void spending.disconnect(id)}>Disconnect</Button>
        </div>
      </div>
      : <form className="space-y-3" onSubmit={(event) => void connect(event)}>
          {id === 'cloudflare' && <Input label="Account ID" aria-label="Account ID" required pattern="[0-9a-f]{32}" value={accountId} onChange={(e) => setAccountId(e.target.value)}/>}
          {id === 'gcp'
            ? <Input label="Billing export table" aria-label="Billing export table" required placeholder="project.dataset.gcp_billing_export_v1_…" value={table} onChange={(e) => setTable(e.target.value)}/>
            : <Input label={provider.keyLabel} aria-label={provider.keyLabel} type="password" autoComplete="off" required value={key} onChange={(e) => setKey(e.target.value)}/>}
        <Button type="submit" size="sm" loading={saving}>{id === 'gcp' ? 'Sign in with Google and connect' : 'Save and connect'}</Button>
      </form>}
  </Card>
}

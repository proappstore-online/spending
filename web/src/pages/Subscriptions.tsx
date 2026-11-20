import { useState } from 'react'
import { Button, Card, EmptyState, Input, PageHeader } from '@proappstore/sdk/ui'
import { formatMoney, formatTotals, subscriptionTotals, type Subscription } from '../lib/costs'
import type { Spending } from '../lib/useSpending'

export function Subscriptions({ spending }: { spending: Spending }) {
  const { subscriptions } = spending
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [cycle, setCycle] = useState<Subscription['cycle']>('monthly')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetForm() {
    setEditingId(null)
    setName('')
    setAmount('')
    setCurrency('USD')
    setCycle('monthly')
  }

  async function saveSubscription(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    if (!name.trim() || !Number.isFinite(Number(amount)) || Number(amount) < 0) {
      setError('Enter a name and a valid amount of zero or more.')
      return
    }
    setSaving(true)
    setError(null)
    const subscription: Subscription = {
      id: editingId ?? crypto.randomUUID(), name: name.trim(), amount: Number(amount), currency: currency.toUpperCase(), cycle,
    }
    try {
      await spending.saveSubscriptions(editingId
        ? subscriptions.map((s) => s.id === editingId ? subscription : s)
        : [...subscriptions, subscription])
      resetForm()
    } catch {
      setError('Could not save your subscription. Your changes are still here; try again.')
    } finally {
      setSaving(false)
    }
  }

  async function removeSubscription(id: string) {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await spending.saveSubscriptions(subscriptions.filter((s) => s.id !== id))
      if (editingId === id) resetForm()
    } catch {
      setError('Could not remove your subscription. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8 sm:px-6">
    <PageHeader title="Subscriptions" description="Flat costs no provider reports for you: Claude Max, ChatGPT Plus, domains, anything you pay on a schedule."/>

    <Card>
      <h2 className="mb-3 text-lg font-bold">{editingId ? 'Edit subscription' : 'Add subscription'}</h2>
      {error && <p role="alert" className="mb-3 text-sm text-[var(--danger)]">{error}</p>}
      <form onSubmit={(event) => void saveSubscription(event)}>
        <fieldset disabled={saving} className="grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-2">
          <Input label="Name" aria-label="Name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)}/>
          <Input label="Amount" aria-label="Amount" type="number" required min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)}/>
          <Input label="Currency" aria-label="Currency" required pattern="[A-Za-z]{3}" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)}/>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Billed
            <select aria-label="Billed" className="min-h-11 rounded-[10px] border border-[var(--line-strong)] bg-[var(--paper)] px-3 font-normal text-[var(--ink)]"
              value={cycle} onChange={(e) => setCycle(e.target.value as Subscription['cycle'])}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={saving}>{editingId ? 'Save changes' : 'Add subscription'}</Button>
            {editingId && <Button type="button" variant="ghost" onClick={() => { resetForm(); setError(null) }}>Cancel</Button>}
          </div>
        </fieldset>
      </form>
    </Card>

    {subscriptions.length === 0
      ? <EmptyState title="No subscriptions yet" description="Add one above and it counts toward your monthly total."/>
      : <Card>
        <p className="mb-3 text-sm text-[var(--muted)]">{formatTotals(subscriptionTotals(subscriptions))} per month in total</p>
        <ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
          {subscriptions.map((s) => <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
            <span className="min-w-0 truncate font-semibold">{s.name}</span>
            <span className="flex shrink-0 items-center gap-3 text-sm">
              {formatMoney(s.amount, s.currency)} / {s.cycle === 'yearly' ? 'year' : 'month'}
              <Button size="sm" variant="ghost" disabled={saving} aria-label={`Edit ${s.name}`} onClick={() => {
                setEditingId(s.id)
                setName(s.name)
                setAmount(String(s.amount))
                setCurrency(s.currency)
                setCycle(s.cycle)
                setError(null)
              }}>Edit</Button>
              <Button size="sm" variant="ghost" disabled={saving} aria-label={`Remove ${s.name}`}
                onClick={() => void removeSubscription(s.id)}>Remove</Button>
            </span>
          </li>)}
        </ul>
      </Card>}
  </div>
}

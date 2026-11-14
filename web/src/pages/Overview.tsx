import { useState } from 'react'
import { Button, Card, EmptyState, Input, PageHeader } from '@proappstore/sdk/ui'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  detectSpike, forecast, formatMoney, formatTotals, isoDay, monthOf, monthTotals, serviceTotals,
  subscriptionTotals, sumTotals, type ProviderId, type Totals,
} from '../lib/costs'
import { PROVIDERS, providerName } from '../lib/providers'
import type { Spending } from '../lib/useSpending'

const COLORS: Record<ProviderId, string> = {
  cloudflare: 'var(--accent)',
  openai: 'var(--mint)',
  anthropic: 'var(--warning)',
  gcp: 'var(--sky)',
}

export function Overview({ spending, onNavigate }: { spending: Spending; onNavigate: (path: string) => void }) {
  const { costs, subscriptions, connected } = spending
  const today = new Date()
  const month = monthOf(isoDay(today))
  const lastMonth = monthOf(isoDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))))
  const ids = PROVIDERS.map((p) => p.id).filter((id) => costs[id])

  if (connected.size === 0 && subscriptions.length === 0) {
    return <Page>
      <EmptyState title="Nothing to track yet"
        description="Connect Cloudflare, OpenAI, Anthropic or Google Cloud with your own key, or add a subscription you pay for."
        action={<Button onClick={() => onNavigate('/connections')}>Connect a provider</Button>}/>
    </Page>
  }

  const usage = sumTotals(...ids.map((id) => monthTotals(costs[id]!.rows, month)))
  const subs = subscriptionTotals(subscriptions)
  const total = sumTotals(usage, subs)
  const projected: Totals = { ...subs }
  for (const [currency, amount] of Object.entries(usage)) projected[currency] = (projected[currency] ?? 0) + forecast(amount, today)
  const spikes = ids.flatMap((id) => {
    const spike = detectSpike(costs[id]!.rows, today)
    return spike ? [{ id, ...spike }] : []
  })
  const errors = ids.filter((id) => costs[id]!.error)

  // Daily chart: one stacked bar per day of this month, one colour per provider.
  const chartCurrency = Object.entries(usage).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'USD'
  const days = new Map<string, Record<string, number | string>>()
  for (const id of ids) {
    for (const row of costs[id]!.rows) {
      if (monthOf(row.date) !== month || row.currency !== chartCurrency) continue
      const day = days.get(row.date) ?? { date: row.date.slice(8) }
      day[id] = ((day[id] as number | undefined) ?? 0) + row.amount
      days.set(row.date, day)
    }
  }
  const chart = [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, day]) => day)

  return <Page>
    {spikes.map((s) => <Alert key={s.id} tone="danger">
      <strong>{providerName(s.id)} spiked on {s.date}:</strong> {formatMoney(s.amount, s.currency)} in one day,
      against a {formatMoney(s.average, s.currency)} daily average over the week before.
    </Alert>)}
    {errors.map((id) => <Alert key={id} tone="warning">
      <strong>{providerName(id)} did not sync:</strong> {costs[id]!.error}
    </Alert>)}

    <div className="grid gap-4 sm:grid-cols-3">
      <Stat label="This month so far" value={formatTotals(total)} note={`Usage ${formatTotals(usage)}, subscriptions ${formatTotals(subs)}`}/>
      <Stat label="Projected month end" value={formatTotals(projected)} note="Usage at the current daily rate, plus subscriptions"/>
      <Budget spending={spending} total={total} projected={projected}/>
    </div>

    {chart.length > 0 && <Card>
      <h2 className="mb-4 text-lg font-bold">Daily usage cost ({chartCurrency})</h2>
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)"/>
            <XAxis dataKey="date" stroke="var(--muted)" fontSize={12}/>
            <YAxis stroke="var(--muted)" fontSize={12}/>
            <Tooltip formatter={(value) => formatMoney(Number(value), chartCurrency)}
              contentStyle={{ background: 'var(--paper)', border: '1px solid var(--line-strong)', color: 'var(--ink)' }}/>
            <Legend/>
            {ids.filter((id) => chart.some((day) => day[id])).map((id) =>
              <Bar key={id} dataKey={id} name={providerName(id)} stackId="cost" fill={COLORS[id]} isAnimationActive={false}/>)}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>}

    <div className="grid gap-4 md:grid-cols-2">
      {ids.map((id) => {
        const services = serviceTotals(costs[id]!.rows, month)
        return <Card key={id}>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-bold">{providerName(id)}</h2>
            <span className="text-sm text-[var(--muted)]">last month {formatTotals(monthTotals(costs[id]!.rows, lastMonth))}</span>
          </div>
          <p className="mb-3 text-2xl font-extrabold">{formatTotals(monthTotals(costs[id]!.rows, month))}</p>
          {services.length === 0
            ? <p className="text-sm text-[var(--muted)]">No cost reported this month.</p>
            : <ul className="m-0 list-none space-y-1 p-0 text-sm">
              {services.map((s) => <li key={`${s.service}${s.currency}`} className="flex justify-between gap-3">
                <span className="truncate">{s.service}</span><span>{formatMoney(s.amount, s.currency)}</span>
              </li>)}
            </ul>}
        </Card>
      })}
      {subscriptions.length > 0 && <Card>
        <h2 className="mb-3 text-lg font-bold">Subscriptions</h2>
        <p className="mb-3 text-2xl font-extrabold">{formatTotals(subs)}<span className="text-sm font-normal text-[var(--muted)]"> per month</span></p>
        <ul className="m-0 list-none space-y-1 p-0 text-sm">
          {subscriptions.map((s) => <li key={s.id} className="flex justify-between gap-3">
            <span className="truncate">{s.name}</span>
            <span>{formatMoney(s.amount, s.currency)} / {s.cycle === 'yearly' ? 'year' : 'month'}</span>
          </li>)}
        </ul>
      </Card>}
    </div>
  </Page>
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-8 sm:px-6">
    <PageHeader title="Overview" description="What you are spending this month, across every provider you connected."/>
    {children}
  </div>
}

function Alert({ tone, children }: { tone: 'danger' | 'warning'; children: React.ReactNode }) {
  return <div role="alert" className="rounded-[10px] border px-4 py-3 text-sm" style={{ borderColor: `var(--${tone})` }}>{children}</div>
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return <Card>
    <p className="text-sm text-[var(--muted)]">{label}</p>
    <p className="my-1 text-2xl font-extrabold">{value}</p>
    <p className="text-xs text-[var(--muted)]">{note}</p>
  </Card>
}

function Budget({ spending, total, projected }: { spending: Spending; total: Totals; projected: Totals }) {
  const { budget, budgetCurrency = 'USD' } = spending.settings
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState(String(budget ?? ''))
  const [currency, setCurrency] = useState(budgetCurrency)

  if (editing || !budget) {
    return <Card>
      <form className="space-y-2" onSubmit={(event) => {
        event.preventDefault()
        void spending.saveSettings({ budget: Number(amount) || undefined, budgetCurrency: currency.toUpperCase() })
        setEditing(false)
      }}>
        <Input label="Monthly budget" aria-label="Monthly budget" type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)}/>
        <Input label="Currency" aria-label="Currency" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)}/>
        <Button type="submit" size="sm">Save budget</Button>
      </form>
    </Card>
  }

  const spent = total[budgetCurrency] ?? 0
  const over = (projected[budgetCurrency] ?? 0) > budget
  return <Card>
    <p className="text-sm text-[var(--muted)]">Budget ({budgetCurrency})</p>
    <p className="my-1 text-2xl font-extrabold">{Math.round((spent / budget) * 100)}% used</p>
    <div className="h-2 overflow-hidden rounded-full bg-[var(--line)]">
      <div className="h-full" style={{ width: `${Math.min(100, (spent / budget) * 100)}%`, background: over ? 'var(--danger)' : 'var(--success)' }}/>
    </div>
    <p className="mt-2 text-xs text-[var(--muted)]">
      {formatMoney(spent, budgetCurrency)} of {formatMoney(budget, budgetCurrency)}.
      {over ? ' On course to go over.' : ' On course to stay under.'}{' '}
      <button type="button" className="underline" onClick={() => setEditing(true)}>Change</button>
    </p>
  </Card>
}

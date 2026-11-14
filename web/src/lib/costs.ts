export type ProviderId = 'cloudflare' | 'openai' | 'anthropic' | 'gcp'

/** One provider's cost for one service on one UTC day. */
export interface CostRow {
  date: string // YYYY-MM-DD
  service: string
  amount: number
  currency: string
}

export interface ProviderCosts {
  syncedAt: number
  rows: CostRow[]
  error?: string
}

export interface Subscription {
  id: string
  name: string
  amount: number
  currency: string
  cycle: 'monthly' | 'yearly'
}

export interface Settings {
  budget?: number
  budgetCurrency?: string
  cloudflareAccountId?: string
  /** BigQuery billing export table, `project.dataset.table`. */
  gcpTable?: string
}

export type Totals = Record<string, number> // currency -> amount

export const isoDay = (d: Date) => d.toISOString().slice(0, 10)
export const monthOf = (day: string) => day.slice(0, 7)

/** First day of the month before `today`: the start of every sync window. */
export function syncStart(today: Date): Date {
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
}

function add(totals: Totals, currency: string, amount: number) {
  totals[currency] = (totals[currency] ?? 0) + amount
}

/**
 * Sum duplicate (date, service, currency) rows and keep only the `maxServices`
 * largest services, folding the rest into "Other", so a provider's rows fit one
 * KV value.
 */
export function compact(rows: CostRow[], maxServices = 8): CostRow[] {
  const byService = new Map<string, number>()
  for (const r of rows) byService.set(r.service, (byService.get(r.service) ?? 0) + Math.abs(r.amount))
  const keep = new Set([...byService].sort((a, b) => b[1] - a[1]).slice(0, maxServices).map(([s]) => s))
  const merged = new Map<string, CostRow>()
  for (const r of rows) {
    const service = keep.has(r.service) ? r.service : 'Other'
    const key = `${r.date}|${service}|${r.currency}`
    const existing = merged.get(key)
    if (existing) existing.amount += r.amount
    else merged.set(key, { date: r.date, service, amount: r.amount, currency: r.currency })
  }
  return [...merged.values()]
    .map((r) => ({ ...r, amount: Math.round(r.amount * 10000) / 10000 }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.service.localeCompare(b.service))
}

export function monthTotals(rows: CostRow[], month: string): Totals {
  const totals: Totals = {}
  for (const r of rows) if (monthOf(r.date) === month) add(totals, r.currency, r.amount)
  return totals
}

export function serviceTotals(rows: CostRow[], month: string): { service: string; currency: string; amount: number }[] {
  const map = new Map<string, { service: string; currency: string; amount: number }>()
  for (const r of rows) {
    if (monthOf(r.date) !== month) continue
    const key = `${r.service}|${r.currency}`
    const entry = map.get(key) ?? { service: r.service, currency: r.currency, amount: 0 }
    entry.amount += r.amount
    map.set(key, entry)
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount)
}

/** What a subscription costs per month. */
export const monthlyAmount = (s: Subscription) => (s.cycle === 'yearly' ? s.amount / 12 : s.amount)

export function subscriptionTotals(subs: Subscription[]): Totals {
  const totals: Totals = {}
  for (const s of subs) add(totals, s.currency, monthlyAmount(s))
  return totals
}

export function sumTotals(...all: Totals[]): Totals {
  const out: Totals = {}
  for (const totals of all) for (const [currency, amount] of Object.entries(totals)) add(out, currency, amount)
  return out
}

/**
 * Projected month-end usage cost: month-to-date scaled from the days elapsed to
 * the whole month. Flat subscriptions are added by the caller, not scaled.
 */
export function forecast(monthToDate: number, today: Date): number {
  const daysInMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate()
  return (monthToDate / today.getUTCDate()) * daysInMonth
}

export interface Spike {
  date: string
  currency: string
  amount: number
  average: number
}

/**
 * A spike is the latest full day costing more than twice the average of the
 * seven days before it, and at least 1 unit of currency. Today is skipped: it
 * is still accruing.
 */
export function detectSpike(rows: CostRow[], today: Date): Spike | null {
  const todayIso = isoDay(today)
  const byDay = new Map<string, number>() // `${currency}|${date}` -> amount
  for (const r of rows) {
    if (r.date >= todayIso) continue
    const key = `${r.currency}|${r.date}`
    byDay.set(key, (byDay.get(key) ?? 0) + r.amount)
  }
  let worst: Spike | null = null
  for (const currency of new Set(rows.map((r) => r.currency))) {
    const days = [...byDay.keys()].filter((k) => k.startsWith(`${currency}|`)).map((k) => k.slice(currency.length + 1)).sort()
    const latest = days[days.length - 1]
    if (!latest) continue
    const amount = byDay.get(`${currency}|${latest}`)!
    let prior = 0
    for (let i = 1; i <= 7; i++) {
      const d = new Date(`${latest}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() - i)
      prior += byDay.get(`${currency}|${isoDay(d)}`) ?? 0
    }
    const average = prior / 7
    if (amount >= 1 && amount > 2 * average && (!worst || amount > worst.amount)) {
      worst = { date: latest, currency, amount, average }
    }
  }
  return worst
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

export function formatTotals(totals: Totals): string {
  const entries = Object.entries(totals).filter(([, amount]) => Math.abs(amount) >= 0.005)
  if (entries.length === 0) return formatMoney(0, 'USD')
  return entries.sort((a, b) => b[1] - a[1]).map(([currency, amount]) => formatMoney(amount, currency)).join(' + ')
}

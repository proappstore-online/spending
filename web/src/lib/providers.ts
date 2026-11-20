import { app } from './app'
import { isoDay, syncStart, type CostRow, type D1UsageRow, type ProviderCosts, type ProviderId, type Settings } from './costs'

export interface Provider {
  id: ProviderId
  name: string
  /** `mcp.json` user-secret name; absent for Google Cloud, which signs in with Google instead. */
  secret?: string
  keyLabel?: string
  help: string
}

export const PROVIDERS: Provider[] = [
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    secret: 'CLOUDFLARE_API_TOKEN',
    keyLabel: 'API token',
    help: 'An API token with Billing: Read, plus your account ID. Pay-as-you-go accounts only. Add Account Analytics: Read and D1: Read to see D1 usage per database.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    secret: 'OPENAI_ADMIN_KEY',
    keyLabel: 'Admin key',
    help: 'An organization admin key (sk-admin-…). A normal project key cannot read costs.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    secret: 'ANTHROPIC_ADMIN_KEY',
    keyLabel: 'Admin key',
    help: 'An organization Admin API key (sk-ant-admin…). A normal API key cannot read costs.',
  },
  {
    id: 'gcp',
    name: 'Google Cloud',
    help: 'Your BigQuery billing export table, read with your Google account (read-only).',
  },
]

export const providerName = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!.name

/** A provider call through the proxy, which injects the signed-in user's own key. */
async function proxyJson(target: string, init?: RequestInit): Promise<unknown> {
  const res = await app.proxy.fetch(target, init)
  if (res.status === 412) throw new Error('No key saved for this provider yet.')
  if (!res.ok) throw new Error(`${target.split('/')[0]} answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

// --- OpenAI: GET /v1/organization/costs, daily buckets grouped by line item ---

interface OpenAiCosts {
  data?: { start_time: number; results?: { amount?: { value?: number | string; currency?: string }; line_item?: string | null }[] }[]
  has_more?: boolean
  next_page?: string | null
}

export function parseOpenAi(json: unknown): CostRow[] {
  const rows: CostRow[] = []
  for (const bucket of (json as OpenAiCosts).data ?? []) {
    const date = isoDay(new Date(bucket.start_time * 1000))
    for (const r of bucket.results ?? []) {
      rows.push({
        date,
        service: r.line_item || 'OpenAI API',
        amount: Number(r.amount?.value ?? 0),
        currency: (r.amount?.currency ?? 'usd').toUpperCase(),
      })
    }
  }
  return rows
}

async function fetchOpenAi(since: Date): Promise<CostRow[]> {
  const rows: CostRow[] = []
  let page: string | null | undefined
  do {
    const query = new URLSearchParams({
      start_time: String(Math.floor(since.getTime() / 1000)),
      bucket_width: '1d',
      group_by: 'line_item',
      limit: '14', // the proxy caps a response at 100 KB
    })
    if (page) query.set('page', page)
    const json = (await proxyJson(`api.openai.com/v1/organization/costs?${query}`)) as OpenAiCosts
    rows.push(...parseOpenAi(json))
    page = json.has_more ? json.next_page : null
  } while (page)
  return rows
}

// --- Anthropic: GET /v1/organizations/analytics/cost, amounts in cents ---

interface AnthropicCosts {
  data?: { starting_at: string; group?: { model?: string | null; cost_type?: string | null }; cost?: { amount?: string; currency?: string } }[]
  has_more?: boolean
  next_page?: string | null
}

export function parseAnthropic(json: unknown): CostRow[] {
  return ((json as AnthropicCosts).data ?? []).map((row) => ({
    date: row.starting_at.slice(0, 10),
    service: row.group?.model || row.group?.cost_type || 'Claude API',
    amount: Number(row.cost?.amount ?? 0) / 100,
    currency: row.cost?.currency ?? 'USD',
  }))
}

async function fetchAnthropic(since: Date, today: Date): Promise<CostRow[]> {
  const rows: CostRow[] = []
  // One request spans at most 31 days, so ask month by month.
  for (let from = since; from <= today; from = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1))) {
    const monthEnd = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1))
    const tomorrow = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1))
    const to = monthEnd < tomorrow ? monthEnd : tomorrow
    let page: string | null | undefined
    do {
      const query = new URLSearchParams({
        starting_at: from.toISOString(),
        ending_at: to.toISOString(),
        time_bucket_width: '1d',
        limit: '200',
      })
      query.append('group_by[]', 'model')
      if (page) query.set('page', page)
      const json = (await proxyJson(`api.anthropic.com/v1/organizations/analytics/cost?${query}`, {
        headers: { 'anthropic-version': '2023-06-01', 'anthropic-beta': 'analytics-usage-cost-2026-08-24' },
      })) as AnthropicCosts
      rows.push(...parseAnthropic(json))
      page = json.has_more ? json.next_page : null
    } while (page)
  }
  return rows
}

// --- Cloudflare: GET /accounts/{id}/billable-usage (alpha, FOCUS-style records) ---

interface CloudflareUsage {
  result?: { ChargePeriodStart?: string; BilledCost?: number; BillingCurrency?: string; ServiceName?: string }[]
}

export function parseCloudflare(json: unknown): CostRow[] {
  return ((json as CloudflareUsage).result ?? [])
    .filter((r) => r.ChargePeriodStart)
    .map((r) => ({
      date: r.ChargePeriodStart!.slice(0, 10),
      service: r.ServiceName || 'Cloudflare',
      amount: Number(r.BilledCost ?? 0),
      currency: r.BillingCurrency ?? 'USD',
    }))
}

/** Start of the billing cycle containing `today`, and of the one before it, for a cycle that renews on `anchorDay`. */
export function billingCycles(anchorDay: number, today: Date): [Date, Date] {
  // A cycle anchored on the 31st starts on the last day of shorter months.
  const start = (monthOffset: number) => {
    const y = today.getUTCFullYear()
    const m = today.getUTCMonth() + monthOffset
    return new Date(Date.UTC(y, m, Math.min(anchorDay, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())))
  }
  const offset = start(0) <= today ? 0 : -1
  return [start(offset - 1), start(offset)]
}

async function fetchCloudflare(settings: Settings, today: Date): Promise<CostRow[]> {
  if (!settings.cloudflareAccountId) throw new Error('Add your Cloudflare account ID first.')
  const base = `api.cloudflare.com/client/v4/accounts/${settings.cloudflareAccountId}/billable-usage`
  const info = (await proxyJson(`${base}/info`)) as { result?: { subscriptions?: { billing_cycle_anchor_timestamp?: string }[] } }
  const anchor = info.result?.subscriptions?.[0]?.billing_cycle_anchor_timestamp
  if (!anchor) throw new Error('This Cloudflare account has no pay-as-you-go subscription to report.')
  // Cloudflare only returns usage from a cycle's first day onwards, so each
  // request covers one whole cycle: the previous one, then the current one.
  const [previous, current] = billingCycles(new Date(anchor).getUTCDate(), today)
  const tomorrow = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1))
  const rows: CostRow[] = []
  for (const [from, to] of [[previous, current], [current, tomorrow]] as const) {
    rows.push(...parseCloudflare(await proxyJson(`${base}?from=${isoDay(from)}&to=${isoDay(to)}`)))
  }
  return rows
}

// --- Cloudflare D1 per database: GraphQL analytics, which the bill does not break down ---

interface D1Analytics {
  data?: { viewer?: { accounts?: { d1AnalyticsAdaptiveGroups?: { sum: { rowsRead: number; rowsWritten: number }; dimensions: { date: string; databaseId: string } }[] }[] } }
  errors?: { message: string }[] | null
}

export function parseD1Analytics(json: unknown, names: Map<string, string>): D1UsageRow[] {
  const { data, errors } = json as D1Analytics
  if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '))
  return (data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups ?? []).map(({ sum, dimensions }) => ({
    date: dimensions.date,
    database: names.get(dimensions.databaseId) ?? dimensions.databaseId,
    rowsRead: sum.rowsRead,
    rowsWritten: sum.rowsWritten,
  }))
}

const D1_QUERY = `query ($account: string!, $from: Date!, $to: Date!) {
  viewer { accounts(filter: { accountTag: $account }) {
    d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: $from, date_leq: $to }, orderBy: [date_ASC]) {
      sum { rowsRead rowsWritten }
      dimensions { date databaseId }
    }
  } }
}`

/** D1 rows read and written per database per day since the start of last month. Never throws: a failure is `d1Error`. */
export async function fetchD1Usage(settings: Settings, today = new Date()): Promise<Pick<ProviderCosts, 'd1' | 'd1Error'>> {
  const account = settings.cloudflareAccountId
  try {
    const names = new Map<string, string>()
    for (let page = 1; ; page++) {
      const json = (await proxyJson(`api.cloudflare.com/client/v4/accounts/${account}/d1/database?per_page=100&page=${page}`)) as { result?: { uuid: string; name: string }[] }
      for (const db of json.result ?? []) names.set(db.uuid, db.name)
      if ((json.result?.length ?? 0) < 100) break
    }
    const rows: D1UsageRow[] = []
    // One calendar month per query keeps each request inside the dataset's time-range limit.
    const thisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
    const lastDayOfLastMonth = new Date(thisMonth.getTime() - 86400000)
    for (const [from, to] of [[syncStart(today), lastDayOfLastMonth], [thisMonth, today]] as const) {
      rows.push(...parseD1Analytics(await proxyJson('api.cloudflare.com/client/v4/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: D1_QUERY, variables: { account, from: isoDay(from), to: isoDay(to) } }),
      }), names))
    }
    return { d1: rows }
  } catch (error) {
    return { d1Error: error instanceof Error ? error.message : String(error) }
  }
}

// --- Google Cloud: BigQuery billing export, read with the user's Google token ---

export const GCP_TABLE_RE = /^[a-z][a-z0-9-]{4,29}\.[A-Za-z0-9_]{1,1024}\.[A-Za-z0-9_]{1,1024}$/

interface BigQueryResult {
  rows?: { f: { v: string | null }[] }[]
}

export function parseBigQuery(json: unknown): CostRow[] {
  return ((json as BigQueryResult).rows ?? []).map(({ f }) => ({
    date: f[0]!.v ?? '',
    service: f[1]!.v || 'Google Cloud',
    amount: Number(f[2]!.v ?? 0),
    currency: f[3]!.v ?? 'USD',
  }))
}

async function fetchGcp(settings: Settings, since: Date, googleToken: string | null): Promise<CostRow[]> {
  const table = settings.gcpTable
  // The table name goes into SQL, so it must be exactly project.dataset.table.
  if (!table || !GCP_TABLE_RE.test(table)) throw new Error('Add your BigQuery billing export table first.')
  if (!googleToken) throw new Error('Sign in with Google to read your billing export.')
  const sql = `
    SELECT CAST(DATE(usage_start_time) AS STRING) AS day, service.description AS service,
           SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS net, currency
    FROM \`${table}\`
    WHERE _PARTITIONTIME >= TIMESTAMP('${isoDay(since)}') AND DATE(usage_start_time) >= '${isoDay(since)}'
    GROUP BY day, service, currency
    HAVING ABS(net) > 0.0001`
  const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${table.split('.')[0]}/queries`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 60000, maxResults: 10000 }),
  })
  if (!res.ok) throw new Error(`BigQuery answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return parseBigQuery(await res.json())
}

/** Every cost row a provider reports from the start of last month until now. */
export function fetchCosts(id: ProviderId, settings: Settings, googleToken: string | null, today = new Date()): Promise<CostRow[]> {
  const since = syncStart(today)
  switch (id) {
    case 'openai': return fetchOpenAi(since)
    case 'anthropic': return fetchAnthropic(since, today)
    case 'cloudflare': return fetchCloudflare(settings, today)
    case 'gcp': return fetchGcp(settings, since, googleToken)
  }
}

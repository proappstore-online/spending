import { describe, expect, it } from 'vitest'
import {
  compact, compactD1, d1ListCost, d1Summary, detectSpike, forecast, monthTotals, subscriptionTotals, sumTotals, syncStart, type CostRow,
} from './costs'
import { billingCycles, GCP_TABLE_RE, parseAnthropic, parseD1Analytics, parseBigQuery, parseCloudflare, parseOpenAi } from './providers'

const row = (date: string, amount: number, service = 'api', currency = 'USD'): CostRow => ({ date, service, amount, currency })

describe('compact', () => {
  it('sums duplicates and folds small services into Other', () => {
    const rows = [row('2026-11-01', 5, 'a'), row('2026-11-01', 5, 'a'), row('2026-11-01', 1, 'b'), row('2026-11-01', 2, 'c')]
    expect(compact(rows, 2)).toEqual([row('2026-11-01', 10, 'a'), row('2026-11-01', 2, 'c'), row('2026-11-01', 1, 'Other')].sort((x, y) => x.service.localeCompare(y.service)))
  })
})

describe('totals', () => {
  it('keeps currencies apart and counts only the asked month', () => {
    const rows = [row('2026-11-02', 3), row('2026-11-03', 4, 'api', 'AUD'), row('2026-10-30', 100)]
    expect(monthTotals(rows, '2026-11')).toEqual({ USD: 3, AUD: 4 })
  })

  it('counts a yearly subscription as a twelfth per month', () => {
    const totals = subscriptionTotals([
      { id: '1', name: 'Claude Max', amount: 100, currency: 'USD', cycle: 'monthly' },
      { id: '2', name: 'Domain', amount: 24, currency: 'USD', cycle: 'yearly' },
    ])
    expect(sumTotals(totals, { USD: 1 })).toEqual({ USD: 103 })
  })

  it('projects month-to-date usage over the whole month', () => {
    expect(forecast(10, new Date('2026-11-10T12:00:00Z'))).toBe(30)
  })

  it('starts the sync window on the first day of last month', () => {
    expect(syncStart(new Date('2026-01-14T00:00:00Z')).toISOString()).toBe('2025-12-01T00:00:00.000Z')
  })
})

describe('detectSpike', () => {
  const today = new Date('2026-11-14T08:00:00Z')
  const week = ['06', '07', '08', '09', '10', '11', '12'].map((d) => row(`2026-11-${d}`, 2))

  it('flags a latest full day above twice the weekly average', () => {
    expect(detectSpike([...week, row('2026-11-13', 9)], today)).toEqual({ date: '2026-11-13', currency: 'USD', amount: 9, average: 2 })
  })

  it('ignores a normal day, a tiny amount, and today', () => {
    expect(detectSpike([...week, row('2026-11-13', 3)], today)).toBeNull()
    expect(detectSpike([row('2026-11-13', 0.5)], today)).toBeNull()
    expect(detectSpike([...week, row('2026-11-13', 2), row('2026-11-14', 50)], today)).toBeNull()
  })
})

describe('provider parsers', () => {
  it('reads OpenAI daily cost buckets', () => {
    const json = { data: [{ start_time: 1794528000, results: [{ amount: { value: 1.5, currency: 'usd' }, line_item: 'gpt-5' }] }] }
    expect(parseOpenAi(json)).toEqual([row('2026-11-13', 1.5, 'gpt-5')])
  })

  it('converts Anthropic cents to dollars', () => {
    const json = { data: [{ starting_at: '2026-11-13T00:00:00Z', group: { model: 'claude-opus' }, cost: { amount: '41280.000000', currency: 'USD' } }] }
    expect(parseAnthropic(json)).toEqual([row('2026-11-13', 412.8, 'claude-opus')])
  })

  it('reads Cloudflare billable-usage records', () => {
    const json = { result: [{ ChargePeriodStart: '2026-11-13T00:00:00Z', BilledCost: 0.75, BillingCurrency: 'USD', ServiceName: 'D1' }] }
    expect(parseCloudflare(json)).toEqual([row('2026-11-13', 0.75, 'D1')])
  })

  it('finds the current and previous Cloudflare billing cycles', () => {
    const iso = (dates: Date[]) => dates.map((d) => d.toISOString().slice(0, 10))
    expect(iso(billingCycles(23, new Date('2026-11-14T08:00:00Z')))).toEqual(['2026-09-23', '2026-10-23'])
    expect(iso(billingCycles(23, new Date('2026-11-23T00:00:00Z')))).toEqual(['2026-10-23', '2026-11-23'])
    expect(iso(billingCycles(31, new Date('2026-03-05T00:00:00Z')))).toEqual(['2026-01-31', '2026-02-28'])
  })

  it('reads BigQuery rows', () => {
    const json = { rows: [{ f: [{ v: '2026-11-13' }, { v: 'Cloud Run' }, { v: '2.25' }, { v: 'AUD' }] }] }
    expect(parseBigQuery(json)).toEqual([row('2026-11-13', 2.25, 'Cloud Run', 'AUD')])
  })

  it('accepts only a plain project.dataset.table name', () => {
    expect(GCP_TABLE_RE.test('my-project.billing.gcp_billing_export_v1_0123AB')).toBe(true)
    expect(GCP_TABLE_RE.test('my-project.billing.t` WHERE 1=1 --')).toBe(false)
  })
})

describe('D1 by database', () => {
  const today = new Date('2026-11-21T08:00:00Z')
  const d1 = (date: string, rowsRead: number, rowsWritten = 0, database = 'pas-data-hiring') => ({ date, database, rowsRead, rowsWritten })

  it('names databases from the list and fails on GraphQL errors', () => {
    const json = { data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [
      { sum: { rowsRead: 5, rowsWritten: 1 }, dimensions: { date: '2026-11-20', databaseId: 'a' } },
      { sum: { rowsRead: 2, rowsWritten: 0 }, dimensions: { date: '2026-11-20', databaseId: 'b' } },
    ] }] } }, errors: null }
    expect(parseD1Analytics(json, new Map([['a', 'pas-data-hiring']]))).toEqual([
      d1('2026-11-20', 5, 1), d1('2026-11-20', 2, 0, 'b'),
    ])
    expect(() => parseD1Analytics({ errors: [{ message: 'not authorized' }] }, new Map())).toThrow('not authorized')
  })

  it('prices rows at list price', () => {
    expect(d1ListCost(2_000_000_000, 3_000_000)).toBeCloseTo(5)
  })

  it('sums this month and compares the last full week with the one before, skipping today', () => {
    const [hiring] = d1Summary([
      d1('2026-10-31', 999), // last month: weeks only
      d1('2026-11-07', 100), d1('2026-11-13', 100), // prior 7 days (7th–13th)
      d1('2026-11-14', 10, 2), d1('2026-11-20', 10), // last 7 days (14th–20th)
      d1('2026-11-21', 1000), // today, still accruing
    ], today)
    expect(hiring).toMatchObject({ rowsRead: 1220, rowsWritten: 2, last7: 20, prior7: 200 })
  })

  it('compacts to what the summary reads, with the same summary, and fits one KV value', () => {
    const rows = []
    for (let db = 0; db < 60; db++) {
      for (let n = 0; n < 52; n++) {
        const date = new Date(today)
        date.setUTCDate(date.getUTCDate() - n)
        rows.push(d1(date.toISOString().slice(0, 10), 1_000_000 * (db + 1) + n, db, `pas-data-app-number-${db}`))
      }
    }
    const compacted = compactD1(rows, today)
    expect(JSON.stringify(compacted).length).toBeLessThan(40 * 1024)
    const full = d1Summary(rows, today)
    const small = d1Summary(compacted, today)
    expect(small.filter((s) => s.database !== 'Other')).toEqual(full.slice(0, 15))
    const other = small.find((s) => s.database === 'Other')!
    expect(other.rowsRead).toBe(full.slice(15).reduce((sum, s) => sum + s.rowsRead, 0))
    expect(other.last7).toBe(full.slice(15).reduce((sum, s) => sum + s.last7, 0))
  })

  it('orders databases by cost and drops ones with no usage', () => {
    const list = d1Summary([d1('2026-11-20', 1, 0, 'small'), d1('2026-11-20', 0, 5, 'writes'), d1('2026-11-20', 0, 0, 'idle')], today)
    expect(list.map((d) => d.database)).toEqual(['writes', 'small'])
  })
})

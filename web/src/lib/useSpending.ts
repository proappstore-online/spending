import { useCallback, useEffect, useRef, useState } from 'react'
import { app } from './app'
import { compact, type ProviderCosts, type ProviderId, type Settings, type Subscription } from './costs'
import { fetchCosts, fetchD1Usage, PROVIDERS } from './providers'
import { requestGoogleToken } from './google'

const STALE_MS = 6 * 60 * 60 * 1000

export interface Spending {
  loading: boolean
  /** Set when the user's data could not be loaded at all. */
  loadError: string | null
  settings: Settings
  subscriptions: Subscription[]
  costs: Partial<Record<ProviderId, ProviderCosts>>
  /** Providers the user has connected (a saved key, or a billing table for Google Cloud). */
  connected: Set<ProviderId>
  syncing: Set<ProviderId>
  saveSettings(patch: Settings): Promise<void>
  saveSubscriptions(subs: Subscription[]): Promise<void>
  saveKey(id: ProviderId, value: string): Promise<boolean>
  disconnect(id: ProviderId): Promise<void>
  sync(id: ProviderId): Promise<boolean>
}

/** The signed-in user's spending data. Everything is per-user: KV for data, user secrets for keys. */
export function useSpending(userId: string | undefined): Spending {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>({})
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [costs, setCosts] = useState<Spending['costs']>({})
  const [secretNames, setSecretNames] = useState<Set<string>>(new Set())
  const [syncing, setSyncing] = useState<Set<ProviderId>>(new Set())
  const settingsRef = useRef(settings)
  const costsRef = useRef<Spending['costs']>({})
  const lifecycle = useRef(0)
  const active = useRef(false)
  const inFlight = useRef(new Map<ProviderId, Promise<boolean>>())
  const googleToken = useRef<string | null>(null)

  const connected = new Set<ProviderId>(
    PROVIDERS.filter((p) => (p.secret ? secretNames.has(p.secret) : Boolean(settings.gcpTable))).map((p) => p.id),
  )

  const sync = useCallback((id: ProviderId): Promise<boolean> => {
    if (!active.current) return Promise.resolve(false)
    const pending = inFlight.current.get(id)
    if (pending) return pending
    const version = lifecycle.current
    setSyncing((s) => new Set(s).add(id))
    const task = (async () => {
      let result: ProviderCosts
      try {
        if (id === 'gcp' && !googleToken.current) googleToken.current = await requestGoogleToken()
        if (version !== lifecycle.current) return false
        result = { syncedAt: Date.now(), rows: compact(await fetchCosts(id, settingsRef.current, googleToken.current)) }
        if (id === 'cloudflare') {
          const d1 = await fetchD1Usage(settingsRef.current)
          // A failed D1 read keeps the last good per-database rows, like a failed cost sync.
          result = { ...result, d1: d1.d1 ?? costsRef.current.cloudflare?.d1, d1Error: d1.d1Error }
        }
      } catch (error) {
        if (version !== lifecycle.current) return false
        if (id === 'gcp') googleToken.current = null
        // Keep the last successful rows and timestamp, even when that result was empty.
        result = {
          ...(costsRef.current[id] ?? { syncedAt: 0, rows: [] }),
          error: error instanceof Error ? error.message : String(error),
        }
      }
      if (version !== lifecycle.current) return false
      try {
        await app.kv.set(`costs:${id}`, result)
      } catch {
        result = { ...result, error: [result.error, 'Could not save the latest costs. Try syncing again.'].filter(Boolean).join(' ') }
      }
      if (version !== lifecycle.current) return false
      costsRef.current = { ...costsRef.current, [id]: result }
      setCosts(costsRef.current)
      return !result.error
    })().finally(() => {
      if (version !== lifecycle.current) return
      inFlight.current.delete(id)
      setSyncing((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
    })
    inFlight.current.set(id, task)
    return task
  }, [])

  useEffect(() => {
    if (!userId) return
    active.current = true
    const version = ++lifecycle.current
    let cancelled = false
    void (async () => {
      const [stored, secrets] = await Promise.all([
        app.kv.getMany<unknown>(['settings', 'subscriptions', ...PROVIDERS.map((p) => `costs:${p.id}`)]),
        app.userSecrets.list(),
      ])
      if (cancelled) return
      const loadedSettings = (stored.get('settings') as Settings | undefined) ?? {}
      const loadedCosts: Spending['costs'] = {}
      const names = new Set(secrets.map((s) => s.name))
      for (const p of PROVIDERS) {
        const c = stored.get(`costs:${p.id}`) as ProviderCosts | undefined
        if (c && (p.secret ? names.has(p.secret) : loadedSettings.gcpTable)) loadedCosts[p.id] = c
      }
      costsRef.current = loadedCosts
      settingsRef.current = loadedSettings
      setSettings(loadedSettings)
      setSubscriptions((stored.get('subscriptions') as Subscription[] | undefined) ?? [])
      setCosts(loadedCosts)
      setSecretNames(names)
      setLoading(false)
      // Refresh key-based providers in the background. Google Cloud needs a
      // sign-in popup, so it only syncs when the user asks.
      for (const p of PROVIDERS) {
        if (p.secret && names.has(p.secret) && Date.now() - (loadedCosts[p.id]?.syncedAt ?? 0) > STALE_MS) void sync(p.id)
      }
    })().catch((error: unknown) => {
      if (cancelled) return
      setLoadError(error instanceof Error ? error.message : String(error))
      setLoading(false)
    })
    return () => {
      cancelled = true
      active.current = false
      if (lifecycle.current === version) lifecycle.current++
    }
  }, [userId, sync])

  const saveSettings = useCallback(async (patch: Settings) => {
    if (!active.current) return
    const version = lifecycle.current
    const next = { ...settingsRef.current, ...patch }
    await app.kv.set('settings', next)
    if (version !== lifecycle.current) return
    settingsRef.current = next
    setSettings(next)
  }, [])

  const saveSubscriptions = useCallback(async (subs: Subscription[]) => {
    if (!active.current) return
    const version = lifecycle.current
    await app.kv.set('subscriptions', subs)
    if (version !== lifecycle.current) return
    setSubscriptions(subs)
  }, [])

  const saveKey = useCallback(async (id: ProviderId, value: string) => {
    if (!active.current) return false
    const version = lifecycle.current
    const secret = PROVIDERS.find((p) => p.id === id)!.secret!
    await app.userSecrets.set(secret, value)
    if (version !== lifecycle.current) return false
    setSecretNames((names) => new Set(names).add(secret))
    return sync(id)
  }, [sync])

  const disconnect = useCallback(async (id: ProviderId) => {
    if (!active.current) return
    if (inFlight.current.has(id)) throw new Error('Wait for the current sync to finish before disconnecting.')
    const version = lifecycle.current
    const secret = PROVIDERS.find((p) => p.id === id)!.secret
    if (secret) {
      await app.userSecrets.delete(secret)
      if (version !== lifecycle.current) return
      setSecretNames((names) => {
        const next = new Set(names)
        next.delete(secret)
        return next
      })
    } else {
      googleToken.current = null
      await saveSettings({ gcpTable: undefined })
    }
    if (version !== lifecycle.current) return
    const { [id]: _removed, ...rest } = costsRef.current
    costsRef.current = rest
    setCosts(rest)
    try {
      await app.kv.delete(`costs:${id}`)
    } catch {
      throw new Error('Disconnected, but cached costs could not be removed. Reconnect and sync to refresh them.')
    }
  }, [saveSettings])

  return { loading, loadError, settings, subscriptions, costs, connected, syncing, saveSettings, saveSubscriptions, saveKey, disconnect, sync }
}

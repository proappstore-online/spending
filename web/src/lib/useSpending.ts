import { useCallback, useEffect, useRef, useState } from 'react'
import { app } from './app'
import { compact, type ProviderCosts, type ProviderId, type Settings, type Subscription } from './costs'
import { fetchCosts, PROVIDERS } from './providers'
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
  saveKey(id: ProviderId, value: string): Promise<void>
  disconnect(id: ProviderId): Promise<void>
  sync(id: ProviderId): Promise<void>
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
  settingsRef.current = settings
  const googleToken = useRef<string | null>(null)

  const connected = new Set<ProviderId>(
    PROVIDERS.filter((p) => (p.secret ? secretNames.has(p.secret) : Boolean(settings.gcpTable))).map((p) => p.id),
  )

  const sync = useCallback(async (id: ProviderId) => {
    setSyncing((s) => new Set(s).add(id))
    let result: ProviderCosts
    try {
      if (id === 'gcp' && !googleToken.current) googleToken.current = await requestGoogleToken()
      result = { syncedAt: Date.now(), rows: compact(await fetchCosts(id, settingsRef.current, googleToken.current)) }
    } catch (error) {
      if (id === 'gcp') googleToken.current = null
      result = { syncedAt: Date.now(), rows: [], error: error instanceof Error ? error.message : String(error) }
    }
    // A failed sync keeps the last good rows on screen and only records the error.
    setCosts((all) => {
      const next = result.error && all[id]?.rows.length ? { ...all[id]!, error: result.error } : result
      void app.kv.set(`costs:${id}`, next)
      return { ...all, [id]: next }
    })
    setSyncing((s) => {
      const next = new Set(s)
      next.delete(id)
      return next
    })
  }, [])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void (async () => {
      const [stored, secrets] = await Promise.all([
        app.kv.getMany<unknown>(['settings', 'subscriptions', ...PROVIDERS.map((p) => `costs:${p.id}`)]),
        app.userSecrets.list(),
      ])
      if (cancelled) return
      const loadedSettings = (stored.get('settings') as Settings | undefined) ?? {}
      const loadedCosts: Spending['costs'] = {}
      for (const p of PROVIDERS) {
        const c = stored.get(`costs:${p.id}`) as ProviderCosts | undefined
        if (c) loadedCosts[p.id] = c
      }
      const names = new Set(secrets.map((s) => s.name))
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
    }
  }, [userId, sync])

  const saveSettings = useCallback(async (patch: Settings) => {
    const next = { ...settingsRef.current, ...patch }
    settingsRef.current = next
    setSettings(next)
    await app.kv.set('settings', next)
  }, [])

  const saveSubscriptions = useCallback(async (subs: Subscription[]) => {
    setSubscriptions(subs)
    await app.kv.set('subscriptions', subs)
  }, [])

  const saveKey = useCallback(async (id: ProviderId, value: string) => {
    const secret = PROVIDERS.find((p) => p.id === id)!.secret!
    await app.userSecrets.set(secret, value)
    setSecretNames((names) => new Set(names).add(secret))
    await sync(id)
  }, [sync])

  const disconnect = useCallback(async (id: ProviderId) => {
    const secret = PROVIDERS.find((p) => p.id === id)!.secret
    if (secret) {
      await app.userSecrets.delete(secret)
      setSecretNames((names) => {
        const next = new Set(names)
        next.delete(secret)
        return next
      })
    } else {
      googleToken.current = null
      await saveSettings({ gcpTable: undefined })
    }
    await app.kv.delete(`costs:${id}`)
    setCosts(({ [id]: _removed, ...rest }) => rest)
  }, [saveSettings])

  return { loading, loadError, settings, subscriptions, costs, connected, syncing, saveSettings, saveSubscriptions, saveKey, disconnect, sync }
}

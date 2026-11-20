import { useEffect, useState } from 'react'
import { AppShell, useAuth, type NavItem } from '@proappstore/sdk'
import { Card, EmptyState, PageHeader, ProProfilePage, SignInButtons, Spinner, TextSizeToggle, ThemeToggle } from '@proappstore/sdk/ui'
import { AppTopbar, IconNavigation, NavigationIcon } from './AppNavigation'
import { app } from './lib/app'
import { useSpending } from './lib/useSpending'
import { Connections } from './pages/Connections'
import { Overview } from './pages/Overview'
import { Subscriptions } from './pages/Subscriptions'

// Keep Profile in NAV for page titles; its visible navigation target is the avatar.
// Give each primary screen an icon. Labels remain accessible on mobile and visible on desktop.
const NAV: NavItem[] = [
  { label: 'Overview', href: '/', title: 'Spending', icon: <NavigationIcon path="M4 20V10m6 10V4m6 16v-7m4 7H2"/> },
  { label: 'Connections', href: '/connections', title: 'Connections — Spending', icon: <NavigationIcon path="M9 7H7a5 5 0 0 0 0 10h2m6-10h2a5 5 0 0 1 0 10h-2M8 12h8"/> },
  { label: 'Subscriptions', href: '/subscriptions', title: 'Subscriptions — Spending', icon: <NavigationIcon path="M3 7h18v10H3V7Zm0 4h18M7 15h3"/> },
  { label: 'Profile', href: '/profile', title: 'Profile — Spending' },
]

function navigate(path: string) {
  history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function App() {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const changed = () => setPath(location.pathname)
    window.addEventListener('popstate', changed)
    return () => window.removeEventListener('popstate', changed)
  }, [])
  return <AppShell app={app} appName="Spending" nav={NAV} branding="app" access="local"
    renderNav={context => <IconNavigation {...context}/>}
    renderLocalTopbar={context => <AppTopbar {...context} currentPath={path} onNavigate={navigate}/>}
    onNavigate={navigate}>
    <Screens path={path}/>
  </AppShell>
}

function Screens({ path }: { path: string }) {
  const { user } = useAuth()
  if (path === '/profile') return <Profile/>
  if (!user) {
    return <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <PageHeader title="Spending" description="See what you spend on Cloudflare, OpenAI, Anthropic, Google Cloud and your subscriptions in one place."/>
      <EmptyState title="Sign in to start" description="Your keys and costs are private to your account." action={<SignInButtons app={app}/>}/>
    </div>
  }
  return <SpendingScreens key={user.id} userId={user.id} path={path}/>
}

function SpendingScreens({ userId, path }: { userId: string; path: string }) {
  const spending = useSpending(userId)
  if (spending.loading) return <div className="flex justify-center py-20"><Spinner/></div>
  if (spending.loadError) return <div className="mx-auto w-full max-w-3xl px-6 py-10"><EmptyState title="Could not load your data" description={spending.loadError}/></div>
  if (path === '/connections') return <Connections spending={spending}/>
  if (path === '/subscriptions') return <Subscriptions spending={spending}/>
  return <Overview spending={spending} onNavigate={navigate}/>
}

function Profile() {
  const { user } = useAuth()
  return <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-10">
    <PageHeader title="Profile" description="Your account and preferences."/>
    <Card><h2 className="mb-4 text-lg font-bold">Appearance</h2><div className="flex flex-wrap items-center gap-4"><ThemeToggle/><TextSizeToggle/></div></Card>
    <Card>{user ? <ProProfilePage app={app} showThemeToggle={false}/> : <><h2 className="mb-3 text-lg font-bold">Sign in</h2><p className="mb-4 text-sm text-[var(--muted)]">Use your account to access private app features.</p><SignInButtons app={app}/></>}</Card>
  </div>
}

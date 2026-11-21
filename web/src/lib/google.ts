/**
 * Google sign-in for the Google Cloud connector: read-only access tokens from
 * Google Identity Services, held in memory only. The cost sync asks for BigQuery
 * alone; the wider cloud-platform scope is asked for only when the user opens
 * the Google Cloud section.
 */
// An OAuth client ID is a public identifier. The shared deploy pipeline passes no
// build variables, so it lives here.
const CLIENT_ID = '983257337319-i4lqshucshea3vugsa5si4dvjr0eoqds.apps.googleusercontent.com'
const BIGQUERY_SCOPE = 'https://www.googleapis.com/auth/bigquery.readonly'
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform.read-only'

export interface GoogleCloudToken {
  accessToken: string
  expiresAt: number
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string
            scope: string
            callback: (response: TokenResponse) => void
            error_callback?: (error: { message?: string; type: string }) => void
          }): { requestAccessToken(): void }
        }
      }
    }
  }
}

/** Google Identity Services, loaded the first time the user connects Google Cloud. */
let gis: Promise<void> | undefined
function loadGis(): Promise<void> {
  gis ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.onload = () => resolve()
    script.onerror = () => {
      gis = undefined
      reject(new Error('Google sign-in could not be loaded.'))
    }
    document.head.append(script)
  })
  return gis
}

async function requestToken(scope: string): Promise<GoogleCloudToken> {
  await loadGis()
  return new Promise((resolve, reject) => {
    window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope,
      callback: (response) =>
        response.access_token
          ? resolve({ accessToken: response.access_token, expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000 })
          : reject(new Error(response.error_description ?? response.error ?? 'Google sign-in failed.')),
      error_callback: (error) => reject(new Error(error.message ?? error.type)),
    }).requestAccessToken()
  })
}

export async function requestGoogleToken(): Promise<string> {
  return (await requestToken(BIGQUERY_SCOPE)).accessToken
}

/** For the Google Cloud section: inventory, budgets and monitoring, plus BigQuery for actual spend. */
export function requestGoogleCloudToken(): Promise<GoogleCloudToken> {
  return requestToken(`${CLOUD_PLATFORM_SCOPE} ${BIGQUERY_SCOPE}`)
}

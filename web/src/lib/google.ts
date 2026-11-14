/**
 * Google sign-in for the Google Cloud connector: a read-only BigQuery access
 * token from Google Identity Services, held in memory only.
 */
// An OAuth client ID is a public identifier. The shared deploy pipeline passes no
// build variables, so it lives here.
const CLIENT_ID = '983257337319-i4lqshucshea3vugsa5si4dvjr0eoqds.apps.googleusercontent.com'
const SCOPE = 'https://www.googleapis.com/auth/bigquery.readonly'

interface TokenResponse {
  access_token?: string
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

export async function requestGoogleToken(): Promise<string> {
  await loadGis()
  return new Promise((resolve, reject) => {
    window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (response) =>
        response.access_token
          ? resolve(response.access_token)
          : reject(new Error(response.error_description ?? response.error ?? 'Google sign-in failed.')),
      error_callback: (error) => reject(new Error(error.message ?? error.type)),
    }).requestAccessToken()
  })
}

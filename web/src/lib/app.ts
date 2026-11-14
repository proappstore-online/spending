import { initPro } from '@proappstore/sdk'

export const app = initPro({
  appId: 'spending',
  authMode: 'platform-cookie',
  monitoring: { build: { sha: import.meta.env.VITE_COMMIT_SHA } },
})

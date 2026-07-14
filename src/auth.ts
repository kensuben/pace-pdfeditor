import { PublicClientApplication, type AccountInfo } from '@azure/msal-browser'

const clientId = import.meta.env.VITE_MICROSOFT_CLIENT_ID?.trim()
const tenantId = import.meta.env.VITE_MICROSOFT_TENANT_ID?.trim() || 'common'
const redirectUri = `${window.location.origin}/redirect.html`

export const isMicrosoftAuthConfigured = Boolean(clientId)

export const msal = clientId ? new PublicClientApplication({
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: { cacheLocation: 'sessionStorage' },
}) : null

export async function initializeAuth(): Promise<AccountInfo | null> {
  if (!msal) return null
  await msal.initialize()
  const response = await msal.handleRedirectPromise()
  const account = response?.account || msal.getActiveAccount() || msal.getAllAccounts()[0] || null
  if (account) msal.setActiveAccount(account)
  return account
}

export async function signInMicrosoft(): Promise<AccountInfo> {
  if (!msal) throw new Error('Microsoft login has not been configured.')
  const response = await msal.loginPopup({ scopes: ['openid', 'profile', 'email'], prompt: 'select_account', redirectUri })
  msal.setActiveAccount(response.account)
  return response.account
}

export async function signOutMicrosoft() {
  if (!msal) return
  const account = msal.getActiveAccount()
  await msal.logoutPopup({ account, postLogoutRedirectUri: window.location.origin })
}


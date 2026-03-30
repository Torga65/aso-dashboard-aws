/**
 * IMS Configuration — ASO Dashboard
 *
 * Client configuration for Adobe IMS authentication using the
 * authorization_code + PKCE flow with a dedicated public client.
 *
 * The client must be registered in IMSS as a public client (no client_secret).
 * PKCE (code_verifier / code_challenge) replaces the secret.
 */

/**
 * IMS client ID — registered in IMSS for this dashboard.
 * Replace with your actual client ID once registered.
 */
export const IMS_CLIENT_ID = '307b29831bd0423e9f2c720545df2251';

/**
 * IMS scopes required by this app.
 * - openid: standard OpenID Connect
 * - AdobeID: Adobe Identity
 * - read_organizations: list orgs the user belongs to
 * - account_cluster.read: org discovery (e.g. for SpaceCat/LLMO auth/orgs)
 */
export const IMS_SCOPES = 'openid,AdobeID,read_organizations,account_cluster.read,additional_info.roles,additional_info.projectedProductContext';

/**
 * Determine IMS environment.
 *
 * Defaults to 'prod'. Override via `?ims_env=stg1` in the URL for staging.
 * @returns {'prod'|'stg1'}
 */
export function getIMSEnvironment() {
  const params = new URLSearchParams(window.location.search);
  const override = params.get('ims_env');
  if (override === 'stg1' || override === 'stage') return 'stg1';
  return 'prod';
}

/**
 * IMS base URL for the given environment.
 * @param {'prod'|'stg1'} [env] - defaults to current environment
 * @returns {string}
 */
export function getIMSBaseURL(env) {
  const e = env || getIMSEnvironment();
  return e === 'stg1'
    ? 'https://ims-na1-stg1.adobelogin.com'
    : 'https://ims-na1.adobelogin.com';
}

/**
 * Build the redirect URI for the current origin.
 * Must match one of the URIs registered in IMSS.
 * @returns {string}
 */
export function getRedirectURI() {
  return `${window.location.origin}/ims/callback`;
}

/**
 * Session storage key for the auth state blob.
 */
export const STORAGE_KEY = 'aso_ims_auth';

/**
 * Session storage key for the PKCE code verifier (transient, used during auth flow).
 */
export const PKCE_VERIFIER_KEY = 'aso_pkce_verifier';

/**
 * When true, append puser=adobe.com to the authorize URL to restrict sign-in to
 * Adobe employees (requires IDOPS/IMS configuration to allow this).
 * @type {boolean}
 */
export const IMS_ADOBE_ONLY = true;

/**
 * Site IDs for "CJA Dashboard Customers" portfolio filter.
 * Matches asoboard-main SITE_IDS_IN_PRODUCTION (CJA dashboard scope).
 * Format: { siteId, baseURL } — baseURL is for reference only; API uses siteId.
 */
export const CJA_DASHBOARD_SITES = [
  { siteId: '5d0f5df8-953f-4c24-9d4e-6e48384e75cf', baseURL: 'https://bhgfinancial.com' },
  { siteId: '9b12429a-60ed-4e3b-9719-978b1c9d8397', baseURL: 'https://breville.com' },
  { siteId: '9c25d632-420a-432e-8a82-555ba90879dd', baseURL: 'https://celestyal.com' },
  { siteId: 'b3e56f22-a071-4c17-b653-3800ce932593', baseURL: 'https://continental-pneumatici.it' },
  { siteId: '1bab12d6-7491-4145-b54a-e022639d6932', baseURL: 'https://conti.com.br' },
  { siteId: '768a8908-a713-4a53-bfcb-27307aa5af24', baseURL: 'https://cox.com' },
  { siteId: '1ac131eb-9841-460e-ae93-bee066711ec7', baseURL: 'https://krisshop.com' },
  { siteId: '7b8f919a-162d-41bb-9869-ef4c7ad057e7', baseURL: 'https://micron.com' },
  { siteId: 'e5835fee-3187-4ab2-a14f-1e9c98b6cae2', baseURL: 'https://okta.com' },
  { siteId: '92d24fa2-5e99-4d43-8799-84cba3385ae1', baseURL: 'https://qualcomm.com' },
  { siteId: 'f6208fb0-dde8-4b5e-8556-6b274c52f7e3', baseURL: 'https://recordedfuture.com' },
  { siteId: 'f63e23c2-7e5d-4ac5-81e1-b21e51727d5f', baseURL: 'https://metrobyt-mobile.com' },
  { siteId: '275d1b4e-4ff4-4330-b8ab-ca2003df10c5', baseURL: 'https://twilio.com' },
  { siteId: 'ca0314e5-43fa-41e2-a947-08c7a3a33256', baseURL: 'https://unilever.com' },
  { siteId: '8f34399d-4442-4545-ad6c-1060980107fb', baseURL: 'https://sunstargum.com' },
  { siteId: '14220f09-7bdd-4c91-9adf-adcbe0adf1df', baseURL: 'https://westjet.com' },
  { siteId: '6c8523d3-f4a8-4ba4-bba5-f14008eb0e13', baseURL: 'https://provider.humana.com' },
  { siteId: 'd8db1956-b24c-4ad7-bdb6-6f5a90d89edc', baseURL: 'https://business.adobe.com' },
  { siteId: '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3', baseURL: 'https://adobe.com' },
  { siteId: 'cc31e47f-91ee-46d6-999a-4afbc0325339', baseURL: 'https://blog.adobe.com' },
  { siteId: '620fbc50-59e3-4027-a915-980ed57a6ee7', baseURL: 'https://hello-tech.com' },
  { siteId: '3dc4b29f-b423-4d8e-9f62-9199f0d7598f', baseURL: 'https://myastrazeneca.co.uk' },
  { siteId: '0983c6da-0dee-45cc-b897-3f1fed6b460b', baseURL: 'https://hersheyland.com' },
  { siteId: 'e12c091c-075b-4c94-aab7-398a04412b5c', baseURL: 'https://chocolateworld.com' },
  { siteId: 'f02e7334-4bf8-4a9c-baad-4c9cdd259fba', baseURL: 'https://nrma.com.au' },
  { siteId: 'c69a0115-7a37-4955-b247-9fa174ba8a1f', baseURL: 'https://collectables.auspost.com.au' },
  { siteId: 'b061dde0-1d9a-47dc-a192-749282aa6eba', baseURL: 'https://vonage.com' },
  { siteId: '7668a35f-f8fe-4962-92e4-d0d93be57cac', baseURL: 'https://redtag.ca' },
  { siteId: '07234604-f5e0-4a9c-9ad5-ff2037e5eba5', baseURL: 'https://ups.com' },
  { siteId: '90abcb83-bbfb-4bbd-8313-a0adc2986ce2', baseURL: 'https://insureshield.com' },
  { siteId: 'b26912fa-5892-4d9c-8d11-56d9f0d1650d', baseURL: 'https://parcelpro.com' },
];

/** Comma-separated site IDs for API query param. */
export function getCJADashboardSiteIds() {
  return CJA_DASHBOARD_SITES.map((s) => s.siteId).join(',');
}

/**
 * Site IDs for "ASO Customers Only" portfolio filter.
 * Fixed list (was previously IMS org IDs, now site IDs for simpler API calls).
 * Format: { siteId, baseURL } — baseURL is for reference only; API uses siteId.
 */
export const ASO_PORTFOLIO_SITES = [
  { siteId: 'c135763a-a046-4c86-b9cc-a2fcc0da0c0e', baseURL: 'https://corporate.walmart.com' },
  { siteId: '9cafd810-8b03-4a91-a171-7e18c6c43afc', baseURL: 'https://one.walmart.com' },
  { siteId: '8c483072-584c-4cd2-9f3f-d5478a69540c', baseURL: 'https://phonepeethics.com' },
  { siteId: 'e5835fee-3187-4ab2-a14f-1e9c98b6cae2', baseURL: 'https://okta.com' },
  { siteId: 'b061dde0-1d9a-47dc-a192-749282aa6eba', baseURL: 'https://vonage.com' },
  { siteId: '904c2bb4-2b1b-4463-9376-bf652132de36', baseURL: 'https://lexmark.com' },
  { siteId: '5d0f5df8-953f-4c24-9d4e-6e48384e75cf', baseURL: 'https://bhgfinancial.com' },
  { siteId: '768a8908-a713-4a53-bfcb-27307aa5af24', baseURL: 'https://cox.com' },
  { siteId: 'eb0cac5a-09c9-4d5f-8d82-34bb5125b240', baseURL: 'https://halliburton.com' },
  { siteId: 'ff53e016-133f-46aa-a654-8bd5c23507d8', baseURL: 'https://mauriceblackburn.com.au' },
  { siteId: '7668a35f-f8fe-4962-92e4-d0d93be57cac', baseURL: 'https://redtag.ca' },
  { siteId: '3b688b75-f350-40a1-90d0-27b007c4f714', baseURL: 'https://rosewoodhotels.com' },
  { siteId: '7b8f919a-162d-41bb-9869-ef4c7ad057e7', baseURL: 'https://micron.com' },
  { siteId: '94d5d687-68b0-457f-aac8-760ed8e9045a', baseURL: 'https://crucial.com' },
  { siteId: '275d1b4e-4ff4-4330-b8ab-ca2003df10c5', baseURL: 'https://twilio.com' },
  { siteId: '799e5e6c-e881-4fd6-9117-e881cf39927b', baseURL: 'https://twilio.com/en-us' },
  { siteId: 'dbdf4184-55d0-487f-bc69-7b6e0a996120', baseURL: 'https://casio.com' },
  { siteId: 'f6208fb0-dde8-4b5e-8556-6b274c52f7e3', baseURL: 'https://recordedfuture.com' },
  { siteId: '620fbc50-59e3-4027-a915-980ed57a6ee7', baseURL: 'https://hello-tech.com' },
  { siteId: '92d24fa2-5e99-4d43-8799-84cba3385ae1', baseURL: 'https://qualcomm.com' },
  { siteId: 'f63e23c2-7e5d-4ac5-81e1-b21e51727d5f', baseURL: 'https://metrobyt-mobile.com' },
  { siteId: '1ac131eb-9841-460e-ae93-bee066711ec7', baseURL: 'https://krisshop.com' },
  { siteId: 'de319755-e226-4bbc-8dc9-f275ff6f67d6', baseURL: 'https://state.co.nz' },
  { siteId: '840d5e17-f9d8-4076-91c8-6ca06fe53e06', baseURL: 'https://wfi.com.au' },
  { siteId: '0efd5f31-e938-4914-9ff4-05294a72c417', baseURL: 'https://cgu.com.au' },
  { siteId: '4d285d3a-62f1-4589-9f22-d891b8ada532', baseURL: 'https://ami.co.nz' },
  { siteId: 'f02e7334-4bf8-4a9c-baad-4c9cdd259fba', baseURL: 'https://nrma.com.au' },
  { siteId: 'c69a0115-7a37-4955-b247-9fa174ba8a1f', baseURL: 'https://collectables.auspost.com.au' },
  { siteId: '07234604-f5e0-4a9c-9ad5-ff2037e5eba5', baseURL: 'https://ups.com' },
  { siteId: '2ea78264-bf47-494f-9854-3693e6dfbfb2', baseURL: 'https://about.ups.com' },
  { siteId: '90abcb83-bbfb-4bbd-8313-a0adc2986ce2', baseURL: 'https://insureshield.com' },
  { siteId: 'b26912fa-5892-4d9c-8d11-56d9f0d1650d', baseURL: 'https://parcelpro.com' },
  { siteId: '7daac04b-0641-408f-ac71-0e70a20f4e0d', baseURL: 'https://zepbound.lilly.com' },
  { siteId: 'b6974573-5212-4e0c-aa0e-3ad0874622eb', baseURL: 'https://lilly.com' },
  { siteId: '3d277788-7b1c-40b8-bc7d-94fdee2da781', baseURL: 'https://doverfuelingsolutions.com' },
  { siteId: 'c5e041ba-86db-496f-88de-bae9419e7874', baseURL: 'https://eastman.com' },
  { siteId: 'eb0cac5a-09c9-4d5f-8d82-34bb5125b240', baseURL: 'https://halliburton.com' },
];

export const ASO_PORTFOLIO_SITE_IDS = ASO_PORTFOLIO_SITES.map((s) => s.siteId);

/** Comma-separated site IDs for API query param. */
export function getASOPortfolioSiteIds() {
  return ASO_PORTFOLIO_SITE_IDS.join(',');
}

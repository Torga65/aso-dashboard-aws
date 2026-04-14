'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ComboBox, Item, Flex, Heading, Button, ProgressCircle, Text, TextField } from '@adobe/react-spectrum';
import { useIMSAuth } from '@/contexts/IMSAuthContext';

export interface Site {
  id: string;
  baseURL?: string;
  [key: string]: unknown;
}

interface Org {
  id: string;
  name?: string;
  imsOrgId?: string;
  [key: string]: unknown;
}

const RECENT_SITES_KEY = 'aso-validator-recent-sites';
const RECENT_SITES_MAX = 5;

interface SiteSelectorProps {
  onSelect: (site: Site) => void;
  /** Currently loaded site; its name is shown next to the site picker. */
  selectedSite?: Site | null;
  disabled?: boolean;
  /** If provided, pre-fills the URL input and attempts an auto-find on load. */
  preloadBaseURL?: string;
}

function siteLabel(site: Site): string {
  return (site.baseURL as string) || site.id;
}

function orgLabel(org: Org): string {
  return org.name || org.id;
}

function getRecentSites(): Array<{ id: string; label: string; orgId?: string }> {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_SITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_SITES_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecentSite(site: Site, orgId?: string | null): void {
  const label = siteLabel(site);
  const prev = getRecentSites().filter((r) => r.id !== site.id);
  const next = [{ id: site.id, label, ...(orgId ? { orgId } : {}) }, ...prev].slice(0, RECENT_SITES_MAX);
  try {
    localStorage.setItem(RECENT_SITES_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/$/, '').toLowerCase();
}

export function SiteSelector({ onSelect, selectedSite, disabled, preloadBaseURL }: SiteSelectorProps) {
  const { accessToken } = useIMSAuth();

  // ── Org picker ──────────────────────────────────────────────────────────────
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [orgsError, setOrgsError] = useState<string | null>(null);
  const [selectedOrgKey, setSelectedOrgKey] = useState<string | null>(null);
  const [orgInputValue, setOrgInputValue] = useState('');

  // ── Site picker (scoped to selected org) ────────────────────────────────────
  const [sites, setSites] = useState<Site[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [selectedSiteKey, setSelectedSiteKey] = useState<string | null>(null);
  const [siteInputValue, setSiteInputValue] = useState('');

  // ── Recent sites ────────────────────────────────────────────────────────────
  const [recentSites, setRecentSites] = useState<Array<{ id: string; label: string; orgId?: string }>>([]);

  // ── URL fallback ────────────────────────────────────────────────────────────
  const [urlInput, setUrlInput] = useState(preloadBaseURL ?? '');
  const [findingSite, setFindingSite] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);

  useEffect(() => {
    setRecentSites(getRecentSites());
  }, []);

  // Sync selectedSite back to UI state
  useEffect(() => {
    if (selectedSite) {
      setSelectedSiteKey(selectedSite.id);
      setSiteInputValue(siteLabel(selectedSite));
    }
  }, [selectedSite]);

  // ── Load organizations ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setOrgsError(null);
    setOrgsLoading(true);
    fetch('/api/spacecat/organizations', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => {
        if (!res.ok) {
          return res.json().catch(() => ({})).then((data) => {
            throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
          });
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const list: Org[] = Array.isArray(data)
          ? data
          : ((data as { organizations?: Org[]; data?: Org[] })?.organizations ?? (data as { data?: Org[] })?.data ?? []);
        setOrgs(list);
        if (list.length === 0) setOrgsError('No organizations found.');
      })
      .catch((e) => {
        if (!cancelled) setOrgsError(e instanceof Error ? e.message : 'Failed to load organizations');
      })
      .finally(() => {
        if (!cancelled) setOrgsLoading(false);
      });
    return () => { cancelled = true; };
  }, [accessToken]);

  // ── Load sites for selected org ──────────────────────────────────────────────
  useEffect(() => {
    if (!accessToken || !selectedOrgKey) {
      setSites([]);
      setSitesError(null);
      return;
    }
    let cancelled = false;
    setSitesError(null);
    setSitesLoading(true);
    setSites([]);
    fetch(`/api/spacecat/organizations/${selectedOrgKey}/sites`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => {
        if (!res.ok) {
          return res.json().catch(() => ({})).then((data) => {
            throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
          });
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const list: Site[] = Array.isArray(data)
          ? data
          : ((data as { sites?: Site[]; data?: Site[] })?.sites ?? (data as { data?: Site[] })?.data ?? []);
        setSites(list);
        if (list.length === 0) setSitesError('No sites found for this organization.');
        // Auto-select if preloadBaseURL matches a site in this org
        if (preloadBaseURL && list.length > 0) {
          const normalized = normalizeUrl(preloadBaseURL);
          const match = list.find((s) => normalizeUrl((s.baseURL as string) ?? '') === normalized);
          if (match) {
            onSelect(match);
            saveRecentSite(match, selectedOrgKey);
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setSitesError(e instanceof Error ? e.message : 'Failed to load sites');
      })
      .finally(() => {
        if (!cancelled) setSitesLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, selectedOrgKey]);

  // ── Derived lists ────────────────────────────────────────────────────────────
  const filteredOrgItems = useMemo(() => {
    const items = orgs.map((o) => ({ id: o.id, label: orgLabel(o) }));
    if (!orgInputValue.trim()) return items;
    const q = orgInputValue.trim().toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(q));
  }, [orgs, orgInputValue]);

  const filteredSiteItems = useMemo(() => {
    const items = sites.map((s) => ({ id: s.id, label: siteLabel(s) }));
    if (!siteInputValue.trim()) return items;
    const q = siteInputValue.trim().toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(q));
  }, [sites, siteInputValue]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const selectSite = useCallback(
    (site: Site, orgId?: string | null) => {
      onSelect(site);
      saveRecentSite(site, orgId ?? selectedOrgKey);
      setRecentSites(getRecentSites());
      setSelectedSiteKey(site.id);
      setSiteInputValue(siteLabel(site));
    },
    [onSelect, selectedOrgKey]
  );

  const handleOrgSelectionChange = useCallback(
    (key: string | number | null) => {
      const keyStr = key != null ? String(key) : null;
      setSelectedOrgKey(keyStr);
      setSelectedSiteKey(null);
      setSiteInputValue('');
      if (keyStr != null) {
        const org = orgs.find((o) => o.id === keyStr);
        if (org) setOrgInputValue(orgLabel(org));
      }
    },
    [orgs]
  );

  const handleOrgInputChange = useCallback((value: string) => {
    setOrgInputValue(value);
    if (!value.trim()) {
      setSelectedOrgKey(null);
      setSites([]);
      setSelectedSiteKey(null);
      setSiteInputValue('');
    }
  }, []);

  const handleSiteSelectionChange = useCallback(
    (key: string | number | null) => {
      const keyStr = key != null ? String(key) : null;
      setSelectedSiteKey(keyStr);
      if (keyStr != null) {
        const site = sites.find((s) => s.id === keyStr);
        if (site) selectSite(site);
      }
    },
    [sites, selectSite]
  );

  const handleSiteInputChange = useCallback((value: string) => {
    setSiteInputValue(value);
    if (!value.trim()) setSelectedSiteKey(null);
  }, []);

  const handleRecentSitePress = useCallback(
    (recent: { id: string; label: string; orgId?: string }) => {
      // Immediately unblock the validator with what we know about this site
      const site: Site = { id: recent.id, baseURL: recent.label };
      onSelect(site);
      saveRecentSite(site, recent.orgId);
      setRecentSites(getRecentSites());
      setSelectedSiteKey(recent.id);
      setSiteInputValue(recent.label);

      // Also restore the org so the site picker populates correctly
      if (recent.orgId && recent.orgId !== selectedOrgKey) {
        setSelectedOrgKey(recent.orgId);
        const org = orgs.find((o) => o.id === recent.orgId);
        if (org) setOrgInputValue(orgLabel(org));
      }
    },
    [onSelect, selectedOrgKey, orgs]
  );

  /** Search within loaded org sites by URL, or try global lookup as a fallback. */
  const handleFindByUrl = useCallback(async () => {
    const url = urlInput.trim();
    if (!url || !accessToken) return;
    const normalized = normalizeUrl(url);

    // Check already-loaded org sites first
    if (sites.length > 0) {
      const match = sites.find((s) => normalizeUrl((s.baseURL as string) ?? '') === normalized);
      if (match) {
        selectSite(match);
        setFindError(null);
        return;
      }
    }

    setFindingSite(true);
    setFindError(null);
    try {
      // Try SpaceCat's baseURL filter — may or may not be supported
      const res = await fetch(
        `/api/spacecat/sites?baseURL=${encodeURIComponent(url)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
      }
      const raw = await res.json();
      const all: Site[] = Array.isArray(raw) ? raw : ((raw as { data?: Site[] })?.data ?? []);
      const found = all.find((s) => normalizeUrl((s.baseURL as string) ?? '') === normalized);
      if (found) {
        selectSite(found);
      } else {
        setFindError(`No site found for: ${url}. Select an organization first to search within its sites.`);
      }
    } catch {
      setFindError('Could not look up site by URL. Please select an organization above to browse its sites.');
    } finally {
      setFindingSite(false);
    }
  }, [urlInput, accessToken, sites, selectSite]);

  return (
    <Flex direction="column" gap="size-150" marginBottom="size-200">
      <Heading level={2} margin={0}>Select a site</Heading>

      {/* Step 1 — Organization */}
      <Flex direction="row" alignItems="end" gap="size-200" wrap>
        <ComboBox
          label="Organization"
          placeholder={orgsLoading ? 'Loading organizations…' : 'Search by org name…'}
          items={filteredOrgItems}
          selectedKey={selectedOrgKey}
          onSelectionChange={handleOrgSelectionChange}
          inputValue={orgInputValue}
          onInputChange={handleOrgInputChange}
          isDisabled={disabled || orgsLoading}
          width="size-6000"
          menuTrigger="input"
          loadingState={orgsLoading ? 'loading' : 'idle'}
          validationState={orgsError ? 'invalid' : undefined}
          errorMessage={orgsError ?? undefined}
          allowsCustomValue={false}
        >
          {(item) => <Item key={item.id} textValue={item.label}>{item.label}</Item>}
        </ComboBox>
      </Flex>

      {/* Step 2 — Site (visible once an org is chosen) */}
      {selectedOrgKey && (
        <Flex direction="row" alignItems="end" gap="size-200" wrap>
          <ComboBox
            label="Site"
            placeholder={sitesLoading ? 'Loading sites…' : 'Type to search by URL or site ID…'}
            items={filteredSiteItems}
            selectedKey={selectedSiteKey}
            onSelectionChange={handleSiteSelectionChange}
            inputValue={siteInputValue}
            onInputChange={handleSiteInputChange}
            isDisabled={disabled || sitesLoading}
            width="size-6000"
            menuTrigger="input"
            loadingState={sitesLoading ? 'loading' : 'idle'}
            validationState={sitesError ? 'invalid' : undefined}
            errorMessage={sitesError ?? undefined}
            allowsCustomValue={false}
          >
            {(item) => <Item key={item.id} textValue={item.label}>{item.label}</Item>}
          </ComboBox>
          {selectedSite && (
            <Text
              UNSAFE_style={{
                fontSize: 'var(--spectrum-global-dimension-font-size-100)',
                color: 'var(--spectrum-global-color-gray-700)',
                fontWeight: 600,
                paddingBottom: 6,
              }}
            >
              {siteLabel(selectedSite)}
            </Text>
          )}
        </Flex>
      )}

      {/* Recent sites — always visible */}
      <Flex gap="size-100" wrap alignItems="center">
        <Text UNSAFE_style={{ fontSize: 'var(--spectrum-global-dimension-font-size-100)', color: 'var(--spectrum-global-color-gray-600)' }}>
          Recent:
        </Text>
        {recentSites.length > 0 ? (
          recentSites.map((recent) => (
            <Button
              key={recent.id}
              variant="secondary"
              onPress={() => handleRecentSitePress(recent)}
              isDisabled={disabled}
              UNSAFE_style={{ padding: '4px 10px', fontSize: '13px' }}
            >
              {recent.label}
            </Button>
          ))
        ) : (
          <Text UNSAFE_style={{ fontSize: 'var(--spectrum-global-dimension-font-size-100)', color: 'var(--spectrum-global-color-gray-600)' }}>
            None yet
          </Text>
        )}
      </Flex>

      {/* URL fallback — always available */}
      <Flex direction="column" gap="size-75">
        <Text UNSAFE_style={{ fontSize: 'var(--spectrum-global-dimension-font-size-75)', color: 'var(--spectrum-global-color-gray-600)' }}>
          Or enter a site URL directly:
        </Text>
        <Flex direction="row" gap="size-150" alignItems="end" wrap>
          <TextField
            label="Site URL"
            placeholder="https://example.com"
            value={urlInput}
            onChange={setUrlInput}
            width="size-6000"
            isDisabled={disabled || findingSite}
            onKeyDown={(e) => { if (e.key === 'Enter') handleFindByUrl(); }}
            validationState={findError ? 'invalid' : undefined}
            errorMessage={findError ?? undefined}
          />
          <Button
            variant="primary"
            onPress={handleFindByUrl}
            isDisabled={disabled || !urlInput.trim() || findingSite}
          >
            {findingSite ? <ProgressCircle size="S" isIndeterminate aria-label="Finding site" /> : 'Find site'}
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
}

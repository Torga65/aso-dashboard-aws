'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ComboBox, Item, Flex, Heading, Button, ProgressCircle, Text, TextField } from '@adobe/react-spectrum';
import { useIMSAuth } from '@/contexts/IMSAuthContext';

export interface Site {
  id: string;
  baseURL?: string;
  [key: string]: unknown;
}

const RECENT_SITES_KEY = 'aso-validator-recent-sites';
const RECENT_SITES_MAX = 5;

interface SiteSelectorProps {
  onSelect: (site: Site) => void;
  /** Currently loaded site; its name is shown to the right of the search bar. */
  selectedSite?: Site | null;
  disabled?: boolean;
  /** If provided, auto-select the site matching this baseURL once sites load. */
  preloadBaseURL?: string;
}

function siteLabel(site: Site): string {
  return (site.baseURL as string) || site.id;
}

function getRecentSites(): Array<{ id: string; label: string }> {
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

function saveRecentSite(site: Site): void {
  const label = siteLabel(site);
  const prev = getRecentSites().filter((r) => r.id !== site.id);
  const next = [{ id: site.id, label }, ...prev].slice(0, RECENT_SITES_MAX);
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
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [recentSites, setRecentSites] = useState<Array<{ id: string; label: string }>>([]);

  // URL input fallback state
  const [urlInput, setUrlInput] = useState('');
  const [findingSite, setFindingSite] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);

  useEffect(() => {
    setRecentSites(getRecentSites());
  }, []);

  useEffect(() => {
    if (selectedSite) {
      setSelectedKey(selectedSite.id);
      setInputValue(siteLabel(selectedSite));
    }
  }, [selectedSite]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setError(null);
    setLoading(true);
    fetch('/api/spacecat/sites', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => {
        if (!res.ok) {
          return res.json().catch(() => ({})).then((data) => {
            throw new Error(data.error || `HTTP ${res.status}`);
          });
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : (data?.data ?? []);
        setSites(list);
        // Auto-select if a baseURL was passed via query param
        if (preloadBaseURL && list.length > 0) {
          const normalized = normalizeUrl(preloadBaseURL);
          const match = list.find(
            (s: Site) => normalizeUrl((s.baseURL as string) ?? '') === normalized
          );
          if (match) {
            onSelect(match);
            saveRecentSite(match);
          }
        }
        if (list.length === 0) setError('No sites returned.');
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load sites');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const siteItems = useMemo(
    () => sites.map((s) => ({ id: s.id, label: siteLabel(s), site: s })),
    [sites]
  );

  const filteredSiteItems = useMemo(() => {
    if (!inputValue.trim()) return siteItems;
    const q = inputValue.trim().toLowerCase();
    return siteItems.filter((item) => item.label.toLowerCase().includes(q));
  }, [siteItems, inputValue]);

  const recentMatchingSites = useMemo(() => {
    if (recentSites.length === 0 || sites.length === 0) return [];
    return recentSites
      .map((r) => sites.find((s) => s.id === r.id))
      .filter((s): s is Site => s != null);
  }, [recentSites, sites]);

  const selectSite = useCallback(
    (site: Site) => {
      onSelect(site);
      saveRecentSite(site);
      setRecentSites(getRecentSites());
      setSelectedKey(site.id);
      setInputValue(siteLabel(site));
    },
    [onSelect]
  );

  const handleSelectionChange = useCallback(
    (key: string | number | null) => {
      const keyStr = key != null ? String(key) : null;
      setSelectedKey(keyStr);
      if (keyStr != null) {
        const site = sites.find((s) => s.id === keyStr);
        if (site) {
          onSelect(site);
          saveRecentSite(site);
          setRecentSites(getRecentSites());
          setInputValue(siteLabel(site));
        }
      }
    },
    [sites, onSelect]
  );

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
    if (!value.trim()) setSelectedKey(null);
  }, []);

  /** Find a site by URL — works independently of the preloaded sites list. */
  const handleFindByUrl = useCallback(async () => {
    const url = urlInput.trim();
    if (!url || !accessToken) return;
    const normalized = normalizeUrl(url);

    // Check already-loaded sites first (instant)
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
      // SpaceCat may support baseURL filtering — if not, it returns all sites and we filter
      const res = await fetch(
        `/api/spacecat/sites?baseURL=${encodeURIComponent(url)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
      }
      const raw = await res.json();
      const all: Site[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
      const match = all.find((s) => normalizeUrl((s.baseURL as string) ?? '') === normalized);
      if (match) {
        selectSite(match);
        // Also populate the sites list if it wasn't loaded
        if (sites.length === 0) setSites(all);
      } else {
        setFindError(`No site found for: ${url}`);
      }
    } catch (e) {
      setFindError(e instanceof Error ? e.message : 'Failed to find site');
    } finally {
      setFindingSite(false);
    }
  }, [urlInput, accessToken, sites, selectSite]);

  return (
    <Flex direction="column" gap="size-150" marginBottom="size-200">
      <Heading level={2} margin={0}>Select a site</Heading>

      <Flex direction="row" alignItems="end" gap="size-200" wrap>
        <ComboBox
          label="Search sites"
          placeholder={loading ? 'Loading sites…' : 'Type to search by URL or site ID…'}
          items={filteredSiteItems}
          selectedKey={selectedKey}
          onSelectionChange={handleSelectionChange}
          inputValue={inputValue}
          onInputChange={handleInputChange}
          isDisabled={disabled || loading}
          width="size-6000"
          menuTrigger="input"
          loadingState={loading ? 'loading' : 'idle'}
          validationState={error ? 'invalid' : undefined}
          errorMessage={error ?? undefined}
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

      {/* Recent sites — always visible, even while the full list is loading */}
      <Flex gap="size-100" wrap alignItems="center">
        <Text UNSAFE_style={{ fontSize: 'var(--spectrum-global-dimension-font-size-100)', color: 'var(--spectrum-global-color-gray-600)' }}>Recent:</Text>
        {recentMatchingSites.length > 0 ? (
          recentMatchingSites.map((site) => (
            <Button
              key={site.id}
              variant="secondary"
              onPress={() => selectSite(site)}
              isDisabled={disabled}
              UNSAFE_style={{ padding: '4px 10px', fontSize: '13px' }}
            >
              {siteLabel(site)}
            </Button>
          ))
        ) : loading ? (
          <Flex alignItems="center" gap="size-100">
            <ProgressCircle size="S" isIndeterminate aria-label="Loading sites" />
            <Text UNSAFE_style={{ fontSize: 'var(--spectrum-global-dimension-font-size-100)', color: 'var(--spectrum-global-color-gray-600)' }}>Loading…</Text>
          </Flex>
        ) : (
          <Text UNSAFE_style={{ fontSize: 'var(--spectrum-global-dimension-font-size-100)', color: 'var(--spectrum-global-color-gray-600)' }}>None yet</Text>
        )}
      </Flex>

      {/* Direct URL entry — usable while sites list is still loading */}
      {loading && (
        <Flex direction="column" gap="size-75">
          <Text UNSAFE_style={{ fontSize: 'var(--spectrum-global-dimension-font-size-75)', color: 'var(--spectrum-global-color-gray-600)' }}>
            Sites list loading… Enter a site URL directly to continue:
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
              {findingSite ? <ProgressCircle size="S" isIndeterminate aria-label="Finding" /> : 'Find site'}
            </Button>
          </Flex>
        </Flex>
      )}
    </Flex>
  );
}

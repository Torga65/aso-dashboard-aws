'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ComboBox, Item, Flex, Heading, Button, ProgressCircle, Text, ActionButton } from '@adobe/react-spectrum';
import { useIMSAuth } from '@/contexts/IMSAuthContext';
import Close from '@spectrum-icons/workflow/Close';

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
  selectedSite?: Site | null;
  disabled?: boolean;
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

  // Two-phase state: first pick an org, then pick a site within it
  const [step, setStep] = useState<'org' | 'site'>('org');
  const [selectedOrg, setSelectedOrg] = useState<Org | null>(null);

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [orgsError, setOrgsError] = useState<string | null>(null);

  const [sites, setSites] = useState<Site[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [sitesError, setSitesError] = useState<string | null>(null);

  // Single shared input / selection for the one ComboBox
  const [inputValue, setInputValue] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [recentSites, setRecentSites] = useState<Array<{ id: string; label: string; orgId?: string }>>([]);

  useEffect(() => {
    setRecentSites(getRecentSites());
  }, []);

  // Keep ComboBox in sync when the parent sets a selectedSite externally
  useEffect(() => {
    if (selectedSite && step === 'site') {
      setSelectedKey(selectedSite.id);
      setInputValue(siteLabel(selectedSite));
    }
  }, [selectedSite, step]);

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

  // ── Load sites when an org is selected ──────────────────────────────────────
  const loadSites = useCallback((orgId: string) => {
    if (!accessToken) return;
    setSitesError(null);
    setSitesLoading(true);
    setSites([]);
    fetch(`/api/spacecat/organizations/${orgId}/sites`, {
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
        const list: Site[] = Array.isArray(data)
          ? data
          : ((data as { sites?: Site[]; data?: Site[] })?.sites ?? (data as { data?: Site[] })?.data ?? []);
        setSites(list);
        if (list.length === 0) setSitesError('No sites found for this organization.');
        if (preloadBaseURL && list.length > 0) {
          const normalized = normalizeUrl(preloadBaseURL);
          const match = list.find((s) => normalizeUrl((s.baseURL as string) ?? '') === normalized);
          if (match) {
            onSelect(match);
            saveRecentSite(match, orgId);
            setSelectedKey(match.id);
            setInputValue(siteLabel(match));
          }
        }
      })
      .catch((e) => {
        setSitesError(e instanceof Error ? e.message : 'Failed to load sites');
      })
      .finally(() => {
        setSitesLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  // ── Filtered items for the ComboBox ─────────────────────────────────────────
  const items = useMemo(() => {
    if (step === 'org') {
      const all = orgs.map((o) => ({ id: o.id, label: orgLabel(o) }));
      if (!inputValue.trim()) return all;
      const q = inputValue.trim().toLowerCase();
      return all.filter((i) => i.label.toLowerCase().includes(q));
    }
    const all = sites.map((s) => ({ id: s.id, label: siteLabel(s) }));
    if (!inputValue.trim()) return all;
    const q = inputValue.trim().toLowerCase();
    return all.filter((i) => i.label.toLowerCase().includes(q));
  }, [step, orgs, sites, inputValue]);

  // ── Selection handler ────────────────────────────────────────────────────────
  const handleSelectionChange = useCallback(
    (key: string | number | null) => {
      const keyStr = key != null ? String(key) : null;
      if (!keyStr) return;

      if (step === 'org') {
        const org = orgs.find((o) => o.id === keyStr);
        if (!org) return;
        setSelectedOrg(org);
        setStep('site');
        setInputValue('');
        setSelectedKey(null);
        loadSites(org.id);
      } else {
        const site = sites.find((s) => s.id === keyStr);
        if (!site) return;
        setSelectedKey(site.id);
        setInputValue(siteLabel(site));
        onSelect(site);
        saveRecentSite(site, selectedOrg?.id);
        setRecentSites(getRecentSites());
      }
    },
    [step, orgs, sites, selectedOrg, onSelect, loadSites]
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value);
      if (!value.trim() && step === 'site') setSelectedKey(null);
    },
    [step]
  );

  // Reset to org selection
  const handleChangeOrg = useCallback(() => {
    setStep('org');
    setSelectedOrg(null);
    setSites([]);
    setSitesError(null);
    setInputValue('');
    setSelectedKey(null);
  }, []);

  const handleRecentSitePress = useCallback(
    (recent: { id: string; label: string; orgId?: string }) => {
      const site: Site = { id: recent.id, baseURL: recent.label };
      onSelect(site);
      saveRecentSite(site, recent.orgId);
      setRecentSites(getRecentSites());

      // Restore org context if known
      if (recent.orgId) {
        const org = orgs.find((o) => o.id === recent.orgId);
        if (org && selectedOrg?.id !== recent.orgId) {
          setSelectedOrg(org);
          loadSites(recent.orgId);
        }
      }
      setStep('site');
      setSelectedKey(recent.id);
      setInputValue(recent.label);
    },
    [onSelect, orgs, selectedOrg, loadSites]
  );

  const isLoading = step === 'org' ? orgsLoading : sitesLoading;
  const error = step === 'org' ? orgsError : sitesError;

  const label = step === 'org' ? 'Organization / Site' : 'Site';
  const placeholder = step === 'org'
    ? (orgsLoading ? 'Loading organizations…' : 'Search by organization name…')
    : (sitesLoading ? 'Loading sites…' : 'Search by URL or site ID…');

  return (
    <Flex direction="column" gap="size-150" marginBottom="size-200">
      <Heading level={2} margin={0}>Select a site</Heading>

      {/* Org context pill — shown when in site-selection step */}
      {step === 'site' && selectedOrg && (
        <Flex alignItems="center" gap="size-75">
          <Text
            UNSAFE_style={{
              fontSize: 'var(--spectrum-global-dimension-font-size-75)',
              color: 'var(--spectrum-global-color-gray-600)',
            }}
          >
            Org:
          </Text>
          <Text
            UNSAFE_style={{
              fontSize: 'var(--spectrum-global-dimension-font-size-75)',
              fontWeight: 600,
              color: 'var(--spectrum-global-color-gray-800)',
              background: 'var(--spectrum-global-color-gray-200)',
              borderRadius: 12,
              padding: '2px 8px',
            }}
          >
            {orgLabel(selectedOrg)}
          </Text>
          <ActionButton
            isQuiet
            aria-label="Change organization"
            onPress={handleChangeOrg}
            UNSAFE_style={{ minWidth: 0, width: 20, height: 20, padding: 0 }}
          >
            <Close size="S" />
          </ActionButton>
        </Flex>
      )}

      {/* Single ComboBox */}
      <Flex direction="row" alignItems="end" gap="size-200" wrap>
        <ComboBox
          label={label}
          placeholder={placeholder}
          items={items}
          selectedKey={selectedKey}
          onSelectionChange={handleSelectionChange}
          inputValue={inputValue}
          onInputChange={handleInputChange}
          isDisabled={disabled || isLoading}
          width="size-6000"
          menuTrigger="input"
          loadingState={isLoading ? 'loading' : 'idle'}
          validationState={error ? 'invalid' : undefined}
          errorMessage={error ?? undefined}
          allowsCustomValue={false}
        >
          {(item) => <Item key={item.id} textValue={item.label}>{item.label}</Item>}
        </ComboBox>

        {step === 'site' && sitesLoading && (
          <Flex alignItems="center" gap="size-100" UNSAFE_style={{ paddingBottom: 6 }}>
            <ProgressCircle size="S" isIndeterminate aria-label="Loading sites" />
            <Text UNSAFE_style={{ fontSize: 'var(--spectrum-global-dimension-font-size-75)', color: 'var(--spectrum-global-color-gray-600)' }}>
              Loading…
            </Text>
          </Flex>
        )}
      </Flex>

      {/* Recent sites */}
      {recentSites.length > 0 && (
        <Flex gap="size-100" wrap alignItems="center">
          <Text UNSAFE_style={{ fontSize: 'var(--spectrum-global-dimension-font-size-75)', color: 'var(--spectrum-global-color-gray-600)' }}>
            Recent:
          </Text>
          {recentSites.map((recent) => (
            <Button
              key={recent.id}
              variant="secondary"
              onPress={() => handleRecentSitePress(recent)}
              isDisabled={disabled}
              UNSAFE_style={{ padding: '4px 10px', fontSize: '13px' }}
            >
              {recent.label}
            </Button>
          ))}
        </Flex>
      )}
    </Flex>
  );
}

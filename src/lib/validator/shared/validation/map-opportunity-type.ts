/**
 * Map SpaceCat opportunity type/title to our registry opportunity type id.
 */

import type { Opportunity } from '@validator-shared/types';

export function mapOpportunityToTypeId(opportunity: Opportunity): string {
  const type = (opportunity.type ?? '').toLowerCase();
  const title = (opportunity.title ?? '').toLowerCase();

  if (type === 'sitemap' || title.includes('sitemap')) return 'sitemap';
  if (type === 'heading' || title.includes('heading')) return 'heading';
  if (type === 'canonical' || title.includes('canonical')) return 'stub';
  if (type === 'meta-tags' || title.includes('metatag') || title.includes('meta tag') || title.includes('meta-tag')) return 'meta-tags';
  if (type === 'hreflang' || title.includes('hreflang')) return 'hreflang';
  if (type === 'a11y-color-contrast' || title.includes('color contrast')) return 'a11y-color-contrast';

  if (
    type === 'broken-internal-links' ||
    type === 'broken_internal_links' ||
    type === 'broken-links' ||
    type === 'broken_links' ||
    title.includes('broken internal link') ||
    (title.includes('broken') && title.includes('internal') && title.includes('link'))
  ) {
    return 'broken-internal-links';
  }

  return 'stub';
}

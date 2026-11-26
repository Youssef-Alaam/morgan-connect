import { useTranslation } from 'react-i18next';
import { Badge } from '../components/Badge.tsx';
import { Banner } from '../components/Banner.tsx';
import { Button } from '../components/Button.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { Table } from '../components/Table.tsx';
import { GallerySection } from './GallerySection.tsx';

const BADGE = 'badge';
const BANNER = 'banner';
const TABLE = 'table';
const EMPTY = 'empty-state';

export function BadgeSection() {
  const { t } = useTranslation();
  return (
    <GallerySection name={BADGE} title={t('gallery.badge.title')}>
      <div className="gallery-row">
        <Badge>{t('gallery.badge.owner')}</Badge>
        <Badge tone="danger">{t('gallery.badge.suspended')}</Badge>
      </div>
    </GallerySection>
  );
}

export function BannerSection() {
  const { t } = useTranslation();
  return (
    <GallerySection name={BANNER} title={t('gallery.banner.title')}>
      <Banner tone="info" label={t('gallery.banner.info')}>
        {t('gallery.banner.infoText')}
      </Banner>
      <Banner tone="warning" label={t('gallery.banner.warning')}>
        {t('gallery.banner.warningText')}
      </Banner>
      <Banner tone="danger" label={t('gallery.banner.danger')}>
        {t('gallery.banner.dangerText')}
      </Banner>
    </GallerySection>
  );
}

export function TableSection() {
  const { t } = useTranslation();
  const rows = [
    [t('gallery.table.youssef'), t('gallery.badge.owner')],
    [t('gallery.table.narimane'), t('gallery.table.member')],
  ];
  return (
    <GallerySection name={TABLE} title={t('gallery.table.title')}>
      <Table
        caption={t('gallery.table.caption')}
        columns={[t('gallery.table.name'), t('gallery.table.role')]}
        rows={rows}
      />
    </GallerySection>
  );
}

export function EmptyStateSection() {
  const { t } = useTranslation();
  return (
    <GallerySection name={EMPTY} title={t('gallery.empty.title')}>
      <EmptyState
        title={t('gallery.empty.heading')}
        action={<Button>{t('gallery.empty.action')}</Button>}
      >
        {t('gallery.empty.text')}
      </EmptyState>
    </GallerySection>
  );
}

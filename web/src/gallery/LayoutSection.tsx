import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApprovalCard } from '../components/ApprovalCard.tsx';
import { PageLayout } from '../components/PageLayout.tsx';
import { GallerySection } from './GallerySection.tsx';

const LAYOUT = 'layout';
const APPROVAL = 'approval-card';

export function LayoutSection() {
  const { t } = useTranslation();
  const links = [
    { href: '#chat', label: t('gallery.layout.chat'), current: true },
    { href: '#users', label: t('gallery.layout.users') },
    { href: '#usage', label: t('gallery.layout.usage') },
  ];
  return (
    <GallerySection name={LAYOUT} title={t('gallery.layout.title')}>
      <PageLayout navLabel={t('gallery.layout.nav')} links={links}>
        <p>{t('gallery.layout.content')}</p>
      </PageLayout>
    </GallerySection>
  );
}

export function ApprovalSection() {
  const { t } = useTranslation();
  const [outcome, setOutcome] = useState<string | undefined>(undefined);
  return (
    <GallerySection name={APPROVAL} title={t('gallery.approval.title')}>
      <ApprovalCard
        title={t('gallery.approval.heading')}
        approveLabel={t('gallery.approval.approve')}
        denyLabel={t('gallery.approval.deny')}
        onApprove={() => {
          setOutcome(t('gallery.approval.approved'));
        }}
        onDeny={() => {
          setOutcome(t('gallery.approval.denied'));
        }}
        {...(outcome === undefined ? {} : { outcome })}
      >
        {t('gallery.approval.details')}
      </ApprovalCard>
    </GallerySection>
  );
}

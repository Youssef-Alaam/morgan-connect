import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeInput } from '../components/CodeInput.tsx';
import { ThreeWay } from '../components/ThreeWay.tsx';
import { GallerySection } from './GallerySection.tsx';

const CODE = 'code';
const THREE_WAY = 'three-way';
const noop = () => undefined;

export function CodeSection() {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  return (
    <GallerySection name={CODE} title={t('gallery.code.title')}>
      <CodeInput
        label={t('gallery.code.label')}
        hint={t('gallery.code.hint')}
        value={value}
        onChange={setValue}
      />
    </GallerySection>
  );
}

export function ThreeWaySection() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'off' | 'ask' | 'auto'>('ask');
  const labels = {
    off: t('gallery.threeWay.off'),
    ask: t('gallery.threeWay.ask'),
    auto: t('gallery.threeWay.auto'),
  };
  return (
    <GallerySection name={THREE_WAY} title={t('gallery.threeWay.title')}>
      <ThreeWay
        label={t('gallery.threeWay.label')}
        value={mode}
        labels={labels}
        onChange={setMode}
        {...(mode === 'auto' ? { risk: t('gallery.threeWay.risk') } : {})}
      />
      <ThreeWay
        label={t('gallery.threeWay.labelRisky')}
        value="auto"
        labels={labels}
        onChange={noop}
        risk={t('gallery.threeWay.risk')}
      />
    </GallerySection>
  );
}

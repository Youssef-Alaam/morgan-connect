import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PasswordInput, TextInput } from '../components/TextInput.tsx';
import { Select } from '../components/Select.tsx';
import { Checkbox, Switch } from '../components/Toggle.tsx';
import { GallerySection } from './GallerySection.tsx';

const INPUTS = 'inputs';
const CHOICES = 'choices';

export function InputsSection() {
  const { t } = useTranslation();
  const options = [
    { value: 'en', label: t('gallery.inputs.english') },
    { value: 'ar', label: t('gallery.inputs.arabic') },
  ];
  return (
    <GallerySection name={INPUTS} title={t('gallery.inputs.title')}>
      <TextInput label={t('gallery.inputs.name')} hint={t('gallery.inputs.nameHint')} />
      <TextInput label={t('gallery.inputs.email')} error={t('gallery.inputs.emailError')} />
      <PasswordInput
        autoComplete="current-password"
        label={t('gallery.inputs.password')}
        showLabel={t('gallery.inputs.show')}
        hideLabel={t('gallery.inputs.hide')}
      />
      <Select label={t('gallery.inputs.language')} options={options} />
    </GallerySection>
  );
}

export function ChoicesSection() {
  const { t } = useTranslation();
  const [on, setOn] = useState(false);
  return (
    <GallerySection name={CHOICES} title={t('gallery.choices.title')}>
      <Checkbox label={t('gallery.choices.remember')} />
      <Switch label={t('gallery.choices.notifications')} checked={on} onChange={setOn} />
    </GallerySection>
  );
}

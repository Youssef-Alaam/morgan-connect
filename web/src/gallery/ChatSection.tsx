import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatBubble } from '../components/ChatBubble.tsx';
import { Composer } from '../components/Composer.tsx';
import { GallerySection } from './GallerySection.tsx';

const CHAT = 'chat';

export function ChatSection() {
  const { t } = useTranslation();
  const [sent, setSent] = useState<string[]>([t('gallery.chat.first')]);
  return (
    <GallerySection name={CHAT} title={t('gallery.chat.title')}>
      {sent.map((text, index) => (
        <ChatBubble key={index} from="user" author={t('gallery.chat.you')}>
          {text}
        </ChatBubble>
      ))}
      <ChatBubble from="morgan" author={t('gallery.chat.morgan')}>
        {t('gallery.chat.reply')}
      </ChatBubble>
      <Composer
        label={t('gallery.chat.message')}
        sendLabel={t('gallery.chat.send')}
        onSend={(text) => {
          setSent([...sent, text]);
        }}
      />
    </GallerySection>
  );
}

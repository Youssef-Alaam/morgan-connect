import type { ReactNode } from 'react';

interface ChatBubbleProps {
  from: 'user' | 'morgan';
  author: string;
  children: ReactNode;
}

export function ChatBubble({ from, author, children }: ChatBubbleProps) {
  return (
    <div className={`bubble bubble-${from}`}>
      <span className="bubble-author">{author}</span>
      <p>{children}</p>
    </div>
  );
}

import type { ReactNode } from 'react';

interface ToastProps {
  dismissLabel: string;
  onDismiss: () => void;
  children: ReactNode;
}

// No timer: a message that vanishes by itself can be gone before it has been read.
export function Toast({ dismissLabel, onDismiss, children }: ToastProps) {
  return (
    <div className="toast">
      <span>{children}</span>
      <button type="button" className="btn btn-secondary" onClick={onDismiss}>
        {dismissLabel}
      </button>
    </div>
  );
}

interface ToastRegionProps {
  toasts: { id: number; text: string }[];
  dismissLabel: string;
  onDismiss: (id: number) => void;
}

// Always in the page, so a screen reader is already listening when a toast is added.
export function ToastRegion({ toasts, dismissLabel, onDismiss }: ToastRegionProps) {
  return (
    <div className="toast-region" aria-live="polite">
      {toasts.map(({ id, text }) => (
        <Toast
          key={id}
          dismissLabel={dismissLabel}
          onDismiss={() => {
            onDismiss(id);
          }}
        >
          {text}
        </Toast>
      ))}
    </div>
  );
}

import type { Standing } from './api.ts';

// The live stream of one chat (`GET /api/chat/events`, server-sent events) and what it does to the screen.
export interface Line {
  id: string;
  from: 'user' | 'morgan';
  text: string;
  /** Only for the person's own lines: still going, delivered to the server, or refused. */
  state?: 'sending' | 'sent' | 'failed';
  /** Only for a question to the person: Morgan's text is the description and the exact arguments. */
  approval?: Approval;
}

/** `outcome` is unset while the question is open; `sending` while the person's answer is on its way. */
export interface Approval {
  id: string;
  outcome?: 'sending' | 'approved' | 'denied' | 'expired' | 'aborted' | 'invalid';
}

export interface ChatEvent {
  id: string;
  kind: 'ack' | 'message' | 'approval' | 'approval_closed';
  ref?: string;
  text?: string;
}

/**
 * Apply one event to the lines: an ack marks the person's line as delivered (and, replayed after a
 * reload, brings the line back from its text), a message adds Morgan's.
 */
export function apply(lines: Line[], event: ChatEvent): Line[] {
  if (event.kind === 'ack') {
    if (lines.some((line) => line.id === event.ref)) {
      return lines.map((line) => (line.id === event.ref ? { ...line, state: 'sent' } : line));
    }
    if (event.ref === undefined || event.text === undefined) return lines;
    return [...lines, { id: event.ref, from: 'user', text: event.text, state: 'sent' }];
  }
  if (event.kind === 'approval_closed') {
    return lines.map((line) => {
      const { approval } = line;
      return approval !== undefined && approval.id === event.ref
        ? { ...line, approval: closed(approval, event) }
        : line;
    });
  }
  const id = `event-${event.id}`;
  // A reconnect replays what was seen already; each event shows once.
  if (lines.some((line) => line.id === id)) return lines;
  const line: Line = { id, from: 'morgan', text: event.text ?? '' };
  if (event.kind === 'approval' && event.ref !== undefined) line.approval = { id: event.ref };
  return [...lines, line];
}

const OUTCOMES = ['approved', 'denied', 'expired', 'aborted'] as const;

/** The server's word for how a question ended; a word this screen does not know counts as aborted. */
function closed(approval: Approval, event: ChatEvent): Approval {
  const outcome = OUTCOMES.find((word) => word === event.text) ?? 'aborted';
  return { ...approval, outcome };
}

const KINDS = ['ack', 'message', 'approval', 'approval_closed'] as const;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
/** `EventSource.CLOSED`: the browser gave up (an HTTP error) and will not retry by itself. */
const CLOSED = 2;

export interface Handlers {
  onEvent: (event: ChatEvent) => void;
  onOpen: () => void;
  onBroken: () => void;
  /** The server says the session is over: show sign-in. */
  onEnded: () => void;
}

/**
 * Follow the stream. While the browser retries by itself nothing more is needed. When it has given
 * up (CLOSED), ask who this is: signed out ends the chat; signed in, or not knowing, reopens the
 * stream after a growing pause. Returns the way to stop.
 */
export function followEvents(h: Handlers, check: () => Promise<Standing>): () => void {
  let source: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = BASE_DELAY_MS;
  let stopped = false;
  // A stream the browser did not reopen by itself starts after the last event it showed.
  let last: string | undefined;
  const connect = (): void => {
    const opened = new EventSource(
      last === undefined
        ? '/api/chat/events'
        : `/api/chat/events?after=${encodeURIComponent(last)}`,
    );
    source = opened;
    opened.onopen = () => {
      delay = BASE_DELAY_MS;
      h.onOpen();
    };
    for (const kind of KINDS) {
      opened.addEventListener(kind, (raw) => {
        const message = raw as MessageEvent<string>;
        try {
          const data = JSON.parse(message.data) as { ref?: string; text?: string };
          last = message.lastEventId;
          h.onEvent({ id: last, kind, ...data });
        } catch {
          // A malformed event is skipped; the stream goes on.
        }
      });
    }
    opened.onerror = () => {
      h.onBroken();
      if (opened.readyState !== CLOSED) return;
      void check().then((where) => {
        if (stopped) return;
        if (where === 'out' || where === 'change') {
          h.onEnded();
          return;
        }
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, MAX_DELAY_MS);
      });
    };
  };
  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    source?.close();
  };
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Standing } from './api.ts';
import { apply, followEvents, type Handlers, type Line } from './events.ts';

const mine: Line = { id: 'u1', from: 'user', text: 'Hi', state: 'sending' };

describe('apply', () => {
  it('marks the person line as sent on its ack', () => {
    expect(apply([mine], { id: '1', kind: 'ack', ref: 'u1' })).toEqual([
      { ...mine, state: 'sent' },
    ]);
  });

  it('ignores an ack for a line that is not on screen', () => {
    expect(apply([mine], { id: '1', kind: 'ack', ref: 'other' })).toEqual([mine]);
  });

  it('brings the person line back from its ack text after a reload, once', () => {
    const event = { id: '1', kind: 'ack', ref: 'u9', text: 'Earlier' } as const;
    const replayed = apply([], event);
    expect(replayed).toEqual([{ id: 'u9', from: 'user', text: 'Earlier', state: 'sent' }]);
    expect(apply(replayed, event)).toEqual(replayed);
  });

  it('adds Morgan line once, even when a reconnect replays it', () => {
    const event = { id: '7', kind: 'message', text: 'Hello' } as const;
    const once = apply([mine], event);
    expect(once.at(-1)).toEqual({ id: 'event-7', from: 'morgan', text: 'Hello' });
    expect(apply(once, event)).toEqual(once);
  });
});

describe('apply, approvals', () => {
  const asked = { id: '5', kind: 'approval', ref: 'q1', text: 'Morgan asks' } as const;

  it('adds a question once, even when a reconnect replays it', () => {
    const once = apply([], asked);
    expect(once).toEqual([
      { id: 'event-5', from: 'morgan', text: 'Morgan asks', approval: { id: 'q1' } },
    ]);
    expect(apply(once, asked)).toEqual(once);
  });

  it.each(['approved', 'denied', 'expired', 'aborted'])('settles it as %s', (word) => {
    const settled = apply(apply([], asked), {
      id: '6',
      kind: 'approval_closed',
      ref: 'q1',
      text: word,
    });
    expect(settled[0]?.approval).toEqual({ id: 'q1', outcome: word });
  });

  it('calls a word it does not know cancelled, and leaves other lines alone', () => {
    const lines = apply([mine], asked);
    const settled = apply(lines, { id: '6', kind: 'approval_closed', ref: 'q1', text: 'odd' });
    expect(settled[0]).toEqual(mine);
    expect(settled[1]?.approval?.outcome).toBe('aborted');
    expect(
      apply(lines, { id: '7', kind: 'approval_closed', ref: 'other', text: 'denied' }),
    ).toEqual(lines);
    expect(apply(lines, { id: '8', kind: 'approval_closed', text: 'denied' })).toEqual(lines);
  });
});

class FakeSource {
  static all: FakeSource[] = [];
  listeners = new Map<string, (event: unknown) => void>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  closed = false;
  constructor(readonly url: string) {
    FakeSource.all.push(this);
  }
  addEventListener(kind: string, fn: (event: unknown) => void): void {
    this.listeners.set(kind, fn);
  }
  close(): void {
    this.closed = true;
  }
}

function setup(where: Standing) {
  vi.useFakeTimers();
  FakeSource.all = [];
  vi.stubGlobal('EventSource', FakeSource);
  const seen: unknown[] = [];
  const h: Handlers = {
    onEvent: (event) => seen.push(event),
    onOpen: vi.fn(),
    onBroken: vi.fn(),
    onEnded: vi.fn(),
  };
  const check = vi.fn(() => Promise.resolve(where));
  return { seen, h, check, stop: followEvents(h, check) };
}

function opened(index: number): void {
  FakeSource.all[index]?.onopen?.();
}

/** The browser gave up on stream number `index` (an HTTP error): closed, error fired. */
function die(index: number): void {
  const source = FakeSource.all[index];
  if (source === undefined) return;
  source.readyState = 2;
  source.onerror?.();
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function emit(kind: string, lastEventId: string, data: string, index = 0): void {
  FakeSource.all[index]?.listeners.get(kind)?.({ lastEventId, data });
}

describe('followEvents', () => {
  it('turns stream events into chat events and skips a malformed one', () => {
    const { seen, h, stop } = setup('in');
    emit('message', '4', '{"text":"Hi"}');
    emit('ack', '3', 'not json');
    emit('ack', '5', '{"ref":"u1"}');
    expect(seen).toEqual([
      { id: '4', kind: 'message', text: 'Hi' },
      { id: '5', kind: 'ack', ref: 'u1' },
    ]);
    opened(0);
    expect(h.onOpen).toHaveBeenCalledOnce();
    stop();
    expect(FakeSource.all[0]?.closed).toBe(true);
  });

  it('opens from the start, and reopens after the last event seen', async () => {
    setup('in');
    expect(FakeSource.all[0]?.url).toBe('/api/chat/events');
    emit('message', '9', '{"text":"Hi"}');
    die(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSource.all[1]?.url).toBe('/api/chat/events?after=9');
    emit('ack', '12', '{"ref":"u1"}', 1);
    die(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeSource.all[2]?.url).toBe('/api/chat/events?after=12');
  });

  it('encodes the last id into the address', async () => {
    setup('in');
    emit('message', '1&x=2', '{"text":"Hi"}');
    die(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSource.all[1]?.url).toBe('/api/chat/events?after=1%26x%3D2');
  });

  it('leaves a browser retry alone (still connecting)', async () => {
    const { h, check } = setup('in');
    FakeSource.all[0]?.onerror?.();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.onBroken).toHaveBeenCalledOnce();
    expect(check).not.toHaveBeenCalled();
    expect(FakeSource.all).toHaveLength(1);
  });

  it('reopens a closed stream with a growing pause while signed in', async () => {
    setup('in');
    die(0);
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeSource.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    die(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(FakeSource.all).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    opened(2);
    die(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSource.all).toHaveLength(4);
  });

  it.each(['out', 'change'] as const)('ends the chat when the session is %s', async (where) => {
    const { h } = setup(where);
    die(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.onEnded).toHaveBeenCalledOnce();
    expect(FakeSource.all).toHaveLength(1);
  });

  it('keeps trying when it cannot tell who is signed in', async () => {
    const { h } = setup('unknown');
    die(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSource.all).toHaveLength(2);
    expect(h.onEnded).not.toHaveBeenCalled();
  });
});

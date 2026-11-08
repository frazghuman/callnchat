/**
 * @jest-environment node
 */
import { RTCPeerConnection } from '@roamhq/wrtc';

import { PeerLink, type LinkDiagnostics, type Signal } from '../peerLink';
import type { DataChannelLike, PeerConnectionLike, RtcFactory } from '../types';

jest.setTimeout(20_000);

const rtc: RtcFactory = (config) => new RTCPeerConnection(config) as unknown as PeerConnectionLike;

/**
 * Two links whose signals are delivered by `deliver`, so tests can reorder or drop them like
 * public relays do.
 */
function pair(deliver: (to: 'a' | 'b', signals: Signal[]) => Signal[]) {
  const opened: Record<'a' | 'b', DataChannelLike | null> = { a: null, b: null };
  const closed: Record<'a' | 'b', LinkDiagnostics | null> = { a: null, b: null };
  const outbox: Record<'a' | 'b', Signal[]> = { a: [], b: [] };
  const make = (me: 'a' | 'b', initiator: boolean) =>
    new PeerLink({
      rtc,
      iceServers: [],
      initiator,
      connectTimeoutMs: 6_000,
      sendSignal: (s) => outbox[me === 'a' ? 'b' : 'a'].push(s),
      onOpen: (ch) => (opened[me] = ch),
      onClose: (_reason, d) => (closed[me] = d),
    });
  const links = { a: make('a', true), b: make('b', false) };
  const pump = setInterval(() => {
    for (const to of ['a', 'b'] as const) {
      const batch = outbox[to].splice(0);
      for (const s of deliver(to, batch)) void links[to].handleSignal(s);
    }
  }, 200);
  return { links, opened, closed, stop: () => clearInterval(pump) };
}

async function until(check: () => boolean, ms = 15_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

it('connects when relays deliver candidates before the offer', async () => {
  // Every batch arrives reversed: trickled candidates first, descriptions last.
  const p = pair((_to, signals) => signals.reverse());
  p.links.b.start(); // the non-initiator asks for a connection
  await until(() => !!p.opened.a && !!p.opened.b);
  p.links.a.close();
  p.stop();
});

it('connects even if every separate candidate message is lost', async () => {
  // Rate-limited relays: only the offer/answer get through; candidates must be inside them.
  const p = pair((_to, signals) => signals.filter((s) => s.kind !== 'ice'));
  p.links.a.start();
  await until(() => !!p.opened.a && !!p.opened.b);
  p.links.a.close();
  p.stop();
});

it('reports which address types were found when it gives up', async () => {
  // Answers never arrive: the initiator times out still in the signaling stage.
  const p = pair((to, signals) =>
    to === 'a' ? signals.filter((s) => s.kind !== 'answer') : signals,
  );
  p.links.a.start();
  await until(() => !!p.closed.a, 20_000);
  expect(p.closed.a).toMatchObject({ reason: 'timeout', stage: 'signaling' });
  expect(p.closed.a?.local).toContain('host');
  p.links.b.close();
  p.stop();
});

import type { Router } from 'express';
import { SSE_HEARTBEAT_MS } from './constants.ts';

/** What can change on screen. Each names the data a page re-reads; it carries no data itself. */
export type Topic = 'errors' | 'projects' | 'resolver';


/**
 * Tells the dashboard that something changed, so it reads again instead of asking on a timer.
 * A message is only a nudge naming a topic: the page fetches the data through the usual routes,
 * which keeps one place that decides what a browser may see.
 */
export class ChangeBus {
  private readonly listeners = new Set<(topic: Topic) => void>();

  publish(topic: Topic): void {
    for (const listener of this.listeners) listener(topic);
  }

  subscribe(listener: (topic: Topic) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** `GET /events`: a Server-Sent Events stream of `change` messages, one per topic that changed. */
export function eventRoutes(router: Router, bus: ChangeBus): void {
  router.get('/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('retry: 2000\n\n'); // how long the browser waits before reconnecting

    const unsubscribe = bus.subscribe((topic) => res.write(`event: change\ndata: ${JSON.stringify({ topic })}\n\n`));
    // A comment line every so often: keeps idle proxies from closing the stream and surfaces a dead peer.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), SSE_HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}

import { EventEmitter } from 'node:events';

/** In-process market event fabric bus (Part 29 L0 / Part 33.11). */
export type BusTopic =
  | 'ticker' | 'candle' | 'scan' | 'consensus' | 'decision' | 'order' | 'position'
  | 'risk' | 'alert' | 'news' | 'whale' | 'bot' | 'health' | 'mode' | 'notification' | 'knowledge';

class Bus extends EventEmitter {
  publish(topic: BusTopic, payload: unknown) { this.emit(topic, payload); this.emit('*', { topic, payload }); }
}
export const bus = new Bus();
bus.setMaxListeners(200);

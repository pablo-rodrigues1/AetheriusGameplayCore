import type { Hook, RuntimeMp } from './host.js';

/** Every host property hook and owned timer has one disposal path. */
export class Scope {
  private disposers = new Set<() => void>();
  private closed = false;
  add(dispose: () => void): () => void {
    if (this.closed) { dispose(); return () => {}; }
    const once = () => { this.disposers.delete(once); dispose(); };
    this.disposers.add(once);
    return once;
  }
  timeout(callback: () => void, ms: number): () => void {
    let cancel: () => void;
    const timer = setTimeout(() => { cancel(); if (!this.closed) callback(); }, ms);
    timer.unref();
    cancel = this.add(() => clearTimeout(timer));
    return cancel;
  }
  interval(callback: () => void, ms: number): void {
    const timer = setInterval(() => { if (!this.closed) callback(); }, ms);
    timer.unref(); this.add(() => clearInterval(timer));
  }
  close(): void { this.closed = true; for (const dispose of [...this.disposers]) dispose(); }
  get size(): number { return this.disposers.size; }
}

export class Hooks {
  private entries = new Map<string, { previous: Hook | undefined; dispatch: Hook; listeners: Set<Hook> }>();
  constructor(private mp: RuntimeMp | undefined, private scope: Scope, private warn: (s: string) => void) {}
  register(name: `on${string}`, listener: Hook): () => void {
    if (!/^on[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error('Invalid mp property hook name');
    if (!this.mp) throw new Error('UNSUPPORTED: host hook unavailable');
    let entry = this.entries.get(name);
    if (!entry) {
      const properties = this.mp as unknown as Record<string, Hook | undefined>;
      const previous = properties[name];
      const listeners = new Set<Hook>();
      const dispatch: Hook = (...args) => {
        let result: unknown;
        // Always call all owners; a synchronous veto wins over every other result.
        for (const fn of [previous, ...listeners]) if (fn) {
          try { const value = fn(...args); if (value === false || result !== false) result = value; }
          catch { this.warn(`hook ${name} failed`); }
        }
        return result;
      };
      entry = { previous, dispatch, listeners }; this.entries.set(name, entry);
      properties[name] = dispatch;
      this.scope.add(() => {
        listeners.clear();
        if (properties[name] === dispatch) properties[name] = previous;
        this.entries.delete(name);
      });
    }
    entry.listeners.add(listener);
    return this.scope.add(() => entry!.listeners.delete(listener));
  }
}

export type Listener<S> = (state: S, prev: S) => void;

/** A minimal immutable store: `set` shallow-merges and notifies listeners. */
export class Store<S extends object> {
  private readonly listeners = new Set<Listener<S>>();

  constructor(private state: S) {}

  get(): S {
    return this.state;
  }

  set(patch: Partial<S>): void {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    for (const listener of this.listeners) listener(this.state, prev);
  }

  subscribe(listener: Listener<S>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

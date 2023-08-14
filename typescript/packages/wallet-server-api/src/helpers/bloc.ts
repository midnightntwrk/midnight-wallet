import { Observable, scan, shareReplay, Subject } from 'rxjs';

import { StateUpdate } from './types';

export abstract class Bloc<T> {
  #stateChanges = new Subject<StateUpdate<T>>();

  state$: Observable<T>;

  protected constructor(initialState: T) {
    this.state$ = this.#stateChanges.pipe(
      scan((prev: T, update: StateUpdate<T>) => update(prev), initialState),
      shareReplay(1),
    );
    this.state$.subscribe({
      error: (err) => {
        console.log('Got error in bloc', this, err);
      },
    });
    this.#stateChanges.next((a) => a); // to run the state
  }

  protected updateState(cb: StateUpdate<T>): Observable<void> {
    return new Observable((observer) => {
      this.#stateChanges.next((prev) => {
        const next = cb(prev);
        setTimeout(() => {
          observer.next();
          observer.complete();
        }, 0);
        return next;
      });
    });
  }
}

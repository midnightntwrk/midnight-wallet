import React, { useEffect } from 'react';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import * as rx from 'rxjs';

const useAnimationFrame = (callback: (delta: number) => void) => {
  // Use useRef for mutable variables that we want to persist
  // without triggering a re-render on their change
  const requestRef = React.useRef(0);
  const previousTimeRef = React.useRef(0);

  const animate = (time: number) => {
    if (previousTimeRef.current != undefined) {
      const deltaTime = time - previousTimeRef.current;
      callback(deltaTime);
    }
    previousTimeRef.current = time;
    requestRef.current = requestAnimationFrame(animate);
  };

  React.useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current);
  }, []); // Make sure the effect runs only once
};

const useTiming = () => {
  const [startTime, setStartTime] = React.useState(0);
  React.useEffect(() => {
    setStartTime(performance.now());
  }, []);

  return {
    getElapsedTime: () => (performance.now() - startTime) / 1000,
  };
};

const useObservable = <T, TDef = T>(source$: rx.Observable<T>, defaultValue: TDef): T | TDef => {
  const [state, setState] = React.useState<T | TDef>(defaultValue);
  useEffect(() => {
    const subscription = source$.subscribe((state) => {
      setState(state);
    });
    return () => subscription.unsubscribe();
  }, []);

  return state;
};

export function Main(props: { wallet: WalletFacade }): React.ReactElement {
  return (
    <div>
      <UIUpdates wallet={props.wallet} />
    </div>
  );
}

type State = {
  count: number;
  deltas: number[];
  syncedTimes: number[];
};
const State = new (class {
  default: State = {
    count: 0,
    deltas: [],
    syncedTimes: [],
  };

  registerUpdate = (delta: number) => (state: State) => {
    if (this.hasSynced(state)) {
      return state;
    }
    return {
      ...state,
      count: state.count + 1,
      deltas: [...state.deltas, delta],
    };
  };

  setSyncedTime = (time: number) => (state: State) => {
    return {
      ...state,
      syncedTimes: [...state.syncedTimes, time],
    };
  };

  firstSyncedTime = (state: State) => {
    return state.syncedTimes[0];
  };

  hasSynced = (state: State) => {
    return state.syncedTimes.length > 0;
  };
})();

export function UIUpdates(props: { wallet: WalletFacade }): React.ReactElement {
  const { getElapsedTime } = useTiming();
  const [state, setState] = React.useState(State.default);
  const currentState = useObservable(props.wallet.state(), null);

  const time = getElapsedTime();

  useEffect(() => {
    if (currentState?.isSynced) {
      setState(State.setSyncedTime(time));
    }
  }, [currentState]);

  useAnimationFrame((deltaTime: number) => {
    setState(State.registerUpdate(deltaTime));
  });

  const timeToDisplay = State.firstSyncedTime(state) ?? time;

  return (
    <div>
      <p>
        Performed {state.count} UI updates within {timeToDisplay}s
      </p>
      <p>Should register around {timeToDisplay * 60} updates</p>
      <p>Acceptable minimum of updates is {timeToDisplay * 24}</p>
      {State.hasSynced(state) ? (
        <p>Got wallet synced after {State.firstSyncedTime(state)}s</p>
      ) : (
        <p>Wallet is not synced yet</p>
      )}
    </div>
  );
}

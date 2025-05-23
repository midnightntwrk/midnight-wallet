import { ProtocolState } from '../abstractions/index';
import { catchError, throwError, Observable } from 'rxjs';

/**
 * A utility type that ensures that a given type is `true` or otherwise forces a compile time error.
 *
 * @internal
 */
export type Expect<T extends true> = T;

/**
 * A utility type that exactly compares two types for equality.
 *
 * @internal
 */
export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

/**
 * Utility function that takes state values from an RxJS observable until it completes or errors.
 *
 * @param observable The RxJS observable from which state values should be read.
 * @param onErrCallback An optional callback to invoke if an error is encountered reading a state value.
 * @returns A `Promise` that resolves with an array of state values that were received before encountering
 * any error.
 *
 * @internal
 */
export const toProtocolStateArray = <T>(
  observable: Observable<ProtocolState<T>>,
  onErrCallback?: (err: unknown) => void,
): Promise<ProtocolState<T>[]> =>
  new Promise<ProtocolState<T>[]>((resolve) => {
    const receivedStates: ProtocolState<T>[] = [];

    observable
      .pipe(
        catchError((err) => {
          onErrCallback?.call(undefined, err);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return throwError(() => err);
        }),
      )
      .subscribe({
        next(value) {
          receivedStates.push(value);
        },
        complete() {
          resolve(receivedStates);
        },
        error() {
          resolve(receivedStates);
        },
      });
  });

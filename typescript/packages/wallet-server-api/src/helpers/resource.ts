import { pipe } from 'fp-ts/function';

import { block } from './functions';

export interface Allocated<T> {
  value: T;
  teardown: () => Promise<void>;
}

// A type, which handles resource allocation and deallocation, also in presence of errors
// For it to work well, it's important to always suspend side-effects, so, e.g. all promises need to be wrapped in thunks, etc.
// It's inspired a lot by Scala's cats-effect Resource type
export interface Resource<T> {
  // The most low-level representation of a resource
  // Prepare the value to use, and teardown manually later. Particularly useful in tests or to build other combinators on top of it
  allocate: () => Promise<Allocated<T>>;
}
export const Resource = block(() => {
  const make = <T>(setup: () => Promise<T>, teardown: (t: T) => Promise<void>): Resource<T> => {
    return {
      allocate: () => {
        return setup().then((value) => ({ value, teardown: () => teardown(value) }));
      },
    };
  };
  const fromPromise = <T>(thunk: () => Promise<T>): Resource<T> => {
    return {
      allocate: () => thunk().then((value) => ({ value, teardown: () => Promise.resolve(undefined) })),
    };
  };

  const allocate = <T>(resource: Resource<T>): Promise<Allocated<T>> => resource.allocate();

  // The most preferred way of using resource - pass a callback and don't care about anything
  const use =
    <T, S>(cb: (t: T) => Promise<S>) =>
    (resource: Resource<T>): Promise<S> =>
      resource.allocate().then((allocated) => cb(allocated.value).finally(() => allocated.teardown()));

  const map =
    <T, S>(cb: (t: T) => S) =>
    (resource: Resource<T>): Resource<S> => ({
      allocate: () =>
        resource.allocate().then((allocated) => ({
          ...allocated,
          value: cb(allocated.value),
        })),
    });

  const mapAsync =
    <T, S>(cb: (t: T) => Promise<S>) =>
    (resource: Resource<T>): Resource<S> => ({
      allocate: () =>
        resource.allocate().then((allocated) =>
          cb(allocated.value).then((value) => ({
            ...allocated,
            value,
          })),
        ),
    });

  const flatMap =
    <T, S>(cb: (t: T) => Resource<S>) =>
    (resource: Resource<T>): Resource<S> => ({
      allocate: () =>
        resource.allocate().then((tAllocated) =>
          cb(tAllocated.value)
            .allocate()
            .then(
              (sAllocated): Allocated<S> => ({
                value: sAllocated.value,
                teardown: () => sAllocated.teardown().finally(() => tAllocated.teardown()),
              }),
            ),
        ),
    });

  const zip =
    <S>(sResource: Resource<S>) =>
    <T>(tResource: Resource<T>): Resource<[T, S]> =>
      pipe(
        tResource,
        flatMap((t) =>
          pipe(
            sResource,
            map((s) => [t, s]),
          ),
        ),
      );

  return { fromPromise, make, use, allocate, map, mapAsync, flatMap, zip };
});

// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import { Effect, Stream, Context, Effectable, Option, identity } from 'effect';
import { type ClientError, type ServerError } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { SubscriptionClient } from './SubscriptionClient.js';
import type { Query } from './Query.js';

/**
 * Describes a subscription of elements from an invocable GraphQL query.
 */
export interface Subscription<
  R,
  V,
  F extends Subscription.SubscriptionFn<R, V> = Subscription.SubscriptionFn<R, V>,
> extends Effect.Effect<F> {
  readonly tag: Context.Tag<Subscription<R, V>, F>;
  readonly run: F;
}

export declare namespace Subscription {
  /**
   * Describes a function that streams a GraphQL subscription for some given variables.
   *
   * @param variables The variables to be used in the GraphQL query.
   * @returns A `Stream` that will yield the elements of the GraphQL subscription.
   */
  export type SubscriptionFn<R, V> = (variables: V) => Stream.Stream<R, ClientError | ServerError, SubscriptionClient>;
}

export const make: <Name extends string, T extends Query.Document<R, V>, R = Query.Result<T>, V = Query.Variables<T>>(
  name: Name,
  document: T,
) => Subscription<R, V> = <
  Name extends string,
  T extends Query.Document<R, V>,
  R = Query.Result<T>,
  V = Query.Variables<T>,
>(
  name: Name,
  document: T,
) => new SubscriptionImpl<R, V, T>(`${name}Subscription`, document);

class SubscriptionImpl<
  R,
  V,
  T extends Query.Document<R, V> = Query.Document<R, V>,
  F extends Subscription.SubscriptionFn<R, V> = Subscription.SubscriptionFn<R, V>,
>
  extends Effectable.Class<F>
  implements Subscription<R, V, F>
{
  readonly name: string;
  protected readonly document: T;

  constructor(name: string, document: T) {
    super();
    this.document = document;
    this.name = name;
    this.tag = Context.GenericTag(name);
    this.run = ((variables: V) => Stream.flatMap(this, (f) => f(variables))) as F;
  }

  readonly tag: Context.Tag<Subscription<R, V>, F>;
  readonly run: F;

  commit() {
    const self = this; // eslint-disable-line @typescript-eslint/no-this-alias
    return Effect.gen(function* () {
      return Option.match(yield* Effect.serviceOption(self.tag), {
        onSome: identity,
        onNone: () => self.defaultFn.bind(self) as F,
      });
    });
  }

  private defaultFn(variables: V): Stream.Stream<R, ClientError | ServerError, SubscriptionClient> {
    return SubscriptionClient.pipe(Stream.flatMap((client) => client.subscribe(this.document, variables)));
  }
}

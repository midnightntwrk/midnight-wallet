// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
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
/** Connector installation test suite. Tests Connector creation and injection into global namespace. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import type { InitialAPI } from '@midnightntwrk/dapp-connector-api';
import { InstallationError } from '../../index.js';
import { expectMatchObjectTyped } from '../testUtils.js';
import type { InstallationTestContext } from '../context.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

/** Run connector installation tests against the provided context. */
export const runInstallationTests = (context: InstallationTestContext): void => {
  describe('connector creation', () => {
    it('should create a connector instance with metadata', () => {
      const connector = context.createConnector();

      expect(connector).toBeDefined();
      expect(connector.name).toBeDefined();
      expect(connector.icon).toBeDefined();
      expect(connector.apiVersion).toBeDefined();
      expect(connector.rdns).toBeDefined();
    });

    it('should not install instance if just created', () => {
      context.createConnector();

      expect(context.installTarget.midnight).toBeUndefined();
    });
  });

  describe('installing', () => {
    beforeEach(() => {
      context.installTarget.midnight = {};
    });

    it('should install instance using a provided uuid', async () => {
      const uuid = crypto.randomUUID();
      const connector = context.createConnector();
      const installedConnector = await connector.install({ uuid, location: context.installTarget });

      expectMatchObjectTyped(context.installTarget.midnight![uuid], {
        name: installedConnector.connector.name,
        icon: installedConnector.connector.icon,
        apiVersion: installedConnector.connector.apiVersion,
        rdns: installedConnector.connector.rdns,
      });
      expect(Object.isFrozen(context.installTarget.midnight![uuid])).toBe(true);
    });

    it('should fail to install instance using a provided uuid if it already exists', async () => {
      const uuid = crypto.randomUUID();
      const connector = context.createConnector();

      await connector.install({ uuid, location: context.installTarget });

      await expect(connector.install({ uuid, location: context.installTarget })).rejects.toThrow(InstallationError);
    });

    it('should install instance using a random uuid', async () => {
      const connector = context.createConnector();
      const installedConnector = await connector.install({ location: context.installTarget });

      expectMatchObjectTyped(context.installTarget.midnight![installedConnector.uuid], {
        name: installedConnector.connector.name,
        icon: installedConnector.connector.icon,
        apiVersion: installedConnector.connector.apiVersion,
        rdns: installedConnector.connector.rdns,
      });
    });

    it('should install instance under specified object with a specified key', async () => {
      const target: { test?: Record<string, InitialAPI> } = {};
      const connector = context.createConnector();
      const installedConnector = await connector.install({ location: target, key: 'test' });

      expectMatchObjectTyped(target.test![installedConnector.uuid], {
        name: connector.name,
        icon: connector.icon,
        apiVersion: connector.apiVersion,
        rdns: connector.rdns,
      });
    });

    it('should install multiple connectors independently', async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(fc.constant(null), { minLength: 0, maxLength: 5 }), async (items) => {
          const target: { midnight?: Record<string, InitialAPI> } = { midnight: {} };
          const installedConnectors = await Promise.all(
            items.map(() => context.createConnector().install({ location: target })),
          );

          for (const installedConnector of installedConnectors) {
            expect(target.midnight).toHaveProperty(installedConnector.uuid);
            expectMatchObjectTyped(target.midnight![installedConnector.uuid], {
              name: installedConnector.connector.name,
              icon: installedConnector.connector.icon,
              apiVersion: installedConnector.connector.apiVersion,
              rdns: installedConnector.connector.rdns,
            });
          }
        }),
      );
    });

    it('should init the key in a safe way', async () => {
      const target: { test?: Record<string, InitialAPI> } = {};
      const connector = context.createConnector();

      await connector.install({ location: target, key: 'test' });
      const propertyDescriptor = Object.getOwnPropertyDescriptor(target, 'test');

      expectMatchObjectTyped(propertyDescriptor, {
        writable: false,
        enumerable: true,
        configurable: false,
      });
    });

    it('should install connector in a safe way', async () => {
      const target: { midnight?: Record<string, InitialAPI> } = {};
      const connector = context.createConnector();

      const installedConnector = await connector.install({ location: target });
      const propertyDescriptor = Object.getOwnPropertyDescriptor(target.midnight, installedConnector.uuid);

      expectMatchObjectTyped(propertyDescriptor, {
        writable: false,
        enumerable: true,
        configurable: false,
      });
      expect(Object.isFrozen(propertyDescriptor!.value)).toBe(true);
    });
  });
};

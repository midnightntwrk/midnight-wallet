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
import * as childProcess from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment } from 'testcontainers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 900_000, hookTimeout: 60_000 });

const NO_NET_SUFFIX = 'no-net';
const DEBUG_LOG_ENABLED = (process.env['DEBUG'] ?? '').includes('wallet:snippet');

const currentDir = path.dirname(new URL(import.meta.url).pathname);
const packageDir = path.resolve(currentDir, '..', '..');
const snippetsDir = path.resolve(currentDir, '..', 'snippets');

type Snippet = { name: string; path: string };
const snippetFiles = fs.readdirSync(snippetsDir).reduce(
  (acc, file) => {
    const resolvedPath = path.resolve(snippetsDir, file);
    const parsed = file.split('.');
    const target = parsed.includes(NO_NET_SUFFIX) ? acc.noNet : acc.net;
    target.push({ name: parsed[0], path: resolvedPath });
    return acc;
  },
  { net: [] as Snippet[], noNet: [] as Snippet[] },
);

class SnippetError extends Error {
  public readonly snippet: Snippet;
  public readonly result: childProcess.SpawnSyncReturns<string>;

  constructor(snippet: Snippet, result: childProcess.SpawnSyncReturns<string>) {
    super(
      `Snippet ${snippet.name} failed:
        status: ${result.status}
        stdout: ${result.stdout}
        stderr: ${result.stderr}
    `,
      { cause: result },
    );
    this.snippet = snippet;
    this.result = result;
  }
}

const runSnippet = async (
  snippet: Snippet,
  envExtension: Record<string, string> = {},
): Promise<readonly (string | null)[]> => {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn('node', ['--experimental-strip-types', '--no-warnings', snippet.path], {
      cwd: packageDir,
      env: {
        ...process.env,
        ...envExtension,
      },
    });

    let stdout = '';
    let stderr = '';

    // Log and capture stdout
    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (data: string) => {
        if (DEBUG_LOG_ENABLED) {
          console.log(data);
        }
        stdout += data;
      });
    }

    // Log and capture stderr
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (data: string) => {
        console.error(data);
        stderr += data;
      });
    }

    child.on('close', (code: number | null) => {
      // Format output to match spawnSync's result.output format
      // result.output should be [null, stdout, stderr], but we only return stdout to avoid capturing debug information
      const output: readonly (string | null)[] = [stdout];

      if (code !== 0 && code !== null) {
        const result = {
          status: code,
          stdout,
          stderr,
          output,
        } as childProcess.SpawnSyncReturns<string>;
        reject(new SnippetError(snippet, result));
      } else {
        resolve(output);
      }
    });

    child.on('error', (error: Error) => {
      reject(error);
    });
  });
};

const testSnippet = async (snippet: Snippet, envExtension: Record<string, string> = {}) => {
  const result = await runSnippet(snippet, envExtension);
  expect(result).toMatchSnapshot();
};

describe('Snippet outputs', () => {
  describe('without network', () => {
    it.each(snippetFiles.noNet)('should output the correct result for $name', (snippet) => testSnippet(snippet));
  });

  describe('with network', () => {
    let startedEnvironment: StartedDockerComposeEnvironment;
    let envExtension: Record<string, string>;

    beforeEach(async () => {
      const environmentId = randomUUID();

      const environmentVars = buildTestEnvironmentVariables(
        [
          'APP_INFRA_SECRET',
          'APP_INFRA_STORAGE_PASSWORD',
          'APP_INFRA_PUB_SUB_PASSWORD',
          'APP_INFRA_LEDGER_STATE_STORAGE_PASSWORD',
        ],
        {
          additionalVars: {
            TESTCONTAINERS_UID: environmentId,
            RAYON_NUM_THREADS: Math.min(os.availableParallelism(), 32).toString(10),
          },
        },
      );

      const environment = new DockerComposeEnvironment(
        getComposeDirectory(),
        'docker-compose-dynamic.yml',
      ).withEnvironment(environmentVars);

      startedEnvironment = await environment.up();

      envExtension = {
        INDEXER_PORT: startedEnvironment.getContainer(`indexer_${environmentId}`).getMappedPort(8088).toString(),
        NODE_PORT: startedEnvironment.getContainer(`node_${environmentId}`).getMappedPort(9944).toString(),
        PROOF_SERVER_PORT: startedEnvironment
          .getContainer(`proof-server_${environmentId}`)
          .getMappedPort(6300)
          .toString(),
      };
    });

    afterEach(async () => {
      await startedEnvironment?.down({ timeout: 10_000 });
    });

    it.each(snippetFiles.net)('should output the correct result for $name', (snippet) =>
      testSnippet(snippet, envExtension),
    );
  });
});

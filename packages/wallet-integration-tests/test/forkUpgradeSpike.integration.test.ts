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

/**
 * SPIKE — can the compose node be governance-upgraded from ledger-8 to ledger-9 _in place_, under testcontainers, with
 * no container restart at the boundary?
 *
 * This is deliberately node-only: no indexer, no wallet. It isolates the one mechanic the fork e2e depends on and that
 * nothing in this repo has ever exercised — driving a runtime upgrade from inside a vitest process that owns the stack,
 * rather than from a shell script with manual pause points.
 *
 * The shape follows the indexer's own rehearsal (`qa/scripts/test-hardfork-8to9.sh`), and its central choice is easy to
 * miss: the chain-spec comes from the _old_ node image, but the container that runs it for the whole test is the
 * _migration_ binary. The migration host functions have to be present from genesis, so the fork is a pure on-chain
 * runtime upgrade — nothing is swapped, stopped or restarted when it fires. That is what makes a live wallet across the
 * boundary possible at all.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DockerComposeEnvironment, GenericContainer, Wait, type StartedDockerComposeEnvironment } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 900_000, hookTimeout: 900_000 });

const REGISTRY = 'ghcr.io/midnight-ntwrk';
const FROM_NODE_TAG = '1.0.0'; // ledger-8, the tag infra/compose/docker-compose-dynamic.yml pins today
const TO_NODE_TAG = '2.1.0-beta.1'; // ledger-9 migration binary: boots a ledger-8 spec, carries migrate_state_v8_to_v9
const LEDGER_9_SPEC_VERSION = 2_000_000;

const exec = promisify(execFile);

/** Runs a docker command, returning stdout. Never piped — a masked non-zero exit is the trap this spike exists to avoid. */
const docker = async (args: string[]): Promise<string> => {
  const { stdout } = await exec('docker', args, { maxBuffer: 256 * 1024 * 1024 });
  return stdout;
};

/**
 * Runs a docker command with its stdout redirected to a file, then checks the file is non-empty.
 *
 * A shell redirect rather than a pipeline: a pipeline would report the _last_ command's status and mask a failed docker
 * run as success. The size check is the second half of that — verify the artifact, not just the exit code.
 */
const dockerToFile = async (args: string[], destination: string): Promise<void> => {
  await exec('/bin/sh', ['-c', `docker ${args.join(' ')} > ${destination}`], { maxBuffer: 16 * 1024 * 1024 });
  const { size } = await stat(destination);
  if (size === 0) throw new Error(`docker ${args.join(' ')} produced an empty ${destination}`);
};

const rpc = async (port: number, method: string, params: unknown[] = []): Promise<unknown> => {
  const response = await fetch(`http://localhost:${port}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
  });
  const body = (await response.json()) as { result?: unknown };
  return body.result;
};

const specVersion = async (port: number): Promise<number> => {
  const result = (await rpc(port, 'state_getRuntimeVersion')) as { specVersion: number } | undefined;
  return result?.specVersion ?? 0;
};

const finalizedHeight = async (port: number): Promise<number> => {
  const head = (await rpc(port, 'chain_getFinalizedHead')) as string | undefined;
  if (head === undefined) return 0;
  const header = (await rpc(port, 'chain_getHeader', [head])) as { number: string } | undefined;
  return header === undefined ? 0 : Number.parseInt(header.number, 16);
};

const poll = async <T>(
  what: string,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  attempts = 60,
): Promise<T> => {
  const last = await Array.from({ length: attempts }).reduce<Promise<T | undefined>>(async (previous, _, index) => {
    const settled = await previous;
    if (settled !== undefined && done(settled)) return settled;
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 3_000));
    return read().catch(() => undefined as T | undefined);
  }, Promise.resolve(undefined));
  if (last === undefined || !done(last)) throw new Error(`timed out waiting for ${what}, last value ${String(last)}`);
  return last;
};

/**
 * The node service from infra/compose/docker-compose-dynamic.yml with exactly two changes: the migration image, and the
 * chain-spec built from the old one. Everything else — caps, healthcheck, CFG_PRESET, the data volume — is kept so that
 * whatever this spike learns transfers to the shipped compose file unchanged.
 */
const composeFile = (chainspecHostPath: string, containerName: string): string => `
services:
  node:
    image: '${REGISTRY}/midnight-node:${TO_NODE_TAG}'
    container_name: ${containerName}
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - DAC_OVERRIDE
      - FOWNER
    ports:
      - '127.0.0.1::9944'
    volumes:
      - node-data:/data
      - ${chainspecHostPath}:/chainspec/chainspec.json:ro
    healthcheck:
      test:
        - 'CMD-SHELL'
        - >
          curl -fs -H 'Content-Type: application/json' -d
          '{"id":1,"jsonrpc":"2.0","method":"chain_getBlockHash","params":[1]}' http://localhost:9944 | grep -q
          '"result":"0x'
      interval: 2s
      timeout: 5s
      retries: 60
      start_period: 5s
    environment:
      CFG_PRESET: 'dev'
      CHAIN: '/chainspec/chainspec.json'
      SIDECHAIN_BLOCK_BENEFICIARY: '04bcf7ad3be7a5c790460be82a713af570f22e0f801f6659ab8e84a52be6969e'

volumes:
  node-data:
`;

describe('SPIKE: in-place governance upgrade of the compose node under testcontainers', () => {
  let environment: StartedDockerComposeEnvironment;
  let workDir: string;
  let networkName: string;
  let nodePort: number;
  let nodeContainerId: string;
  const nodeContainerName = `forkspike_node_${Date.now()}`;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'fork-spike-'));

    // Step 1 — the ledger-8 chain-spec, from the node tag the wallet's compose pins today.
    const chainspecPath = path.join(workDir, 'chainspec.json');
    await dockerToFile(
      ['run', '--rm', '-e', 'CFG_PRESET=dev', `${REGISTRY}/midnight-node:${FROM_NODE_TAG}`, 'build-spec'],
      chainspecPath,
    );

    // Step 2 — the ledger-9 runtime WASM. Passed explicitly rather than left to the image: an image built by
    // swapping only the binary into a 1.0.x base still embeds ledger-8, which makes the upgrade a silent no-op.
    const arch = (await docker(['version', '--format', '{{.Server.Arch}}'])).trim();
    const wasmInImage = `/artifacts-${arch === 'arm64' ? 'arm64' : 'amd64'}/midnight_node_runtime.compact.compressed.wasm`;
    const wasmPath = path.join(workDir, 'runtime.wasm');
    await dockerToFile(
      ['run', '--rm', '--entrypoint', 'cat', `${REGISTRY}/midnight-node:${TO_NODE_TAG}`, wasmInImage],
      wasmPath,
    );

    const composePath = path.join(workDir, 'docker-compose.yml');
    await writeFile(composePath, composeFile(chainspecPath, nodeContainerName), 'utf8');

    const projectName = `forkspike${Date.now()}`;
    // testcontainers addresses compose services by container name, so the compose file names it explicitly —
    // the same reason infra/compose/docker-compose-dynamic.yml carries `container_name: node_$TESTCONTAINERS_UID`.
    environment = await new DockerComposeEnvironment(workDir, 'docker-compose.yml')
      .withProjectName(projectName)
      .withWaitStrategy(nodeContainerName, Wait.forHealthCheck())
      .withStartupTimeout(300_000)
      .up();

    const node = environment.getContainer(nodeContainerName);
    nodePort = node.getMappedPort(9944);
    nodeContainerId = node.getId();
    [networkName] = node.getNetworkNames();
  });

  afterAll(async () => {
    await environment?.down({ timeout: 30_000 });
  });

  // No retry: a second attempt would boot a second stack and take another four minutes to reach the same verdict.
  it(
    'starts on ledger-8 and reaches ledger-9 by governance upgrade, without restarting the container',
    { retry: 0 },
    async () => {
      const preForkSpec = await poll(
        'a ledger-8 specVersion',
        () => specVersion(nodePort),
        (v) => v > 0,
      );
      expect(preForkSpec).toBeLessThan(LEDGER_9_SPEC_VERSION);

      // The upgrade is an extrinsic, so the chain has to be producing and finalizing blocks first.
      await poll(
        'finalized height >= 2',
        () => finalizedHeight(nodePort),
        (h) => h >= 2,
      );

      // The process id, not `RestartCount`: Docker 29 omits that field from container state entirely, and an
      // unchanged pid is the stronger claim anyway — the same OS process executed both runtimes.
      const pidBefore = (await docker(['inspect', '-f', '{{.State.Pid}}', nodeContainerId])).trim();
      const startedAtBefore = (await docker(['inspect', '-f', '{{.State.StartedAt}}', nodeContainerId])).trim();

      // Step 3 — the governance upgrade, driven from inside the test: a one-shot toolkit container attached to the
      // compose network, reaching the node by its service alias. This is the piece the shell script does with a
      // `docker run` and manual pauses, and the piece a vitest-owned stack has to be able to do for itself.
      const upgrader = await new GenericContainer(`${REGISTRY}/midnight-node-toolkit:${TO_NODE_TAG}`)
        .withNetworkMode(networkName)
        .withBindMounts([{ source: path.join(workDir, 'runtime.wasm'), target: '/wasm/runtime.wasm', mode: 'ro' }])
        .withCommand([
          'runtime-upgrade',
          '--wasm-file',
          '/wasm/runtime.wasm',
          '--rpc-url',
          'ws://node:9944',
          '-c',
          '//Eve',
          '-c',
          '//Ferdie',
          '-c',
          '//Dave',
          '-t',
          '//Alice',
          '-t',
          '//Bob',
          '-t',
          '//Charlie',
          '--signer-key',
          '//Alice',
        ])
        .withWaitStrategy(Wait.forOneShotStartup())
        .withStartupTimeout(300_000)
        .start();
      await upgrader.stop();

      const postForkSpec = await poll(
        'the specVersion to cross into ledger-9',
        () => specVersion(nodePort),
        (v) => v >= LEDGER_9_SPEC_VERSION,
      );
      expect(postForkSpec).toBeGreaterThanOrEqual(LEDGER_9_SPEC_VERSION);
      expect(postForkSpec).not.toEqual(preForkSpec);

      // The claim that matters for a live wallet: the chain crossed the boundary inside a process that never went
      // away. A restart here would mean any test built on this proves `restore()`, not `migrateState`.
      const pidAfter = (await docker(['inspect', '-f', '{{.State.Pid}}', nodeContainerId])).trim();
      const startedAtAfter = (await docker(['inspect', '-f', '{{.State.StartedAt}}', nodeContainerId])).trim();
      const running = (await docker(['inspect', '-f', '{{.State.Running}}', nodeContainerId])).trim();
      expect(pidAfter).toEqual(pidBefore);
      expect(startedAtAfter).toEqual(startedAtBefore);
      expect(running).toEqual('true');

      // And it is still producing blocks on the new runtime, not merely alive.
      const heightAtFork = await finalizedHeight(nodePort);
      await poll(
        'the chain to keep finalizing past the fork',
        () => finalizedHeight(nodePort),
        (h) => h > heightAtFork,
      );
    },
  );
});

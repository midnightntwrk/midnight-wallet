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
//
// The fixture behind the hard-fork e2e (`hardFork.fork.test.ts`): a chain whose genesis carries
// the pre-fork runtime, running on the post-fork binary, and the means to enact the fork on it.
//
// It is deliberately a sibling of `useTestContainersFixture` rather than a mode of it: the stack is
// a different compose file with one-shot services, and the lane is always `undeployed`, so the
// network-dependent accessors are pinned here instead of switching on `process.env.NETWORK`.
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnightntwrk/wallet-sdk-utilities/testing';
import { sleep } from './helpers/network.js';
import { TestContainersFixture } from './test-fixture.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

const COMPOSE_FILE = 'docker-compose-fork-dynamic.yml';

/** The runtime blob `runtime-blob` lifts out of the new node image, as the toolkit container sees it. */
const RUNTIME_WASM_PATH = '/runtime/midnight_node_runtime.compact.compressed.wasm';

/**
 * Image tags the lane may be pointed at, so a workflow input reaches compose unchanged. Every one has a default in the
 * compose file; only those actually set in the environment are forwarded.
 */
const IMAGE_TAG_VARIABLES = [
  'FORK_FROM_NODE_TAG',
  'NODE_TAG',
  'TOOLKIT_TAG',
  'INDEXER_TAG',
  'PROOF_SERVER_TAG',
] as const;

/** Services whose logs are streamed to disk, so a teardown does not take the evidence with it. */
const LOGGED_SERVICES = ['node', 'indexer', 'proof-server'] as const;

/**
 * `twox128("CNightObservation") ++ twox128(<item>)`. The cNIGHT dust replay is node-team territory: these are read and
 * logged after the fork, never asserted on.
 */
const CNIGHT_STORAGE_VERSION_KEY = '0xbbf4abef611bc3c9ca8cee3af9d8f7d14e7b9012096b41c4eb3aaf947f6ea429';
const CNIGHT_PRE_FORK_STATE_KEY = '0xbbf4abef611bc3c9ca8cee3af9d8f7d16eb91a45b805d9b33a9e2f6bb77968ee';

/** What the fork turned out to be, once it had been enacted and the chain had finalized past it. */
export type ForkEnactment = Readonly<{
  /** The spec version genesis was carrying. */
  oldSpecVersion: number;
  /** The spec version in force from the applying block onwards. */
  newSpecVersion: number;
  /** The height of the block that applied the new code. */
  appliedAt: number;
}>;

// ── JSON-RPC against the node's mapped port ───────────────────────────────────────────────────────

type RpcEnvelope<T> = Readonly<{ result?: T; error?: unknown }>;

const rpc = async <T>(url: string, method: string, params: readonly unknown[] = []): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
  });
  if (!response.ok) {
    throw new Error(`${method} -> HTTP ${response.status} ${response.statusText}`);
  }
  const envelope = (await response.json()) as RpcEnvelope<T>;
  if (envelope.error !== undefined) {
    throw new Error(`${method} -> ${JSON.stringify(envelope.error)}`);
  }
  return envelope.result as T;
};

const blockHashAt = (url: string, height: number): Promise<string> => rpc<string>(url, 'chain_getBlockHash', [height]);

const specVersionAt = async (url: string, blockHash?: string): Promise<number> =>
  (
    await rpc<Readonly<{ specVersion: number }>>(
      url,
      'state_getRuntimeVersion',
      blockHash === undefined ? [] : [blockHash],
    )
  ).specVersion;

const finalizedHeight = async (url: string): Promise<number> => {
  const head = await rpc<string>(url, 'chain_getFinalizedHead');
  const header = await rpc<Readonly<{ number: string }>>(url, 'chain_getHeader', [head]);
  return Number(header.number);
};

const waitForFinalized = async (url: string, height: number, deadline: number): Promise<number> => {
  const current = await finalizedHeight(url).catch(() => 0);
  if (current >= height) {
    logger.info(`finalized #${current} (waited for #${height})`);
    return current;
  }
  if (Date.now() >= deadline) {
    throw new Error(`Timed out waiting for finalized block #${height}; the chain is at #${current}`);
  }
  await sleep(3);
  return waitForFinalized(url, height, deadline);
};

/**
 * The first height reporting a spec version above `oldSpecVersion` — the block that applied the new code.
 * `spec_version` is monotonic along the chain, so the search is a bisection rather than a scan.
 */
const findApplyingBlock = async (url: string, oldSpecVersion: number, lo: number, hi: number): Promise<number> => {
  if (lo >= hi) {
    return lo;
  }
  const mid = lo + Math.floor((hi - lo) / 2);
  const spec = await specVersionAt(url, await blockHashAt(url, mid));
  return spec > oldSpecVersion
    ? findApplyingBlock(url, oldSpecVersion, lo, mid)
    : findApplyingBlock(url, oldSpecVersion, mid + 1, hi);
};

/**
 * Both read paths must answer at a given height: the node's own `midnight_*` RPC, and the runtime API through
 * `state_call`, which is the path subxt tooling (the indexer) takes and which does not go through the node's RPC layer
 * at all.
 */
const assertLedgerStateReadable = async (url: string, height: number, label: string): Promise<void> => {
  const hash = await blockHashAt(url, height);

  const root = await rpc<string | readonly unknown[] | null>(url, 'midnight_ledgerStateRoot', [hash]);
  const rootLength = typeof root === 'string' ? root.replace(/^0x/, '').length : Array.isArray(root) ? root.length : 0;
  if (rootLength === 0) {
    throw new Error(`midnight_ledgerStateRoot returned nothing at ${label} (#${height})`);
  }

  const encoded = await rpc<string>(url, 'state_call', ['MidnightRuntimeApi_get_ledger_state_root', '0x', hash]);
  if (!encoded.startsWith('0x00')) {
    throw new Error(
      `MidnightRuntimeApi_get_ledger_state_root returned an error at ${label} (#${height}): ${encoded.slice(0, 32)}`,
    );
  }
  logger.info(`ledger state readable at ${label} (#${height})`);
};

// ── The fixture ───────────────────────────────────────────────────────────────────────────────────

const reportsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'reports', 'fork-logs');

const imageTagOverrides = (): Record<string, string> =>
  IMAGE_TAG_VARIABLES.reduce<Record<string, string>>((collected, name) => {
    const value = process.env[name];
    return value === undefined || value === '' ? collected : { ...collected, [name]: value };
  }, {});

/**
 * Boots the fork stack for the file, and tears it down afterwards.
 *
 * @returns A getter for the fixture, valid from the first test onwards.
 */
export function useForkFixture(): () => ForkFixture {
  let fixture: ForkFixture | undefined;

  beforeAll(async () => {
    const uid = randomUUID();
    const environmentVars = buildTestEnvironmentVariables(['APP_INFRA_SECRET'], {
      additionalVars: { TESTCONTAINERS_UID: uid, ...imageTagOverrides() },
    });
    logger.info(`Spinning up the hard-fork stack (project fork-${uid})...`);

    const composeEnvironment: StartedDockerComposeEnvironment = await new DockerComposeEnvironment(
      getComposeDirectory(),
      COMPOSE_FILE,
    )
      // Named so the toolkit `run` can target the same project, and so a leftover stack is identifiable.
      .withProjectName(`fork-${uid}`)
      .withEnvironment(environmentVars)
      .withWaitStrategy(`chainspec_${uid}`, Wait.forOneShotStartup())
      .withWaitStrategy(`runtime-blob_${uid}`, Wait.forOneShotStartup())
      .withWaitStrategy(`node_${uid}`, Wait.forListeningPorts())
      // Probed from the host over the mapped port: the indexer image has no curl, so an in-container
      // healthcheck cannot answer this, and a listening port alone does not mean it is serving.
      .withWaitStrategy(`indexer_${uid}`, Wait.forHttp('/ready', TestContainersFixture.INDEXER_PORT))
      .withWaitStrategy(`proof-server_${uid}`, Wait.forListeningPorts())
      .withStartupTimeout(600_000)
      .up();

    fixture = new ForkFixture(composeEnvironment, uid, environmentVars);
    await fixture.captureContainerLogs();
    logger.info('Hard-fork stack started');
  }, 900_000);

  afterAll(async () => {
    logger.info('Tearing down the hard-fork stack...');
    await fixture?.down();
    logger.info('Hard-fork stack torn down');
  }, 120_000);

  return () => fixture!;
}

/**
 * The hard-fork e2e's stack, and the governance call that moves it across the boundary.
 *
 * @remarks
 *   Extends {@link TestContainersFixture} for the wallet-configuration accessors the rest of the e2e suite uses, and pins
 *   the network-dependent ones to the local stack: this lane is only ever `undeployed`, so reading
 *   `process.env.NETWORK` would add a way to misconfigure it and nothing else.
 */
export class ForkFixture extends TestContainersFixture {
  readonly #uid: string;
  readonly #environment: Record<string, string>;
  readonly #composeFile: string;
  readonly #projectName: string;

  constructor(composeEnvironment: StartedDockerComposeEnvironment, uid: string, environment: Record<string, string>) {
    super(composeEnvironment, uid);
    this.#uid = uid;
    this.#environment = environment;
    this.#composeFile = path.join(getComposeDirectory(), COMPOSE_FILE);
    this.#projectName = `fork-${uid}`;
  }

  public override getNetworkId(): NetworkId.NetworkId {
    return NetworkId.NetworkId.Undeployed;
  }

  public override getIndexerUri(): string {
    return `http://localhost:${this.#indexerPort()}/api/v3/graphql`;
  }

  public override getIndexerWsUri(): string {
    return `ws://localhost:${this.#indexerPort()}/api/v4/graphql/ws`;
  }

  public override getNodeUri(): string {
    return `ws://localhost:${this.#nodeRpcPort()}`;
  }

  /** The node's JSON-RPC endpoint over HTTP, which is how this fixture reads the chain. */
  public getNodeHttpUri(): string {
    return `http://localhost:${this.#nodeRpcPort()}`;
  }

  /** The spec version the runtime at the current best block reports. */
  public async specVersionAtHead(): Promise<number> {
    return specVersionAt(this.getNodeHttpUri());
  }

  /**
   * Streams the long-running services' container logs to `reports/fork-logs/`, so a failure leaves evidence behind:
   * testcontainers tears the stack down in `afterAll`, and a workflow-level `docker compose logs` afterwards would find
   * nothing.
   */
  public async captureContainerLogs(): Promise<void> {
    await fs.mkdir(reportsDirectory, { recursive: true });
    await Promise.all(
      LOGGED_SERVICES.map(async (service) => {
        const stream = await this.composeEnvironment.getContainer(`${service}_${this.#uid}`).logs();
        stream.pipe(createWriteStream(path.join(reportsDirectory, `${service}.log`)));
      }),
    );
  }

  /**
   * Enacts the ledger 8 to 9 hard fork on the running chain and waits for the chain to finalize past it.
   *
   * @remarks
   *   The governance seeds are the public Substrate development URIs (`//Alice` … `//Eve`) the dev preset's council and
   *   technical committee are built from — well-known constants, not secrets.
   *
   *   The toolkit runs through `docker compose run` rather than as a testcontainer so it joins the project network and
   *   reaches the node under its service name, exactly as running it by hand did.
   * @returns The spec versions either side of the boundary and the height at which the new code applied.
   * @throws If the governance call fails, if no block ever reports a higher spec version, or if the ledger state is
   *   unreadable at the boundary.
   */
  public async enactFork(): Promise<ForkEnactment> {
    const url = this.getNodeHttpUri();

    await waitForFinalized(url, 1, Date.now() + 180_000);
    const oldSpecVersion = await specVersionAt(url, await blockHashAt(url, 1));
    logger.info(`spec_version at #1: ${oldSpecVersion}`);

    await this.#runToolkitUpgrade();

    const head = await finalizedHeight(url);
    const appliedAt = await findApplyingBlock(url, oldSpecVersion, 1, head);
    const newSpecVersion = await specVersionAt(url, await blockHashAt(url, appliedAt));
    if (newSpecVersion <= oldSpecVersion) {
      throw new Error(`No code-applying block found (spec ${oldSpecVersion}, head #${head})`);
    }
    logger.info(`new code applied at #${appliedAt} (was spec ${oldSpecVersion}, now ${newSpecVersion})`);

    await waitForFinalized(url, appliedAt + 1, Date.now() + 300_000);
    await assertLedgerStateReadable(url, appliedAt - 1, 'pre-fork');
    await assertLedgerStateReadable(url, appliedAt, 'code-applied block');
    await assertLedgerStateReadable(url, appliedAt + 1, 'post-migration');

    await this.#logCNightReplay(url, appliedAt + 3);

    return { oldSpecVersion, newSpecVersion, appliedAt };
  }

  #indexerPort(): number {
    return this.getIndexerContainer().getMappedPort(TestContainersFixture.INDEXER_PORT);
  }

  #nodeRpcPort(): number {
    return this.getNodeContainer().getMappedPort(TestContainersFixture.NODE_PORT_RPC);
  }

  async #runToolkitUpgrade(): Promise<void> {
    const args = [
      'compose',
      '-f',
      this.#composeFile,
      '-p',
      this.#projectName,
      '--profile',
      'tools',
      'run',
      '--rm',
      'toolkit',
      'runtime-upgrade',
      '--wasm-file',
      RUNTIME_WASM_PATH,
      '-c',
      '//Dave',
      '-c',
      '//Eve',
      '-t',
      '//Alice',
      '-t',
      '//Bob',
      '--rpc-url',
      'ws://node:9944',
      '--signer-key',
      '//Alice',
    ];
    logger.info('Enacting the hard fork (governance set_code) through the node toolkit...');

    const outcome = await execFileAsync('docker', args, {
      env: { ...process.env, ...this.#environment },
      maxBuffer: 32 * 1024 * 1024,
    }).then(
      ({ stdout, stderr }) => ({ stdout, stderr, failure: undefined }),
      (error: unknown) => {
        const detail = error as Readonly<{ stdout?: string; stderr?: string }>;
        return {
          stdout: detail.stdout ?? '',
          stderr: detail.stderr ?? '',
          failure: error instanceof Error ? error.message : JSON.stringify(error),
        };
      },
    );

    await fs.writeFile(
      path.join(reportsDirectory, 'toolkit.log'),
      `$ docker ${args.join(' ')}\n\n--- stdout ---\n${outcome.stdout}\n--- stderr ---\n${outcome.stderr}\n`,
      'utf-8',
    );
    if (outcome.failure !== undefined) {
      throw new Error(
        `The toolkit's runtime-upgrade failed: ${outcome.failure}\nstderr:\n${outcome.stderr.slice(-4000)}`,
      );
    }
    logger.info('Governance runtime-upgrade submitted');
  }

  /**
   * Reports the cNIGHT dust-generation replay (`pallet-cnight-observation` v1 to v2) without gating on it: storage
   * version `0x0200` with `PreForkStateKey` cleared is the wound-up state, but whether the replay restored anything is
   * the node team's question, not the wallet's.
   */
  async #logCNightReplay(url: string, height: number): Promise<void> {
    await waitForFinalized(url, height, Date.now() + 300_000);
    const hash = await blockHashAt(url, height);
    const [storageVersion, preForkStateKey] = await Promise.all([
      rpc<string | null>(url, 'state_getStorage', [CNIGHT_STORAGE_VERSION_KEY, hash]),
      rpc<string | null>(url, 'state_getStorage', [CNIGHT_PRE_FORK_STATE_KEY, hash]),
    ]);
    logger.info(
      `INFO cnight-observation at #${height}: storageVersion=${String(storageVersion)} (expected 0x0200),` +
        ` PreForkStateKey=${String(preForkStateKey)} (expected null)`,
    );
  }
}

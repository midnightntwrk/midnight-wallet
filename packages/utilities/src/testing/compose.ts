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
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Gets the absolute path to the repository root directory.
 *
 * @returns The absolute path to the repository root
 */
export function getRepositoryRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);

  return path.resolve(currentDir, '../../../../');
}

/**
 * Gets the absolute path to the docker compose directory.
 *
 * @returns The absolute path to the compose directory
 */
export function getComposeDirectory(): string {
  const repoRoot = getRepositoryRoot();
  return path.join(repoRoot, 'infra', 'compose');
}

/**
 * Options for building test environment variables.
 */
export interface BuildTestEnvironmentVariablesOptions {
  /**
   * Additional environment variables to include.
   * These will be merged with the variables collected from process.env.
   */
  additionalVars?: Record<string, string>;
}

/**
 * Builds and validates environment variables for test containers.
 * Throws an error if any required environment variable from envVarsToPass is missing.
 *
 * @param envVarsToPass - Array of environment variable names to collect from process.env
 * @param options - Optional configuration for building environment variables
 * @returns Record of environment variables to pass to Docker Compose
 */
export function buildTestEnvironmentVariables(
  envVarsToPass: readonly string[],
  options?: BuildTestEnvironmentVariablesOptions,
): Record<string, string> {
  // Add any additional vars first (so they can be overridden by process.env vars if needed)
  const environmentVars: Record<string, string> = {
    ...options?.additionalVars,
  };

  // Collect and validate required environment variables
  for (const envVar of envVarsToPass) {
    const value = process.env[envVar];
    if (value) {
      environmentVars[envVar] = value;
    } else {
      throw new Error(
        `Required environment variable ${envVar} is not set. Please ensure it is exported in your shell or CI environment.`,
      );
    }
  }

  return environmentVars;
}

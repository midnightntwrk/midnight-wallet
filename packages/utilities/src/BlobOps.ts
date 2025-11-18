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
/**
 * Browser-compatible utility for converting a Blob to Uint8Array.
 * Uses arrayBuffer() instead of bytes() for broader browser support.
 *
 * @param blob The Blob to convert to bytes
 * @returns A Promise that resolves to a Uint8Array containing the blob's bytes
 */
export const getBytes = (blob: Blob): Promise<Uint8Array> => blob.arrayBuffer().then((ab) => new Uint8Array(ab));

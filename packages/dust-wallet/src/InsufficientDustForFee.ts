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
import { type InsufficientDustForFeeError as V1InsufficientDustForFeeError } from './v1/WalletError.js';
import { type InsufficientDustForFeeError as V2InsufficientDustForFeeError } from './v2/WalletError.js';

export const isInsufficientDustForFeeError = (
  _error: unknown,
): _error is V1InsufficientDustForFeeError | V2InsufficientDustForFeeError => false;

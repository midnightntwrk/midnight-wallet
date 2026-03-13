/**
 * Parsing functions for DApp Connector API inputs.
 *
 * These are standalone pure functions that can be reused by any DApp Connector
 * implementation. They parse API inputs into internal types, throwing APIError
 * on validation failures.
 */
import type { DesiredInput, DesiredOutput } from '@midnight-ntwrk/dapp-connector-api';
import { MidnightBech32m, ShieldedAddress, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import type {
  CombinedTokenTransfer,
  ShieldedTokenTransfer,
  UnshieldedTokenTransfer,
  CombinedSwapInputs,
} from './types.js';
import { APIError } from './errors.js';

/**
 * Parses a token type string into a validated RawTokenType.
 * @throws APIError.invalidRequest if the token type is invalid
 */
export const parseTokenType = (tokenType: string, fieldName: string): ledger.RawTokenType => {
  if (typeof tokenType !== 'string') {
    throw APIError.invalidRequest(`${fieldName}: token type must be a string`);
  }
  if (tokenType.length !== 64) {
    throw APIError.invalidRequest(
      `${fieldName}: token type must be 64 hex characters (256-bit hash), got ${tokenType.length}`,
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(tokenType)) {
    throw APIError.invalidRequest(`${fieldName}: token type must be a valid hex string`);
  }
  return tokenType as ledger.RawTokenType;
};

/**
 * Parses an amount into a validated positive bigint.
 * @throws APIError.invalidRequest if the amount is invalid
 */
export const parsePositiveAmount = (amount: bigint, fieldName: string): bigint => {
  if (typeof amount !== 'bigint') {
    throw APIError.invalidRequest(`${fieldName}: amount must be a bigint`);
  }
  if (amount <= 0n) {
    throw APIError.invalidRequest(`${fieldName}: amount must be positive, got ${amount}`);
  }
  return amount;
};

/**
 * Parses a Bech32m string into a ShieldedAddress.
 * @throws APIError.invalidRequest if the address is invalid
 */
export const parseShieldedAddress = (address: string, networkId: string, fieldName: string): ShieldedAddress => {
  if (typeof address !== 'string' || address.length === 0) {
    throw APIError.invalidRequest(`${fieldName}: address must be a non-empty string`);
  }

  try {
    const parsed = MidnightBech32m.parse(address);
    if (parsed.type !== 'shield-addr') {
      throw APIError.invalidRequest(`${fieldName}: expected shielded address (shield-addr), got ${parsed.type}`);
    }
    return parsed.decode(ShieldedAddress, networkId);
  } catch (e) {
    if (APIError.isAPIError(e)) {
      throw e;
    }
    throw APIError.invalidRequest(`${fieldName}: invalid Bech32m address format`);
  }
};

/**
 * Parses a Bech32m string into an UnshieldedAddress.
 * @throws APIError.invalidRequest if the address is invalid
 */
export const parseUnshieldedAddress = (address: string, networkId: string, fieldName: string): UnshieldedAddress => {
  if (typeof address !== 'string' || address.length === 0) {
    throw APIError.invalidRequest(`${fieldName}: address must be a non-empty string`);
  }

  try {
    const parsed = MidnightBech32m.parse(address);
    if (parsed.type !== 'addr') {
      throw APIError.invalidRequest(`${fieldName}: expected unshielded address (addr), got ${parsed.type}`);
    }
    return parsed.decode(UnshieldedAddress, networkId);
  } catch (e) {
    if (APIError.isAPIError(e)) {
      throw e;
    }
    throw APIError.invalidRequest(`${fieldName}: invalid Bech32m address format`);
  }
};

/**
 * Parses an intentId into a valid segment ID or undefined for 'random'.
 * Segment 0 is reserved for the guaranteed section and cannot be used for intents.
 * @throws APIError.invalidRequest if the intentId is invalid
 */
export const parseIntentId = (intentId: number | 'random'): number | undefined => {
  if (intentId === 'random') {
    return undefined;
  }
  if (!Number.isInteger(intentId) || intentId < 1 || intentId > 65535) {
    throw APIError.invalidRequest('intentId must be an integer between 1 and 65535 (segment 0 is reserved)');
  }
  return intentId;
};

/**
 * Parses DesiredOutput[] into CombinedTokenTransfer[].
 * @throws APIError.invalidRequest if any output is invalid
 */
export const parseDesiredOutputs = (
  outputs: DesiredOutput[],
  networkId: string,
  options: { requireAtLeastOne: boolean },
): CombinedTokenTransfer[] => {
  if (options.requireAtLeastOne && outputs.length === 0) {
    throw APIError.invalidRequest('At least one output is required');
  }

  const indexed = outputs.map((output, index) => ({ output, index }));

  const shieldedTransfer: ShieldedTokenTransfer | undefined = (() => {
    const shielded = indexed.filter(({ output }) => output.kind === 'shielded');
    if (shielded.length === 0) return undefined;
    return {
      type: 'shielded' as const,
      outputs: shielded.map(({ output, index }) => ({
        type: parseTokenType(output.type, `outputs[${index}].type`),
        receiverAddress: parseShieldedAddress(output.recipient, networkId, `outputs[${index}].recipient`),
        amount: parsePositiveAmount(output.value, `outputs[${index}].value`),
      })),
    };
  })();

  const unshieldedTransfer: UnshieldedTokenTransfer | undefined = (() => {
    const unshielded = indexed.filter(({ output }) => output.kind === 'unshielded');
    if (unshielded.length === 0) return undefined;
    return {
      type: 'unshielded' as const,
      outputs: unshielded.map(({ output, index }) => ({
        type: parseTokenType(output.type, `outputs[${index}].type`),
        receiverAddress: parseUnshieldedAddress(output.recipient, networkId, `outputs[${index}].recipient`),
        amount: parsePositiveAmount(output.value, `outputs[${index}].value`),
      })),
    };
  })();

  return [shieldedTransfer, unshieldedTransfer].filter((t): t is CombinedTokenTransfer => t !== undefined);
};

/**
 * Parses DesiredInput[] into CombinedSwapInputs.
 * @throws APIError.invalidRequest if any input is invalid
 */
export const parseDesiredInputs = (inputs: DesiredInput[]): CombinedSwapInputs => {
  const indexed = inputs.map((input, index) => ({ input, index }));

  const aggregateByTokenType = (
    items: Array<{ input: DesiredInput; index: number }>,
    fieldPrefix: string,
  ): Record<ledger.RawTokenType, bigint> | undefined => {
    if (items.length === 0) return undefined;
    return items.reduce(
      (acc, { input, index }) => {
        const tokenType = parseTokenType(input.type, `${fieldPrefix}[${index}].type`);
        const amount = parsePositiveAmount(input.value, `${fieldPrefix}[${index}].value`);
        return { ...acc, [tokenType]: (acc[tokenType] ?? 0n) + amount };
      },
      {} as Record<ledger.RawTokenType, bigint>,
    );
  };

  const shielded = aggregateByTokenType(
    indexed.filter(({ input }) => input.kind === 'shielded'),
    'inputs',
  );
  const unshielded = aggregateByTokenType(
    indexed.filter(({ input }) => input.kind === 'unshielded'),
    'inputs',
  );

  return {
    ...(shielded !== undefined ? { shielded } : {}),
    ...(unshielded !== undefined ? { unshielded } : {}),
  };
};

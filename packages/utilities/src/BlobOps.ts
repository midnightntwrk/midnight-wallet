/**
 * Browser-compatible utility for converting a Blob to Uint8Array.
 * Uses arrayBuffer() instead of bytes() for broader browser support.
 *
 * @param blob The Blob to convert to bytes
 * @returns A Promise that resolves to a Uint8Array containing the blob's bytes
 */
export const getBytes = (blob: Blob): Promise<Uint8Array> => blob.arrayBuffer().then((ab) => new Uint8Array(ab));

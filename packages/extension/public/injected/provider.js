const ALLOWED_MESSAGE_TYPES = [
  'MIDNIGHT_CONNECT',
  'MIDNIGHT_DISCONNECT',
  'MIDNIGHT_GET_ACCOUNTS',
  'MIDNIGHT_SIGN_TRANSACTION',
  'MIDNIGHT_SEND_TRANSACTION',
];

function isValidResponse(data) {
  if (typeof data !== 'object' || data === null) return false;
  if (typeof data.type !== 'string') return false;
  return ALLOWED_MESSAGE_TYPES.some(t => data.type.startsWith(t));
}

class MidnightProvider {
  constructor() {
    this._pendingRequests = new Map();
    this._requestId = 0;
    this._isConnected = false;
    this._accounts = [];
    this._setupMessageListener();
  }

  _setupMessageListener() {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.origin !== window.location.origin) return;
      if (!isValidResponse(event.data)) return;

      const { id, type, result, error } = event.data;
      if (id && this._pendingRequests.has(id)) {
        const { resolve, reject } = this._pendingRequests.get(id);
        this._pendingRequests.delete(id);
        if (error) {
          reject(new Error(error.message || 'Unknown error'));
        } else {
          resolve(result);
        }
      }
    });
  }

  _sendMessage(type, payload) {
    return new Promise((resolve, reject) => {
      const id = `${++this._requestId}`;
      this._pendingRequests.set(id, { resolve, reject });
      window.postMessage({ type, payload, id }, window.location.origin);
      setTimeout(() => {
        if (this._pendingRequests.has(id)) {
          this._pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  async connect() {
    const result = await this._sendMessage('MIDNIGHT_CONNECT', {});
    this._isConnected = true;
    this._accounts = result.accounts || [];
    return { accounts: this._accounts };
  }

  async disconnect() {
    await this._sendMessage('MIDNIGHT_DISCONNECT', {});
    this._isConnected = false;
    this._accounts = [];
  }

  async getAccounts() {
    return this._sendMessage('MIDNIGHT_GET_ACCOUNTS', {});
  }

  async signTransaction(transaction) {
    return this._sendMessage('MIDNIGHT_SIGN_TRANSACTION', { transaction });
  }

  async sendTransaction(signedTransaction) {
    return this._sendMessage('MIDNIGHT_SEND_TRANSACTION', { signedTransaction });
  }

  get isConnected() {
    return this._isConnected;
  }

  get accounts() {
    return this._accounts;
  }
}

if (typeof window.midnight === 'undefined') {
  window.midnight = new MidnightProvider();
  window.dispatchEvent(new Event('midnight#initialized'));
}

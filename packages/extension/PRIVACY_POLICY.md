# Privacy Policy

**Midnight Wallet Chrome Extension**
**Last Updated:** December 3, 2025

## Overview

Midnight Wallet is a browser extension that allows users to manage their Midnight blockchain assets securely. We are committed to protecting your privacy and ensuring the security of your personal information.

## Data Collection

### What We Do NOT Collect

- **Private Keys or Seed Phrases**: Your cryptographic keys never leave your device
- **Personal Identification**: We do not collect names, emails, or identifying information
- **Browsing History**: We do not track your browsing activity
- **IP Addresses**: We do not log or store IP addresses
- **Analytics Data**: We do not use third-party analytics services

### What Is Stored Locally

The following data is stored **only on your device** using browser local storage:

- **Encrypted Wallet Data**: Your seed phrase encrypted with AES-256-GCM
- **Wallet Names**: User-defined names for wallets
- **Session Information**: Temporary session tokens (auto-expire)
- **Settings**: Lock timeout preferences
- **Connected dApps**: List of approved dApp origins

## Data Security

### Encryption

- Seed phrases are encrypted using AES-256-GCM
- Encryption keys are derived using PBKDF2 with 600,000 iterations
- Each wallet uses a unique 32-byte random salt
- Decrypted data exists only in memory during active sessions

### Local Storage

- All data is stored in IndexedDB within your browser
- Data never leaves your device
- No cloud synchronization or backup services

## Network Communications

### When We Connect to External Services

1. **Midnight Network**: Transaction submission and balance queries
2. **Indexer Service**: Blockchain state synchronization
3. **Prover Service**: Zero-knowledge proof generation

### What Is Transmitted

- Public addresses (for balance queries)
- Transaction data (for submission)
- No private keys or seed phrases are ever transmitted

## dApp Connections

When you connect to decentralized applications:

- You explicitly approve each connection
- You approve each transaction signing request
- You can revoke connections at any time
- Connection origins are stored locally

## Third-Party Services

This extension does not:

- Use third-party analytics (Google Analytics, Mixpanel, etc.)
- Include advertising SDKs
- Share data with third parties
- Use telemetry services

## User Rights

You have complete control over your data:

- **Access**: View all stored data via browser developer tools
- **Delete**: Remove all data by uninstalling the extension
- **Export**: Export your seed phrase at any time
- **Revoke**: Disconnect from any dApp

## Data Retention

- Encrypted wallet data persists until you delete it
- Session data auto-expires based on your timeout setting
- No data is retained on external servers

## Children's Privacy

This extension is not intended for use by individuals under 18 years of age. We do not knowingly collect information from children.

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be reflected in the "Last Updated" date. Continued use of the extension constitutes acceptance of the updated policy.

## Open Source

Midnight Wallet is open source software. You can review the source code to verify our privacy practices:

- Repository: https://github.com/midnightntwrk/midnight-wallet

## Contact

For privacy-related questions or concerns:

- Open an issue on GitHub
- Contact the Midnight Foundation

## Compliance

This extension is designed to comply with:

- Chrome Web Store Developer Program Policies
- GDPR principles (data minimization, purpose limitation)
- Browser extension security best practices

## Summary

**We believe in privacy by design:**

✅ Your keys stay on your device
✅ No data collection or tracking
✅ Full transparency through open source
✅ You control your data completely

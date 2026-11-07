import { useState } from 'react';
// In your own app, import from the package: import { SubscribeButton } from 'recurring-checkout';
import { SubscribeButton, type SubscribeError } from '../../src/index';

/**
 * Settings of the public testnet deployment (see https://github.com/Cadence-Pay/recurring-contracts/blob/main/docs/TESTNET.md). Testnet is
 * wiped on 2026-12-16; after that, deploy your own contract and change these values.
 */
export const EXAMPLE = {
  planId: 1,
  contractId: 'CCUXOGU3N5HWMLRDXC5TCQ3QDA23X3RJCDXWHMBIC4SFLD2IABQT465E',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
} as const;

/** A shop page with the subscribe button and a log of what the callbacks received. */
export function App() {
  const [log, setLog] = useState('Nothing has happened yet.');
  return (
    <main className="shop">
      <h1>Example shop</h1>
      <p>Get the newsletter, paid in testnet XLM. This page runs on the Stellar test network.</p>
      <SubscribeButton
        {...EXAMPLE}
        onSuccess={(result) => {
          setLog(`onSuccess: ${JSON.stringify(result, null, 2)}`);
        }}
        onError={(error: SubscribeError) => {
          setLog(
            `onError: ${error.code} at step "${error.step}", approved: ${String(error.approved)}`,
          );
        }}
      />
      <h2>What the callbacks received</h2>
      <pre aria-live="polite">{log}</pre>
    </main>
  );
}

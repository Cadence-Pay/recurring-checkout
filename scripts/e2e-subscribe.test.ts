// @vitest-environment node
/*
 * End-to-end step for the runs described in e2e-testnet.md.
 *
 * It runs the widget's real subscribe flow (balance check, token approval, subscription) against a
 * real contract. The "wallet" is the Stellar CLI: it signs with a key that is stored under a NAME in
 * the CLI's key store, so no secret key is ever passed to, printed by or stored by this code.
 *
 * It SPENDS funds and creates a real subscription, so it only runs when E2E_RUN=1 and all of
 * these are given:
 *
 *   E2E_NETWORK             testnet (or mainnet, see below)
 *   E2E_RPC_URL             the RPC server
 *   E2E_NETWORK_PASSPHRASE  must match the network
 *   E2E_SIGN_IDENTITY       NAME of a CLI identity, for example recurring-subscriber
 *   E2E_PLAN_ID             the plan to subscribe to
 *   E2E_CONTRACT_ID         the deployed recurring contract
 *
 * Mainnet is refused unless E2E_ALLOW_MAINNET=yes is also set, which only the owner does, for one
 * run, because on mainnet this spends real money.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createCheckoutChain } from '../src/chain';
import { runSubscribeFlow, type FlowStep } from '../src/flow';
import { computeApproval, DEFAULT_MAX_APPROVAL_LEDGERS, DEFAULT_MAX_CHARGES } from '../src/terms';
import type { WalletAdapter } from '../src/wallet';
import { checkIdentityName, readE2eNetwork, type E2eNetwork } from './e2e-config';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required for the E2E run`);
  return value;
}

/** A wallet that signs by asking the Stellar CLI to use the named identity. */
function cliWallet(identity: string, net: E2eNetwork): WalletAdapter {
  const address = execFileSync('stellar', ['keys', 'address', identity], {
    encoding: 'utf8',
  }).trim();
  return {
    connect: () => Promise.resolve({ address, networkPassphrase: net.passphrase }),
    signTransaction: (xdr) =>
      Promise.resolve(
        execFileSync(
          'stellar',
          [
            'tx',
            'sign',
            '--sign-with-key',
            identity,
            '--rpc-url',
            net.rpcUrl,
            '--network-passphrase',
            net.passphrase,
            '--quiet',
          ],
          { input: xdr, encoding: 'utf8' },
        ).trim(),
      ),
  };
}

describe.skipIf(process.env['E2E_RUN'] !== '1')('end to end subscribe', () => {
  it('subscribes through the widget flow', async () => {
    const net = readE2eNetwork(process.env);
    const identity = checkIdentityName(process.env['E2E_SIGN_IDENTITY']);
    const planId = Number(required('E2E_PLAN_ID'));
    const contractId = required('E2E_CONTRACT_ID');

    const chain = createCheckoutChain({
      contractId,
      rpcUrl: net.rpcUrl,
      networkPassphrase: net.passphrase,
    });
    const terms = await chain.getPlanTerms(planId);
    const approval = computeApproval({
      amount: terms.amount,
      periodSecs: terms.periodSecs,
      maxCharges: DEFAULT_MAX_CHARGES,
      maxLedgers: DEFAULT_MAX_APPROVAL_LEDGERS,
    });
    const steps: FlowStep[] = [];
    const result = await runSubscribeFlow({
      chain,
      wallet: cliWallet(identity, net),
      contractId,
      networkPassphrase: net.passphrase,
      terms,
      approval,
      skipApproval: false,
      onStep: (s) => steps.push(s),
    });
    process.stdout.write(
      `E2E_RESULT ${JSON.stringify({
        ...result,
        network: net.label,
        steps,
        plan: { amount: terms.amount.toString(), periodSecs: terms.periodSecs },
        approval: { cap: approval.cap.toString(), charges: approval.coveredCharges },
      })}\n`,
    );
    expect(result.subscriptionId).toBeGreaterThan(0);
    expect(steps).toEqual(['connecting', 'checking', 'approving', 'subscribing']);
  }, 240_000);
});

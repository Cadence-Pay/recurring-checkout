// @vitest-environment node
/*
 * End-to-end step for the testnet run described in e2e-testnet.md.
 *
 * It runs the widget's real subscribe flow (balance check, token approval, subscription) against
 * the real testnet contract. The "wallet" is the Stellar CLI: it signs with a key that is stored
 * under a NAME in the CLI's key store, so no secret key is ever passed to, printed by or stored by
 * this code. It SPENDS testnet funds and creates a real subscription, so it only runs when
 * E2E_TESTNET=1 and the settings below are given:
 *
 *   E2E_SIGN_IDENTITY  name of a CLI identity on testnet, for example recurring-subscriber
 *   E2E_PLAN_ID        the plan to subscribe to
 *   E2E_CONTRACT_ID    the deployed recurring contract
 *
 * Testnet only. It refuses to run for any other network.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createCheckoutChain } from '../src/chain';
import { runSubscribeFlow, type FlowStep } from '../src/flow';
import { computeApproval, DEFAULT_MAX_APPROVAL_LEDGERS, DEFAULT_MAX_CHARGES } from '../src/terms';
import type { WalletAdapter } from '../src/wallet';

const TESTNET = 'Test SDF Network ; September 2015';
const RPC = 'https://soroban-testnet.stellar.org';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required for the E2E run`);
  return value;
}

/** A wallet that signs by asking the Stellar CLI to use the named identity. */
function cliWallet(identity: string): WalletAdapter {
  const address = execFileSync('stellar', ['keys', 'address', identity], {
    encoding: 'utf8',
  }).trim();
  return {
    connect: () => Promise.resolve({ address, networkPassphrase: TESTNET }),
    signTransaction: (xdr) =>
      Promise.resolve(
        execFileSync(
          'stellar',
          ['tx', 'sign', '--sign-with-key', identity, '--network', 'testnet', '--quiet'],
          {
            input: xdr,
            encoding: 'utf8',
          },
        ).trim(),
      ),
  };
}

describe.skipIf(process.env['E2E_TESTNET'] !== '1')('end to end on testnet', () => {
  it('subscribes through the widget flow', async () => {
    const identity = required('E2E_SIGN_IDENTITY');
    const planId = Number(required('E2E_PLAN_ID'));
    const contractId = required('E2E_CONTRACT_ID');

    const chain = createCheckoutChain({ contractId, rpcUrl: RPC, networkPassphrase: TESTNET });
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
      wallet: cliWallet(identity),
      contractId,
      networkPassphrase: TESTNET,
      terms,
      approval,
      skipApproval: false,
      onStep: (s) => steps.push(s),
    });
    process.stdout.write(
      `E2E_RESULT ${JSON.stringify({ ...result, steps, plan: { amount: terms.amount.toString(), periodSecs: terms.periodSecs }, approval: { cap: approval.cap.toString(), charges: approval.coveredCharges } })}\n`,
    );
    expect(result.subscriptionId).toBeGreaterThan(0);
    expect(steps).toEqual(['connecting', 'checking', 'approving', 'subscribing']);
  }, 240_000);
});

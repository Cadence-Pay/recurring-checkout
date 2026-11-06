import { describe, expect, it } from 'vitest';
import { checkIdentityName, readE2eNetwork } from './e2e-config';

const TESTNET = {
  E2E_NETWORK: 'testnet',
  E2E_RPC_URL: 'https://soroban-testnet.stellar.org',
  E2E_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
};
const MAINNET = {
  E2E_NETWORK: 'mainnet',
  E2E_RPC_URL: 'https://rpc.example.com',
  E2E_NETWORK_PASSPHRASE: 'Public Global Stellar Network ; September 2015',
};

describe('readE2eNetwork', () => {
  it('reads a testnet configuration', () => {
    expect(readE2eNetwork(TESTNET)).toEqual({
      label: 'testnet',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      passphrase: 'Test SDF Network ; September 2015',
    });
  });

  it('names every missing variable', () => {
    expect(() => readE2eNetwork({})).toThrow(/E2E_NETWORK, E2E_RPC_URL, E2E_NETWORK_PASSPHRASE/);
    expect(() => readE2eNetwork({ ...TESTNET, E2E_RPC_URL: '' })).toThrow(/E2E_RPC_URL/);
  });

  it('refuses a label whose passphrase does not match', () => {
    expect(() =>
      readE2eNetwork({ ...MAINNET, E2E_NETWORK_PASSPHRASE: TESTNET.E2E_NETWORK_PASSPHRASE }),
    ).toThrow(/does not match/);
    expect(() =>
      readE2eNetwork({ ...TESTNET, E2E_NETWORK_PASSPHRASE: MAINNET.E2E_NETWORK_PASSPHRASE }),
    ).toThrow(/does not match/);
  });

  it('refuses an RPC address that is not http or https', () => {
    expect(() => readE2eNetwork({ ...TESTNET, E2E_RPC_URL: 'ftp://x' })).toThrow(/http/);
  });

  it('refuses mainnet unless the owner turns it on with exactly "yes"', () => {
    expect(() => readE2eNetwork(MAINNET)).toThrow(/E2E_ALLOW_MAINNET=yes/);
    expect(() => readE2eNetwork({ ...MAINNET, E2E_ALLOW_MAINNET: 'true' })).toThrow(
      /E2E_ALLOW_MAINNET=yes/,
    );
    expect(readE2eNetwork({ ...MAINNET, E2E_ALLOW_MAINNET: 'yes' }).label).toBe('mainnet');
  });

  it('does not let the guard weaken testnet checks', () => {
    expect(() =>
      readE2eNetwork({ ...TESTNET, E2E_ALLOW_MAINNET: 'yes', E2E_NETWORK_PASSPHRASE: 'wrong' }),
    ).toThrow(/does not match/);
  });
});

describe('checkIdentityName', () => {
  it('accepts a name', () => {
    expect(checkIdentityName('recurring-subscriber')).toBe('recurring-subscriber');
  });

  it('refuses a secret key or a seed phrase, without repeating it', () => {
    const secret = `S${'A'.repeat(55)}`;
    for (const bad of [secret, 'kite urban word word word', 'a;b', '../x']) {
      let message = '';
      try {
        checkIdentityName(bad);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, bad).toContain('NAME of an identity');
      expect(message).not.toContain(bad);
    }
  });

  it('refuses nothing at all', () => {
    expect(() => checkIdentityName(undefined)).toThrow(/name of a Stellar CLI identity/);
    expect(() => checkIdentityName('')).toThrow(/name of a Stellar CLI identity/);
  });
});

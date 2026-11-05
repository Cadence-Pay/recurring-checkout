/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/prefer-promise-reject-errors --
   Mocks created with vi.fn are asserted on directly, and wallets really do reject with plain
   { code, message } objects, which these tests and fakes must reproduce. */
import { describe, expect, it, vi } from 'vitest';
import { SubscribeError } from './errors';
import { createKitAdapter, isRejection, type KitLike, type KitLoader } from './wallet';
import { SUBSCRIBER, TESTNET } from './testing/fakes';

function fakeKit(overrides: Partial<KitLike> = {}) {
  const kit: KitLike = {
    init: vi.fn(),
    authModal: vi.fn(() => Promise.resolve({ address: SUBSCRIBER })),
    getNetwork: vi.fn(() => Promise.resolve({ network: 'TESTNET', networkPassphrase: TESTNET })),
    signTransaction: vi.fn(() => Promise.resolve({ signedTxXdr: 'SIGNED' })),
    ...overrides,
  };
  const loader: KitLoader = vi.fn(() => Promise.resolve({ kit, modules: () => ['module-a'] }));
  return { kit, loader };
}

describe('isRejection', () => {
  it('recognises the SEP-43 code and common wording', () => {
    expect(isRejection({ code: -4, message: 'x' })).toBe(true);
    expect(isRejection(new Error('User declined access'))).toBe(true);
    expect(isRejection('request denied')).toBe(true);
    expect(isRejection({ message: 'The modal was closed' })).toBe(true);
  });

  it('does not treat other failures as a rejection', () => {
    expect(isRejection(new Error('device locked'))).toBe(false);
    expect(isRejection({ code: -1, message: 'internal' })).toBe(false);
    expect(isRejection(undefined)).toBe(false);
  });
});

describe('createKitAdapter', () => {
  it('connects and reports the address and the wallet network', async () => {
    const { loader } = fakeKit();
    expect(await createKitAdapter(TESTNET, loader).connect()).toEqual({
      address: SUBSCRIBER,
      networkPassphrase: TESTNET,
    });
  });

  it('loads and initialises the kit once for the given network', async () => {
    const { kit, loader } = fakeKit();
    const adapter = createKitAdapter(TESTNET, loader);
    await adapter.connect();
    await adapter.signTransaction('XDR', { networkPassphrase: TESTNET, address: SUBSCRIBER });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(kit.init).toHaveBeenCalledWith({ modules: ['module-a'], network: TESTNET });
  });

  it('does nothing until it is used', () => {
    const { loader } = fakeKit();
    createKitAdapter(TESTNET, loader);
    expect(loader).not.toHaveBeenCalled();
  });

  it('connects even when the wallet cannot report its network', async () => {
    const { loader } = fakeKit({ getNetwork: () => Promise.reject(new Error('unsupported')) });
    expect(await createKitAdapter(TESTNET, loader).connect()).toEqual({
      address: SUBSCRIBER,
      networkPassphrase: null,
    });
  });

  it('signs and returns the signed transaction', async () => {
    const { kit, loader } = fakeKit();
    const signed = await createKitAdapter(TESTNET, loader).signTransaction('XDR', {
      networkPassphrase: TESTNET,
      address: SUBSCRIBER,
    });
    expect(signed).toBe('SIGNED');
    expect(kit.signTransaction).toHaveBeenCalledWith('XDR', {
      networkPassphrase: TESTNET,
      address: SUBSCRIBER,
    });
  });

  it('says the wallet is unavailable when the kit cannot be loaded, and tries again next time', async () => {
    let attempts = 0;
    const { kit } = fakeKit();
    const loader: KitLoader = () => {
      attempts++;
      return attempts === 1
        ? Promise.reject(new Error('Cannot find module'))
        : Promise.resolve({ kit, modules: () => [] });
    };
    const adapter = createKitAdapter(TESTNET, loader);
    const failure = await adapter.connect().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SubscribeError);
    expect(failure).toMatchObject({ code: 'WALLET_UNAVAILABLE' });
    expect(await adapter.connect()).toMatchObject({ address: SUBSCRIBER });
  });

  it('lets a declined connection error through for the flow to classify', async () => {
    const { loader } = fakeKit({
      authModal: () => Promise.reject({ code: -4, message: 'closed' }),
    });
    const failure = await createKitAdapter(TESTNET, loader)
      .connect()
      .catch((e: unknown) => e);
    expect(isRejection(failure)).toBe(true);
  });
});

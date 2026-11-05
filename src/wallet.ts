import { SubscribeError } from './errors';
import { messages } from './messages';

/** Who is connected, and which network their wallet says it is on. */
export interface WalletSession {
  readonly address: string;
  /** Network passphrase reported by the wallet, or null if it would not say. */
  readonly networkPassphrase: string | null;
}

/**
 * What the widget needs from a wallet. Pass your own to use a wallet other than the default one.
 * Failures can be thrown as anything: a request the person declined is recognised by the SEP-43
 * code -4, or by words such as "reject", "declined" or "closed" in the message.
 */
export interface WalletAdapter {
  /** Let the person choose a wallet and share an address. */
  connect(): Promise<WalletSession>;
  /** Sign a transaction. Resolves to the signed transaction as base64 XDR. */
  signTransaction(
    xdr: string,
    options: { networkPassphrase: string; address: string },
  ): Promise<string>;
}

/** The part of the Stellar Wallets Kit the default adapter uses. */
export interface KitLike {
  init(params: { modules: unknown[]; network?: string }): void;
  authModal(): Promise<{ address: string }>;
  getNetwork(): Promise<{ network: string; networkPassphrase: string }>;
  signTransaction(
    xdr: string,
    options: { networkPassphrase: string; address: string },
  ): Promise<{ signedTxXdr: string }>;
}

/** Loads the kit and its default wallet modules. Replaceable in tests. */
export type KitLoader = () => Promise<{ kit: KitLike; modules: () => unknown[] }>;

/**
 * Loads the Stellar Wallets Kit, which is an optional peer dependency. It touches `window`, so it
 * must only be called in the browser.
 */
export const loadKit: KitLoader = async () => {
  const [{ StellarWalletsKit }, { defaultModules }] = await Promise.all([
    import('@creit.tech/stellar-wallets-kit/sdk'),
    import('@creit.tech/stellar-wallets-kit/modules/utils'),
  ]);
  return { kit: StellarWalletsKit as unknown as KitLike, modules: () => defaultModules() };
};

/** True if a thrown value looks like the person declined or closed the wallet. */
export function isRejection(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : typeof error === 'string'
          ? error
          : '';
  return code === -4 || /reject|declin|denied|cancel|closed/i.test(message);
}

/**
 * The default wallet adapter, backed by the Stellar Wallets Kit (a wallet chooser dialog).
 * The kit is loaded on first use and initialised once.
 *
 * WAVE-ISSUE(checkout-2): a wallet selection modal of the widget's own plugs in here. The MVP has
 * this one path, which uses the kit's built-in chooser.
 *
 * @param networkPassphrase - Passphrase of the network the plan lives on.
 * @param load - How to load the kit. Defaults to the real one.
 */
export function createKitAdapter(
  networkPassphrase: string,
  load: KitLoader = loadKit,
): WalletAdapter {
  let ready: Promise<KitLike> | undefined;
  const kit = (): Promise<KitLike> => {
    ready ??= load().then(
      (loaded) => {
        loaded.kit.init({ modules: loaded.modules(), network: networkPassphrase });
        return loaded.kit;
      },
      (error: unknown) => {
        ready = undefined;
        throw new SubscribeError(
          'WALLET_UNAVAILABLE',
          'connect',
          messages.errors.WALLET_UNAVAILABLE,
          {
            cause: error,
          },
        );
      },
    );
    return ready;
  };

  return {
    async connect() {
      const k = await kit();
      const { address } = await k.authModal();
      let passphrase: string | null = null;
      try {
        passphrase = (await k.getNetwork()).networkPassphrase;
      } catch {
        // Some wallets cannot report their network.
      }
      return { address, networkPassphrase: passphrase };
    },
    async signTransaction(xdr, options) {
      const { signedTxXdr } = await (await kit()).signTransaction(xdr, options);
      return signedTxXdr;
    },
  };
}

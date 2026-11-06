/**
 * Settings and safety checks for the end-to-end subscribe script. Kept apart from the script so
 * they can be tested without a network and without spending anything.
 */

const KNOWN_PASSPHRASES: Record<string, string> = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015',
};

export interface E2eNetwork {
  readonly label: string;
  readonly rpcUrl: string;
  readonly passphrase: string;
}

/**
 * Read the network from the environment. All of E2E_NETWORK, E2E_RPC_URL and
 * E2E_NETWORK_PASSPHRASE are required, a label that does not match its passphrase is refused, and
 * mainnet is refused unless E2E_ALLOW_MAINNET is exactly `yes`: on mainnet this script spends real
 * money, so only the owner turns it on, for one run.
 */
export function readE2eNetwork(env: Record<string, string | undefined>): E2eNetwork {
  const label = env['E2E_NETWORK'];
  const rpcUrl = env['E2E_RPC_URL'];
  const passphrase = env['E2E_NETWORK_PASSPHRASE'];
  const missing = ['E2E_NETWORK', 'E2E_RPC_URL', 'E2E_NETWORK_PASSPHRASE'].filter(
    (name) => (env[name] ?? '') === '',
  );
  if (
    label === undefined ||
    rpcUrl === undefined ||
    passphrase === undefined ||
    missing.length > 0
  ) {
    throw new Error(`Set ${missing.join(', ')} in the environment.`);
  }
  if (!/^https?:\/\//.test(rpcUrl))
    throw new Error('E2E_RPC_URL must start with http:// or https://');
  const expected = KNOWN_PASSPHRASES[label];
  if (expected !== undefined && expected !== passphrase) {
    throw new Error(`E2E_NETWORK_PASSPHRASE does not match the passphrase of ${label}.`);
  }
  if (label === 'mainnet' && env['E2E_ALLOW_MAINNET'] !== 'yes') {
    throw new Error(
      'Mainnet moves real value and cannot be undone. This script refuses it unless E2E_ALLOW_MAINNET=yes is set for this run, which only the owner does.',
    );
  }
  return { label, rpcUrl, passphrase };
}

/**
 * The identity must be a NAME in the Stellar CLI key store. A secret key or a seed phrase is
 * refused, and is not repeated in the error.
 */
export function checkIdentityName(name: string | undefined): string {
  if (name === undefined || name === '') {
    throw new Error('E2E_SIGN_IDENTITY must be the name of a Stellar CLI identity.');
  }
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name) || /^S[A-Z2-7]{55}$/.test(name)) {
    throw new Error(
      'E2E_SIGN_IDENTITY must be the NAME of an identity in the Stellar CLI key store. A secret key or seed phrase was refused and not used.',
    );
  }
  return name;
}

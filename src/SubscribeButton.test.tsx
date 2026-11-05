import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SubscribeError } from './errors';
import { SubscribeButton, validateProps, type SubscribeButtonProps } from './SubscribeButton';
import {
  CONTRACT,
  FakeChain,
  FakeWallet,
  MAINNET,
  PLAN,
  SUBSCRIBER,
  TESTNET,
} from './testing/fakes';

function setup(
  extra: Partial<SubscribeButtonProps> = {},
  tweak?: (chain: FakeChain, wallet: FakeWallet) => void,
) {
  const chain = new FakeChain();
  const wallet = new FakeWallet();
  tweak?.(chain, wallet);
  const onSuccess = vi.fn();
  const onError = vi.fn();
  render(
    <SubscribeButton
      planId={1}
      contractId={CONTRACT}
      rpcUrl="https://soroban-testnet.stellar.org"
      networkPassphrase={TESTNET}
      chain={chain}
      wallet={wallet}
      onSuccess={onSuccess}
      onError={onError}
      {...extra}
    />,
  );
  return { chain, wallet, onSuccess, onError };
}

const subscribeButton = () => screen.findByRole('button', { name: /Subscribe for 1 XLM/ });

describe('SubscribeButton terms', () => {
  it('loads the plan and states the price, the first payment and what is approved', async () => {
    const { chain } = setup();
    expect(screen.getByRole('status').textContent).toContain('Loading the plan');
    await subscribeButton();
    expect(screen.getByText('1 XLM every 30 days')).toBeTruthy();
    expect(screen.getByText('You pay 1 XLM now, for the first period.')).toBeTruthy();
    expect(
      screen.getByText(/After that, 1 XLM is charged automatically every 30 days/),
    ).toBeTruthy();
    // The network limit means five of the twelve requested charges fit in one approval.
    expect(screen.getByText(/approve up to 5 XLM \(5 charges\), valid until about/)).toBeTruthy();
    expect(screen.getByText(/sign twice/)).toBeTruthy();
    expect(chain.count('getPlanTerms')).toBe(1);
  });

  it('states the number of charges the approval covers when asked for fewer', async () => {
    setup({ maxCharges: 2 });
    await subscribeButton();
    expect(screen.getByText(/approve up to 2 XLM \(2 charges\)/)).toBeTruthy();
  });

  it('is a labelled region and applies the class of the host site', async () => {
    setup({ className: 'my-shop' });
    await subscribeButton();
    const region = screen.getByRole('region', { name: 'Subscription' });
    expect(region.className).toContain('rc-root');
    expect(region.className).toContain('my-shop');
  });

  it('shows no wallet or network activity before the person clicks', async () => {
    const { chain, wallet } = setup();
    await subscribeButton();
    expect(wallet.connects).toBe(0);
    expect(chain.count('approve')).toBe(0);
  });
});

describe('SubscribeButton subscribing', () => {
  it('subscribes, shows success and reports it once', async () => {
    const { onSuccess, onError } = setup();
    fireEvent.click(await subscribeButton());
    const status = await screen.findByText(/Subscription 7 is active/);
    expect(status.textContent).toContain('first payment has been made');
    expect(screen.queryByRole('button')).toBeNull();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith({
      planId: 1,
      subscriptionId: 7,
      subscriber: SUBSCRIBER,
      approveTxHash: 'APPROVE_HASH',
      subscribeTxHash: 'SUBSCRIBE_HASH',
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('tells the person which of the two steps they are on', async () => {
    let finishApprove: () => void = () => undefined;
    const { chain } = setup({}, (c) => {
      const original = c.approve.bind(c);
      c.approve = async (input) => {
        await new Promise<void>((resolve) => {
          finishApprove = resolve;
        });
        return original(input);
      };
    });
    fireEvent.click(await subscribeButton());
    expect((await screen.findByRole('status')).textContent).toContain('Step 1 of 2');
    expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(true);
    finishApprove();
    await screen.findByText(/Subscription 7 is active/);
    expect(chain.count('subscribe')).toBe(1);
  });

  it('ignores a second click while working', async () => {
    let release: () => void = () => undefined;
    const { wallet } = setup({}, (_c, w) => {
      const original = w.connect.bind(w);
      w.connect = async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return original();
      };
    });
    const button = await subscribeButton();
    fireEvent.click(button);
    fireEvent.click(button);
    release();
    await screen.findByText(/Subscription 7 is active/);
    expect(wallet.connects).toBe(1);
  });
});

describe('SubscribeButton failures', () => {
  it('explains a wallet on the wrong network and offers to try again', async () => {
    const { chain, onError } = setup({}, (_c, w) => {
      w.session = { address: SUBSCRIBER, networkPassphrase: MAINNET };
    });
    fireEvent.click(await subscribeButton());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Switch it to Testnet');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(chain.count('approve')).toBe(0);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'WRONG_NETWORK' }));
  });

  it('says how much is missing when the balance is too low, and sends nothing', async () => {
    const { chain } = setup({}, (c) => {
      c.balance = 2_500_000n;
    });
    fireEvent.click(await subscribeButton());
    expect((await screen.findByRole('alert')).textContent).toContain('Your balance is 0.25 XLM');
    expect(chain.count('approve')).toBe(0);
  });

  it('says nothing was charged when the person declines in the wallet, and allows a retry', async () => {
    const { wallet, onError } = setup({}, (_c, w) => {
      w.signError = { code: -4, message: 'declined' };
    });
    fireEvent.click(await subscribeButton());
    expect((await screen.findByRole('alert')).textContent).toContain('Nothing was charged');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'WALLET_REJECTED' }));
    wallet.signError = undefined;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/Subscription 7 is active/);
  });

  it('after the approval went through but the subscription failed, retries without approving again', async () => {
    const { chain, wallet, onSuccess, onError } = setup({}, (c) => {
      c.subscribeErrors = [
        new SubscribeError('NETWORK', 'subscribe', 'Could not reach the network.', {
          approved: true,
        }),
      ];
    });
    fireEvent.click(await subscribeButton());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not reach the network');
    expect(screen.getByText(/will not be asked to approve again/)).toBeTruthy();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ approved: true }));

    wallet.signed = [];
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/Subscription 7 is active/);
    expect(chain.count('approve')).toBe(1);
    expect(wallet.signed).toHaveLength(1);
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ approveTxHash: null }));
  });

  it('does not allow another attempt while a transaction may still go through', async () => {
    setup({}, (c) => {
      c.subscribeErrors = [
        new SubscribeError(
          'PENDING',
          'subscribe',
          'The transaction was sent but is not confirmed yet.',
          {
            approved: true,
          },
        ),
      ];
    });
    fireEvent.click(await subscribeButton());
    expect((await screen.findByRole('alert')).textContent).toContain('not confirmed yet');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Try again' }).disabled).toBe(
      true,
    );
  });
});

describe('SubscribeButton when the plan cannot be used', () => {
  it('shows an inactive plan as unavailable, without a button, and reports it', async () => {
    const { onError } = setup({}, (c) => {
      c.plan = { ...PLAN, active: false };
    });
    expect((await screen.findByRole('alert')).textContent).toContain(
      'no longer accepts new subscribers',
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'PLAN_INACTIVE' }));
  });

  it('shows an unknown plan without a retry button', async () => {
    setup({}, (c) => {
      c.planError = new SubscribeError('PLAN_NOT_FOUND', 'load', 'This plan does not exist.');
    });
    expect((await screen.findByRole('alert')).textContent).toContain('does not exist');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('refuses a plan with a period no approval can cover', async () => {
    setup({}, (c) => {
      c.plan = { ...PLAN, periodSecs: 365 * 86_400 };
    });
    expect((await screen.findByRole('alert')).textContent).toContain(
      'longer than the network allows',
    );
    expect(screen.queryByRole('button', { name: /Subscribe/ })).toBeNull();
  });

  it('offers to reload after a network failure', async () => {
    const { chain } = setup({}, (c) => {
      c.planError = new SubscribeError('NETWORK', 'load', 'Could not reach the network.');
    });
    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach the network');
    chain.planError = undefined;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await subscribeButton();
    expect(chain.count('getPlanTerms')).toBe(2);
  });
});

describe('SubscribeButton configuration', () => {
  it.each([
    ['planId', { planId: 0 }],
    ['planId', { planId: 1.5 }],
    ['contractId', { contractId: 'GABC' }],
    ['rpcUrl', { rpcUrl: 'soroban-testnet' }],
    ['networkPassphrase', { networkPassphrase: ' ' }],
    ['maxCharges', { maxCharges: 0 }],
  ])('rejects a bad %s before any network call', async (name, bad) => {
    const { chain, onError } = setup(bad);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(`(${name})`);
    expect(chain.calls).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONFIG' }));
  });

  it('validateProps accepts good props', () => {
    expect(
      validateProps({
        planId: 3,
        contractId: CONTRACT,
        rpcUrl: 'https://rpc.example',
        networkPassphrase: TESTNET,
      }),
    ).toBeUndefined();
  });
});

describe('SubscribeButton reloads', () => {
  it('loads the new plan when planId changes', async () => {
    const chain = new FakeChain();
    const props = {
      contractId: CONTRACT,
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: TESTNET,
      chain,
      wallet: new FakeWallet(),
    };
    const { rerender } = render(<SubscribeButton planId={1} {...props} />);
    await subscribeButton();
    rerender(<SubscribeButton planId={2} {...props} />);
    await waitFor(() => {
      expect(chain.calls.filter((c) => c.method === 'getPlanTerms').map((c) => c.args)).toEqual([
        1, 2,
      ]);
    });
  });
});

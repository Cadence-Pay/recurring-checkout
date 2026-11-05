import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateProps } from '../../src/SubscribeButton';
import { App, EXAMPLE } from './App';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('example app', () => {
  it('uses settings the widget accepts', () => {
    expect(validateProps(EXAMPLE)).toBeUndefined();
  });

  it('shows the page and the widget without needing the network to render', () => {
    // The widget starts loading at once; make that fail fast and offline.
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Example shop' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Subscription' })).toBeTruthy();
    expect(screen.getByText('Nothing has happened yet.')).toBeTruthy();
  });
});

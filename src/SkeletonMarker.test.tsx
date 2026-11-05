import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SkeletonMarker } from './SkeletonMarker.js';

describe('SkeletonMarker', () => {
  it('renders the default label', () => {
    render(<SkeletonMarker />);
    expect(screen.getByText('recurring-checkout skeleton')).toBeTruthy();
  });

  it('renders a custom label', () => {
    render(<SkeletonMarker label="hello" />);
    expect(screen.getByText('hello')).toBeTruthy();
  });
});

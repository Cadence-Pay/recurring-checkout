/**
 * Placeholder that proves the build and test toolchain works.
 * It is replaced by the real SubscribeButton in Phase 4.
 */
export function SkeletonMarker({ label = 'recurring-checkout skeleton' }: { label?: string }) {
  return <span data-recurring-checkout="skeleton">{label}</span>;
}

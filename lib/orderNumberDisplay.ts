// Display-only formatting for order numbers — never mutates the stored value.
// Long order numbers (e.g. Poshmark's `6a4d94320430dfcddda3748a`) are real
// retailer order numbers, not internal ids; middle-truncating keeps the list
// row legible while the full value stays available via title/aria-label.
const TRUNCATE_THRESHOLD = 16;
const HEAD_CHARS = 6;
const TAIL_CHARS = 4;

export function truncateOrderNumber(orderNumber: string): string {
  if (orderNumber.length <= TRUNCATE_THRESHOLD) return orderNumber;
  return `${orderNumber.slice(0, HEAD_CHARS)}…${orderNumber.slice(-TAIL_CHARS)}`;
}

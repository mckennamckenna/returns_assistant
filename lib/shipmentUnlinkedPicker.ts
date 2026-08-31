import type { NeedsReviewReasonId } from "./needsReviewReasons";

// "Start a new order" escape-hatch list item inside LinkToOrderPicker —
// TASKS.md 🔴 Now, shipment_unlinked ticket, Stage 4 Part 4b (2026-08-31).
// Extracted from app/LinkToOrderPicker.tsx (a "use client" component) into
// a plain module so the visibility condition and click orchestration are
// unit-testable without a component-rendering harness — none exists yet in
// this repo (no @testing-library/react, node-only vitest environment), and
// owner decision 2026-08-31 was to defer adding that infrastructure until
// a real rendering-layer bug motivates it, not add it speculatively for
// this one feature. Actual JSX/rendering/click behavior is covered by
// owner hand-verification in the UI instead.

// Only shipment_unlinked rows get the escape hatch. Every other
// link_to_order reason (belongs_to_existing_order, duplicate,
// return_or_refund_no_link) means a real orderNumber/return-side match
// exists — there IS a right order to pick, so offering "just create a new
// one" would invite a wrong choice instead of preventing a dead end (which
// is the only reason this exists: shipment_unlinked rows can have zero, or
// the wrong, candidates in the still-unfiltered full order list).
export function shouldShowCreateNewEscapeHatch(reasonId: NeedsReviewReasonId): boolean {
  return reasonId === "shipment_unlinked";
}

// Pinned first in the picker's list (not appended after real candidates) —
// owner decision 2026-08-31: keeps the escape hatch visible immediately
// regardless of how many real candidates exist, without depending on
// scrolling to the bottom of a list that can run past the picker's fixed
// max-height. A "create new" affordance pinned at the top of a picker/
// combobox list is also a familiar pattern elsewhere, not a novel one.
export function createNewOrderEscapeHatchLabel(retailer: string | null): string {
  return retailer ? `+ Start a new order for ${retailer}` : "+ Start a new order";
}

// Orchestrates the click: confirm, then create, in that order — mirrors
// app/NeedsReviewRowActions.tsx's existing create_new_order confirm step
// exactly (same copy, same function called), so the two "create a new
// order" entry points behave identically. confirmFn/createFn are injected
// so this is testable without window.confirm or a real server action.
// Returns false without calling createFn if the user declines the confirm.
export async function runCreateNewOrderEscapeHatch(
  emailId: string,
  confirmFn: () => boolean,
  createFn: (emailId: string) => Promise<void>,
): Promise<boolean> {
  if (!confirmFn()) return false;
  await createFn(emailId);
  return true;
}

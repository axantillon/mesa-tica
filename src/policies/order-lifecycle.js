/** OrderLifecycle: the only legal staff transitions. Collected and Cancelled are final. */
const TRANSITIONS = {
  Received: ['Preparing', 'Cancelled'],
  Preparing: ['Ready', 'Cancelled'],
  Ready: ['Collected', 'Cancelled'],
  Collected: [],
  Cancelled: [],
};

export const ACTION_LABELS = {
  Preparing: 'Mark Preparing',
  Ready: 'Mark Ready',
  Collected: 'Mark Collected',
  Cancelled: 'Cancel order',
};

export const MAX_REASON_LENGTH = 300;

export function allowedActions(status) {
  return (TRANSITIONS[status] ?? []).map((target) => ({ target, label: ACTION_LABELS[target] }));
}

/** Returns null when the change is permitted, otherwise a correction explaining why it is not. */
export function validateChange(status, target, reason) {
  if (!(TRANSITIONS[status] ?? []).includes(target)) {
    const final = (TRANSITIONS[status] ?? []).length === 0;
    return {
      code: 'invalid_transition',
      message: final
        ? `This order is ${status}, which is final. Its status can no longer change.`
        : `An order that is ${status} cannot be changed to ${target}.`,
    };
  }
  if (target === 'Cancelled') {
    if (typeof reason !== 'string' || reason.trim() === '') {
      return { code: 'reason_required', message: 'Enter a reason for cancelling. The customer will see it.' };
    }
    if (reason.trim().length > MAX_REASON_LENGTH) {
      return { code: 'reason_too_long', message: `Keep the reason to ${MAX_REASON_LENGTH} characters or fewer.` };
    }
  }
  return null;
}

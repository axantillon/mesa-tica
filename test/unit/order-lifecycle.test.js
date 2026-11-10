import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ORDER_STATUSES } from '../../src/db.js';
import { allowedActions, validateChange } from '../../src/policies/order-lifecycle.js';

const LEGAL = new Set(['Received>Preparing', 'Received>Cancelled', 'Preparing>Ready', 'Preparing>Cancelled', 'Ready>Collected', 'Ready>Cancelled']);

test('only the listed transitions are permitted', () => {
  for (const from of ORDER_STATUSES) {
    for (const to of ORDER_STATUSES) {
      const correction = validateChange(from, to, 'Kitchen closed early');
      assert.equal(correction === null, LEGAL.has(`${from}>${to}`), `${from} -> ${to}`);
    }
  }
});

test('allowed actions match the specification table', () => {
  assert.deepEqual(allowedActions('Received').map((a) => a.label), ['Mark Preparing', 'Cancel order']);
  assert.deepEqual(allowedActions('Preparing').map((a) => a.label), ['Mark Ready', 'Cancel order']);
  assert.deepEqual(allowedActions('Ready').map((a) => a.label), ['Mark Collected', 'Cancel order']);
  assert.deepEqual(allowedActions('Collected'), []);
  assert.deepEqual(allowedActions('Cancelled'), []);
});

test('cancellation needs a nonblank reason', () => {
  for (const reason of [undefined, '', '   ', '\n\t']) {
    assert.equal(validateChange('Received', 'Cancelled', reason).code, 'reason_required');
  }
  assert.equal(validateChange('Received', 'Cancelled', 'Out of chicken'), null);
});

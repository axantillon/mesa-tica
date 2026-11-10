import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { describeHours, isOpen, nextOpening } from '../../src/policies/opening-policy.js';

// Opening decisions must follow the restaurant zone, never the machine's zone.
process.env.TZ = 'Pacific/Auckland';

const { restaurant } = JSON.parse(fs.readFileSync(new URL('../../config/restaurant.json', import.meta.url), 'utf8'));
const at = (text) => new Date(text);

test('opening is inclusive and closing exclusive in America/Costa_Rica', () => {
  assert.equal(isOpen(restaurant, at('2026-11-10T09:59:59-06:00')), false);
  assert.equal(isOpen(restaurant, at('2026-11-10T10:00:00-06:00')), true);
  assert.equal(isOpen(restaurant, at('2026-11-10T20:59:59-06:00')), true);
  assert.equal(isOpen(restaurant, at('2026-11-10T21:00:00-06:00')), false);
});

test('next opening names weekday, date and local time', () => {
  assert.deepEqual(nextOpening(restaurant, at('2026-11-10T21:00:00-06:00')), {
    at: '2026-11-11T16:00:00.000Z',
    label: 'Wednesday, November 11 at 10:00 AM (Costa Rica time)',
  });
  // Early morning: the next opening is later the same local day.
  assert.equal(nextOpening(restaurant, at('2026-11-10T06:30:00-06:00')).at, '2026-11-10T16:00:00.000Z');
  // 01:00 UTC on the 11th is still the 10th in Costa Rica.
  assert.equal(nextOpening(restaurant, at('2026-11-11T01:00:00Z')).label, 'Wednesday, November 11 at 10:00 AM (Costa Rica time)');
});

test('a one-day schedule finds the same weekday next week', () => {
  const mondayOnly = { ...restaurant, weeklyHours: { monday: [{ open: '10:00', close: '21:00' }] } };
  assert.equal(isOpen(mondayOnly, at('2026-11-10T12:00:00-06:00')), false);
  assert.equal(nextOpening(mondayOnly, at('2026-11-09T22:00:00-06:00')).label, 'Monday, November 16 at 10:00 AM (Costa Rica time)');
});

test('an empty weekly schedule yields no upcoming opening', () => {
  const empty = { ...restaurant, weeklyHours: {} };
  assert.equal(isOpen(empty, at('2026-11-10T12:00:00-06:00')), false);
  assert.equal(nextOpening(empty, at('2026-11-10T12:00:00-06:00')), null);
  assert.deepEqual(describeHours(empty), []);
});

test('weekly hours are described for customers', () => {
  assert.deepEqual(describeHours(restaurant), ['Every day: 10:00 AM – 9:00 PM']);
});

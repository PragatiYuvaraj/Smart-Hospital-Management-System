'use strict';

const assert = require('assert');
const {
  calculateReminderDate,
  parseReviewDate
} = require('../src/utils/review-time');

let passed = 0;

const test = (description, operation) => {
  operation();
  passed++;
  console.log(`  PASS: ${description}`);
};

test('requires a date-time with an explicit timezone offset', () => {
  assert.throws(() => parseReviewDate('2030-04-15T10:00:00'), {
    statusCode: 400
  });
  assert.strictEqual(
    parseReviewDate('2030-04-15T10:00:00+05:30').toISOString(),
    '2030-04-15T04:30:00.000Z'
  );
});

test('rejects invalid calendar dates and clock times', () => {
  for (const value of [
    '2030-02-30T10:00:00Z',
    '2030-04-15T24:00:00Z',
    '2030-04-15T10:60:00Z'
  ]) {
    assert.throws(() => parseReviewDate(value), { statusCode: 400 });
  }
});

test('subtracts two local calendar days across a daylight-saving transition', () => {
  const review = parseReviewDate('2025-03-31T10:00:00+02:00');
  const reminder = calculateReminderDate(review, 'Europe/Berlin');
  assert.strictEqual(reminder.toISOString(), '2025-03-29T09:00:00.000Z');
});

test('preserves local reminder time across the autumn daylight-saving transition', () => {
  const review = parseReviewDate('2025-10-27T10:00:00+01:00');
  const reminder = calculateReminderDate(review, 'Europe/Berlin');
  assert.strictEqual(reminder.toISOString(), '2025-10-25T08:00:00.000Z');
});

test('resolves a reminder falling into a daylight-saving gap to the next valid local time', () => {
  const review = parseReviewDate('2025-03-25T02:30:00+01:00');
  const reminder = calculateReminderDate(review, 'Europe/Berlin');
  assert.strictEqual(reminder.toISOString(), '2025-03-23T01:30:00.000Z');
});

console.log(`Review time tests: ${passed} passed.`);

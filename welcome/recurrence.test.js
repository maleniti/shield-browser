const assert = require('node:assert');
const R = require('./recurrence');

// -- occursOn --------------------------------------------------------------
const once = { dueDate: '2026-03-10', frequency: { type: 'once' } };
assert.ok(R.occursOn(once, '2026-03-10'));
assert.ok(!R.occursOn(once, '2026-03-11'));
assert.ok(!R.occursOn(once, '2026-03-09'), 'no occurrence before the due date');

const daily = { dueDate: '2026-03-10', frequency: { type: 'days', interval: 1 } };
assert.ok(R.occursOn(daily, '2026-03-10'));
assert.ok(R.occursOn(daily, '2026-03-15'));
assert.ok(!R.occursOn(daily, '2026-03-09'));

const everyThreeDays = { dueDate: '2026-03-10', frequency: { type: 'days', interval: 3 } };
assert.ok(R.occursOn(everyThreeDays, '2026-03-13'));
assert.ok(!R.occursOn(everyThreeDays, '2026-03-12'));

const weekly = { dueDate: '2026-03-10', frequency: { type: 'weeks', interval: 1 } };
assert.ok(R.occursOn(weekly, '2026-03-17'));
assert.ok(!R.occursOn(weekly, '2026-03-16'));

const monthly = { dueDate: '2026-01-31', frequency: { type: 'months', interval: 1 } };
assert.ok(R.occursOn(monthly, '2026-01-31'));
assert.ok(R.occursOn(monthly, '2026-02-28'), 'Feb has no 31st, clamps to the last day');
assert.ok(R.occursOn(monthly, '2026-03-31'));
assert.ok(!R.occursOn(monthly, '2026-03-30'));

const everyTwoMonths = { dueDate: '2026-01-15', frequency: { type: 'months', interval: 2 } };
assert.ok(R.occursOn(everyTwoMonths, '2026-03-15'));
assert.ok(!R.occursOn(everyTwoMonths, '2026-02-15'));

// -- mostRecentOccurrenceOnOrBefore -----------------------------------------
assert.strictEqual(R.mostRecentOccurrenceOnOrBefore(once, '2026-03-15'), '2026-03-10', 'a missed one-off stays pending, doesn\'t vanish');
assert.strictEqual(R.mostRecentOccurrenceOnOrBefore(once, '2026-03-01'), null, 'not due yet');

assert.strictEqual(R.mostRecentOccurrenceOnOrBefore(daily, '2026-03-15'), '2026-03-15');
assert.strictEqual(R.mostRecentOccurrenceOnOrBefore(everyThreeDays, '2026-03-15'), '2026-03-13', 'most recent 3-day step on/before the 15th');
assert.strictEqual(R.mostRecentOccurrenceOnOrBefore(weekly, '2026-03-20'), '2026-03-17');
assert.strictEqual(R.mostRecentOccurrenceOnOrBefore(monthly, '2026-02-27'), '2026-01-31', 'Feb 27 is before Feb\'s clamped 28th occurrence');
assert.strictEqual(R.mostRecentOccurrenceOnOrBefore(monthly, '2026-02-28'), '2026-02-28');

// -- isOverdue ---------------------------------------------------------------
const t = { dueTime: '18:00' };
assert.ok(R.isOverdue(t, '2026-03-10', new Date('2026-03-10T18:01:00')));
assert.ok(!R.isOverdue(t, '2026-03-10', new Date('2026-03-10T17:59:00')));
assert.ok(R.isOverdue(t, '2026-03-10', new Date('2026-03-11T00:00:00')), 'any later day is overdue regardless of time');

console.log('recurrence.test.js: all assertions passed');

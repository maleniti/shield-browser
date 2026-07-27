// Recurrence + overdue math for the to-do list. Pure functions, no DOM/
// localStorage access, so they're unit-testable under Node (recurrence.test.js)
// and also usable directly from the welcome page via a plain <script> include
// (UMD-lite: module.exports under Node, window.Recurrence in the browser).

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dateToISO(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00');
  const b = new Date(isoB + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function monthsBetween(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00');
  const b = new Date(isoB + 'T00:00:00');
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

// Does `task` have an occurrence exactly on `dateISO`?
//
// task.frequency shapes:
//   { type: 'once' }
//   { type: 'days', interval }
//   { type: 'weeks', interval, weekdays?: number[] }  -- weekdays: 0(Sun)-6(Sat).
//     If given (non-empty), occurs on those weekdays every `interval` weeks,
//     counted from the Sunday of dueDate's own week (dueDate need not itself
//     fall on one of the selected weekdays -- it's just the anchor for week
//     boundaries and the interval count). If omitted, falls back to the
//     original single-day-of-week behavior anchored to dueDate's own
//     weekday, for backward compatibility with already-saved tasks.
//   { type: 'months', interval, dayMode?, offset?, weekday?, ordinal? }
//     dayMode 'day' (default/omitted): anchor to dueDate's day-of-month,
//       clamped to the last day of shorter months (e.g. the 31st -> Feb 28).
//     dayMode 'last': always the last day of the month.
//     dayMode 'before-last': `offset` (0-3) days before the last day.
//     dayMode 'weekday': the `ordinal`-th occurrence of `weekday` (0-6) in
//       the month, where ordinal is 1-5, or the string 'last' for the final
//       occurrence of that weekday in the month (some months have 4 of a
//       given weekday, some have 5, so "last" isn't just ordinal 5).
function occursOn(task, dateISO) {
  if (task.endDate && dateISO > task.endDate) return false;
  const diffDays = daysBetween(task.dueDate, dateISO);
  if (diffDays < 0) return false;
  const interval = Math.max(1, task.frequency.interval || 1);
  const target = new Date(dateISO + 'T00:00:00');

  switch (task.frequency.type) {
    case 'once':
      return diffDays === 0;

    case 'days':
      return diffDays % interval === 0;

    case 'weeks': {
      const weekdays = task.frequency.weekdays;
      if (weekdays && weekdays.length > 0) {
        const due = new Date(task.dueDate + 'T00:00:00');
        const dueWeekStart = addDays(due, -due.getDay());
        const weekIndex = Math.floor(daysBetween(dateToISO(dueWeekStart), dateISO) / 7);
        if (weekIndex < 0 || weekIndex % interval !== 0) return false;
        return weekdays.includes(target.getDay());
      }
      return diffDays % (interval * 7) === 0;
    }

    case 'months': {
      const diffMonths = monthsBetween(task.dueDate, dateISO);
      if (diffMonths < 0 || diffMonths % interval !== 0) return false;
      const due = new Date(task.dueDate + 'T00:00:00');
      const dayMode = task.frequency.dayMode || 'day';

      if (dayMode === 'last') {
        return target.getDate() === daysInMonth(target.getFullYear(), target.getMonth());
      }
      if (dayMode === 'before-last') {
        const offset = Math.min(3, Math.max(0, task.frequency.offset || 0));
        return target.getDate() === daysInMonth(target.getFullYear(), target.getMonth()) - offset;
      }
      if (dayMode === 'weekday') {
        const { weekday, ordinal } = task.frequency;
        if (target.getDay() !== weekday) return false;
        if (ordinal === 'last') return addDays(target, 7).getMonth() !== target.getMonth();
        const nth = Math.floor((target.getDate() - 1) / 7) + 1;
        return nth === ordinal;
      }
      const expectedDay = Math.min(due.getDate(), daysInMonth(target.getFullYear(), target.getMonth()));
      return target.getDate() === expectedDay;
    }

    default:
      return false;
  }
}

// Generous bound (~10 years of days) for the scans below -- not a real-world
// limit, just a safety net against a pathological/corrupt task never
// matching and looping forever.
const MAX_SCAN_DAYS = 3660;

// The most recent occurrence date <= todayISO, or null if the task's anchor
// due date hasn't arrived yet. For 'once' tasks this is just the due date
// itself (for any today on or after it) -- a missed one-off doesn't vanish,
// it stays "pending" until completed, same as any other frequency.
//
// task.endDate (optional) stops the series on or before that date -- if it's
// earlier than todayISO, the search is clamped to endDate instead, same as
// if "today" were endDate, so a recurring task doesn't keep surfacing missed
// occurrences past the date its recurrences were meant to stop.
//
// Implemented as a bounded backward scan via occursOn() rather than a
// closed-form step calculation per frequency type: the weekday-of-month and
// multi-weekday-per-week patterns don't reduce to simple arithmetic the way
// "every N days" does, so one shared, easier-to-verify mechanism beats a
// different formula for every case. Cheap enough for a to-do list's needs --
// occursOn() is O(1), and real gaps between occurrences are at most a few
// months even for exotic patterns (e.g. a 5th-weekday-of-month that skips
// short months).
function mostRecentOccurrenceOnOrBefore(task, todayISO) {
  const searchISO = task.endDate && task.endDate < todayISO ? task.endDate : todayISO;
  if (daysBetween(task.dueDate, searchISO) < 0) return null;
  if (task.frequency.type === 'once') return task.dueDate;

  let cursor = searchISO;
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    if (occursOn(task, cursor)) return cursor;
    if (cursor === task.dueDate) return null;
    cursor = dateToISO(addDays(new Date(cursor + 'T00:00:00'), -1));
  }
  return null;
}

// The next occurrence strictly after afterISO, or null if there isn't one
// (a 'once' task's single occurrence is already on/before afterISO, or
// task.endDate has been reached). Complements
// mostRecentOccurrenceOnOrBefore -- used by the to-do list's "next
// recurrence" view to show what's coming up once the current one is done,
// rather than only what's due now or overdue. Same bounded-scan approach.
function nextOccurrenceAfter(task, afterISO) {
  if (daysBetween(task.dueDate, afterISO) < 0) return task.dueDate; // hasn't started yet -- its first occurrence is next
  if (task.frequency.type === 'once') return null; // its one occurrence is already on/before afterISO

  let cursor = dateToISO(addDays(new Date(afterISO + 'T00:00:00'), 1));
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    if (task.endDate && cursor > task.endDate) return null;
    if (occursOn(task, cursor)) return cursor;
    cursor = dateToISO(addDays(new Date(cursor + 'T00:00:00'), 1));
  }
  return null;
}

// The occurrence immediately before dateISO (dateISO is assumed to itself be
// a valid occurrence of task), or null if there isn't one -- dateISO is the
// task's very first occurrence. Complements nextOccurrenceAfter; used by the
// to-do list's "edit this occurrence" / "edit this and following" split to
// know where the historical portion of the series should end.
function previousOccurrenceBefore(task, dateISO) {
  const dayBefore = dateToISO(addDays(new Date(dateISO + 'T00:00:00'), -1));
  return mostRecentOccurrenceOnOrBefore(task, dayBefore);
}

// Whether occurrenceDateISO's window -- its due time, or end of day for an
// all-day task -- has already passed as of `now`. The shared threshold
// behind isOverdue() below; also used directly by passive tasks, which
// auto-complete once their window for the day ends rather than ever
// becoming "overdue".
function hasOccurrenceEnded(task, occurrenceDateISO, now) {
  const [h, m] = (task.dueTime || '23:59').split(':').map(Number);
  const dueDateTime = new Date(occurrenceDateISO + 'T00:00:00');
  dueDateTime.setHours(h, m, 0, 0);
  return now.getTime() > dueDateTime.getTime();
}

// An all-day task has no dueTime -- falling back to 23:59 in
// hasOccurrenceEnded already gives the right "overdue only once the day
// itself has passed" behavior on its own. The one exception is a
// daily-recurring (every 1 day) all-day task: that's not a string of
// independent daily occurrences, it's one continuous task spanning from its
// due date to its end date (e.g. "multi-day project"), so it's only
// overdue once truly past that end date -- or never, if there isn't one.
function isOverdue(task, occurrenceDateISO, now) {
  if (task.allDay && task.frequency.type === 'days' && (task.frequency.interval || 1) === 1) {
    return !!task.endDate && dateToISO(now) > task.endDate;
  }
  return hasOccurrenceEnded(task, occurrenceDateISO, now);
}

const api = {
  dateToISO,
  addDays,
  daysBetween,
  daysInMonth,
  monthsBetween,
  occursOn,
  mostRecentOccurrenceOnOrBefore,
  nextOccurrenceAfter,
  previousOccurrenceBefore,
  isOverdue,
  hasOccurrenceEnded,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  window.Recurrence = api;
}

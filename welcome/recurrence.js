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
function occursOn(task, dateISO) {
  const diffDays = daysBetween(task.dueDate, dateISO);
  if (diffDays < 0) return false;
  const interval = Math.max(1, task.frequency.interval || 1);
  switch (task.frequency.type) {
    case 'once':
      return diffDays === 0;
    case 'days':
      return diffDays % interval === 0;
    case 'weeks':
      return diffDays % (interval * 7) === 0;
    case 'months': {
      const diffMonths = monthsBetween(task.dueDate, dateISO);
      if (diffMonths < 0 || diffMonths % interval !== 0) return false;
      const due = new Date(task.dueDate + 'T00:00:00');
      const target = new Date(dateISO + 'T00:00:00');
      const expectedDay = Math.min(due.getDate(), daysInMonth(target.getFullYear(), target.getMonth()));
      return target.getDate() === expectedDay;
    }
    default:
      return false;
  }
}

// The most recent occurrence date <= todayISO, or null if the task's anchor
// due date hasn't arrived yet. For 'once' tasks this is just the due date
// itself (for any today on or after it) -- a missed one-off doesn't vanish,
// it stays "pending" until completed, same as any other frequency.
function mostRecentOccurrenceOnOrBefore(task, todayISO) {
  const diffDays = daysBetween(task.dueDate, todayISO);
  if (diffDays < 0) return null;
  const interval = Math.max(1, task.frequency.interval || 1);
  switch (task.frequency.type) {
    case 'once':
      return task.dueDate;
    case 'days': {
      const stepIndex = Math.floor(diffDays / interval);
      return dateToISO(addDays(new Date(task.dueDate + 'T00:00:00'), stepIndex * interval));
    }
    case 'weeks': {
      const stepDays = interval * 7;
      const stepIndex = Math.floor(diffDays / stepDays);
      return dateToISO(addDays(new Date(task.dueDate + 'T00:00:00'), stepIndex * stepDays));
    }
    case 'months': {
      const due = new Date(task.dueDate + 'T00:00:00');
      const today = new Date(todayISO + 'T00:00:00');
      const occurrenceForStep = (stepIndex) => {
        const d = new Date(due.getFullYear(), due.getMonth() + stepIndex * interval, 1);
        d.setDate(Math.min(due.getDate(), daysInMonth(d.getFullYear(), d.getMonth())));
        return d;
      };
      // monthsBetween ignores day-of-month, so e.g. Jan-31 -> Feb (clamped to
      // the 28th) overshoots for any today earlier than the 28th; step back
      // one interval when that happens.
      let stepIndex = Math.floor(monthsBetween(task.dueDate, todayISO) / interval);
      let occurrence = occurrenceForStep(stepIndex);
      if (occurrence > today) occurrence = occurrenceForStep(--stepIndex);
      return stepIndex < 0 ? null : dateToISO(occurrence);
    }
    default:
      return null;
  }
}

function isOverdue(task, occurrenceDateISO, now) {
  const [h, m] = (task.dueTime || '23:59').split(':').map(Number);
  const dueDateTime = new Date(occurrenceDateISO + 'T00:00:00');
  dueDateTime.setHours(h, m, 0, 0);
  return now.getTime() > dueDateTime.getTime();
}

const api = {
  dateToISO,
  addDays,
  daysBetween,
  daysInMonth,
  monthsBetween,
  occursOn,
  mostRecentOccurrenceOnOrBefore,
  isOverdue,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  window.Recurrence = api;
}

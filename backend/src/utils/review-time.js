'use strict';

const reviewDatePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;

const createError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const parseReviewDate = (value) => {
  if (typeof value !== 'string') {
    throw createError(400, 'reviewDate must be an ISO date-time with a timezone offset.');
  }

  const match = reviewDatePattern.exec(value);
  if (!match) {
    throw createError(400, 'reviewDate must be an ISO date-time with a timezone offset.');
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0'] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const dateOnly = new Date(Date.UTC(year, month - 1, day));
  if (
    dateOnly.getUTCFullYear() !== year ||
    dateOnly.getUTCMonth() !== month - 1 ||
    dateOnly.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw createError(400, 'reviewDate must be a valid calendar date and time.');
  }

  const reviewDate = new Date(value);
  if (Number.isNaN(reviewDate.getTime())) {
    throw createError(400, 'reviewDate must be a valid date.');
  }
  return reviewDate;
};

const formatterFor = (timeZone) => new Intl.DateTimeFormat('en-CA', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hourCycle: 'h23'
});

const getZonedParts = (date, formatter) => {
  const parts = formatter.formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type).value;
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour: Number(value('hour')),
    minute: Number(value('minute')),
    second: Number(value('second')),
    millisecond: Number(value('fractionalSecond'))
  };
};

const localPartsTimestamp = (parts) => Date.UTC(
  parts.year,
  parts.month - 1,
  parts.day,
  parts.hour,
  parts.minute,
  parts.second,
  parts.millisecond
);

const sameLocalTime = (left, right) =>
  left.year === right.year &&
  left.month === right.month &&
  left.day === right.day &&
  left.hour === right.hour &&
  left.minute === right.minute &&
  left.second === right.second &&
  left.millisecond === right.millisecond;

const localDateTimeToInstant = (parts, formatter) => {
  const localTimestamp = localPartsTimestamp(parts);
  const offsets = new Set();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = new Date(localTimestamp + hours * 60 * 60 * 1000);
    offsets.add(localPartsTimestamp(getZonedParts(sample, formatter)) - sample.getTime());
  }

  const candidates = Array.from(offsets, (offset) => new Date(localTimestamp - offset));
  const exactMatches = candidates
    .filter((candidate) => sameLocalTime(getZonedParts(candidate, formatter), parts))
    .sort((left, right) => left.getTime() - right.getTime());
  if (exactMatches.length) {
    return exactMatches[0];
  }

  const afterGap = candidates
    .map((candidate) => ({
      candidate,
      localTimestamp: localPartsTimestamp(getZonedParts(candidate, formatter))
    }))
    .filter((item) => item.localTimestamp > localTimestamp)
    .sort((left, right) => left.localTimestamp - right.localTimestamp)[0];
  if (afterGap) {
    return afterGap.candidate;
  }

  throw new RangeError('The reminder local time could not be resolved in the configured timezone.');
};

const calculateReminderDate = (reviewDate, timeZone) => {
  const formatter = formatterFor(timeZone);
  const localReview = getZonedParts(reviewDate, formatter);
  const reminderCalendarDate = new Date(Date.UTC(
    localReview.year,
    localReview.month - 1,
    localReview.day - 2,
    localReview.hour,
    localReview.minute,
    localReview.second,
    localReview.millisecond
  ));
  const reminderLocal = {
    year: reminderCalendarDate.getUTCFullYear(),
    month: reminderCalendarDate.getUTCMonth() + 1,
    day: reminderCalendarDate.getUTCDate(),
    hour: reminderCalendarDate.getUTCHours(),
    minute: reminderCalendarDate.getUTCMinutes(),
    second: reminderCalendarDate.getUTCSeconds(),
    millisecond: reminderCalendarDate.getUTCMilliseconds()
  };
  return localDateTimeToInstant(reminderLocal, formatter);
};

const formatReviewDate = (reviewDate, timeZone) =>
  new Intl.DateTimeFormat('en', {
    timeZone,
    dateStyle: 'long',
    timeStyle: 'short'
  }).format(reviewDate);

module.exports = {
  calculateReminderDate,
  formatReviewDate,
  parseReviewDate
};

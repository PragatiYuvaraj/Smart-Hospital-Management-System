interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterFor = (timeZone: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

const zonedParts = (date: Date, formatter: Intl.DateTimeFormat): ZonedDateTimeParts => {
  const parts = formatter.formatToParts(date);
  const value = (type: string): number => {
    const part = parts.find((item) => item.type === type);
    if (!part) {
      throw new RangeError(`Could not read ${type} in the configured hospital timezone.`);
    }
    return Number(part.value);
  };
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second')
  };
};

const wallClockTimestamp = (parts: ZonedDateTimeParts): number =>
  Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

const pad = (value: number): string => String(value).padStart(2, '0');

const localDateTimeToInstant = (
  parts: ZonedDateTimeParts,
  formatter: Intl.DateTimeFormat,
  resolveGap: boolean
): Date | null => {
  const requestedTimestamp = wallClockTimestamp(parts);
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = new Date(requestedTimestamp + hours * 60 * 60 * 1000);
    offsets.add(wallClockTimestamp(zonedParts(sample, formatter)) - sample.getTime());
  }

  const candidates = Array.from(offsets, (offset) => new Date(requestedTimestamp - offset));
  const exactMatches = candidates
    .filter((candidate) =>
      wallClockTimestamp(zonedParts(candidate, formatter)) === requestedTimestamp
    )
    .sort((left, right) => left.getTime() - right.getTime());
  if (exactMatches.length > 0) return exactMatches[0];
  if (!resolveGap) return null;

  const afterGap = candidates
    .map((candidate) => ({
      candidate,
      localTimestamp: wallClockTimestamp(zonedParts(candidate, formatter))
    }))
    .filter((item) => item.localTimestamp > requestedTimestamp)
    .sort((left, right) => left.localTimestamp - right.localTimestamp)[0];
  return afterGap?.candidate ?? null;
};

const isoWithOffset = (
  value: string,
  instant: Date,
  formatter: Intl.DateTimeFormat
): string | null => {
  const offsetMinutes =
    (wallClockTimestamp(zonedParts(instant, formatter)) - instant.getTime()) / 60000;
  if (!Number.isInteger(offsetMinutes)) return null;

  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  return `${value}:00${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
};

export function formatHospitalDateTimeInput(date: Date, timeZone: string): string {
  const parts = zonedParts(date, formatterFor(timeZone));
  return `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}` +
    `T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function hospitalDateTimeInputToIso(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const requested: ZonedDateTimeParts = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: 0
  };
  const requestedTimestamp = wallClockTimestamp(requested);
  const calendarDate = new Date(requestedTimestamp);
  if (
    calendarDate.getUTCFullYear() !== requested.year ||
    calendarDate.getUTCMonth() + 1 !== requested.month ||
    calendarDate.getUTCDate() !== requested.day ||
    requested.hour > 23 ||
    requested.minute > 59
  ) {
    return null;
  }

  const formatter = formatterFor(timeZone);
  // Choose the earlier instant when a daylight-saving transition repeats a wall time.
  const instant = localDateTimeToInstant(requested, formatter, false);
  return instant ? isoWithOffset(value, instant, formatter) : null;
}

export function calculateHospitalReminderDate(
  reviewDate: string,
  timeZone: string
): Date | null {
  const reviewInstant = new Date(reviewDate);
  if (Number.isNaN(reviewInstant.getTime())) return null;

  const formatter = formatterFor(timeZone);
  const localReview = zonedParts(reviewInstant, formatter);
  const reminderCalendarDate = new Date(Date.UTC(
    localReview.year,
    localReview.month - 1,
    localReview.day - 2,
    localReview.hour,
    localReview.minute,
    localReview.second
  ));
  const reminderLocal: ZonedDateTimeParts = {
    year: reminderCalendarDate.getUTCFullYear(),
    month: reminderCalendarDate.getUTCMonth() + 1,
    day: reminderCalendarDate.getUTCDate(),
    hour: reminderCalendarDate.getUTCHours(),
    minute: reminderCalendarDate.getUTCMinutes(),
    second: reminderCalendarDate.getUTCSeconds()
  };
  return localDateTimeToInstant(reminderLocal, formatter, true);
}

export function formatHospitalReviewDate(date: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(date));
}

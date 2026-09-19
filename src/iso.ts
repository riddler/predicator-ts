/**
 * Writing a date and an instant as ISO 8601 text, reading back the forms the
 * casts accept, and the calendar test those parses rest on.
 *
 * Two parts of this package turn a date or a datetime into text and back: the
 * corpus codec, whose wire form is the corpus's contract, and the `::string`
 * and `::date` / `::datetime` casts, whose forms are the instruction set's.
 * The two contracts are stated separately and may be revised separately, so
 * what this module holds is what they agree on today: the formatting, which
 * the instruction set and the corpus specify with the same words, and the
 * calendar test, which belongs to neither contract but to the proleptic
 * Gregorian calendar. The codec applies a further condition of its own on top
 * of that test, and states it where it applies it.
 *
 * The parses below are the cast's. The codec keeps its own, because the two
 * accept different texts: the wire form's offset position admits a UTC `Z`
 * and nothing else, while the cast's datetime parse admits the offset
 * spellings the reference's parser admits, and normalizes them.
 */

import { civilFromDays, daysFromCivil } from "./civil.js";
import { PDate, PDateTime } from "./values.js";

const SECONDS_PER_DAY = 86400;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

/** The calendar date the cast's `::date` parse accepts, and no other shape. */
const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The datetime the cast's `::datetime` parse accepts: a calendar date, a
 * separator, a time of day, an optional fraction of a second, and a UTC
 * offset.
 *
 * The offset is required, which is the instruction set's own wording, and it
 * is what makes a date-only string unconvertible to a datetime. The rest of
 * the shape follows the reference's, with the one exception declared below,
 * and was read off the clauses of the host ISO parser it routes through: the
 * date and the time may be separated by `T` or by a space,
 * the fraction may be introduced by a full stop or by a comma, and the offset
 * is `Z`, a sign with hours and minutes written with or without a colon, or a
 * sign with hours alone.
 *
 * Where that was read: the instruction set says "ISO 8601 datetime with a UTC
 * offset, normalized to UTC" and fixes no spelling. The corpus pins the `T`
 * separator, the full-stop fraction and the `Z` offset, by feeding each of
 * them to this parse. The spellings beyond those were read off the reference:
 * it hands the text to its host language's ISO parser, and that parser's own
 * clauses are what the set here follows - Elixir 1.18.3, the offset clauses
 * and the date-time separator list in its calendar module.
 *
 * What this shape does NOT admit, and the reference does: a leading sign on
 * the whole text, which the reference reads as the sign of the year. The
 * `::string` direction writes a year as four unsigned digits, so admitting a
 * negative year here would make a text this package can read and cannot write
 * back. A plus names a year this shape already admits without it, and so does
 * a minus before a year of four zeroes, which makes no year negative; each is
 * refused beside the negative year so that the sign is one rule rather than
 * two.
 * That divergence is declared rather than closed.
 */
const DATETIME_TEXT =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * An offset the reference's shape clauses would admit and an earlier clause
 * singles out for refusal.
 *
 * Its parser answers an error for this exact text while accepting the same
 * offset written without the colon, and a conversion that answered an instant
 * here would be producing a value the reference calls undefined. The totality
 * rule licenses answering an absence where a value cannot be produced; it does
 * not license the other direction.
 */
const REFUSED_OFFSET = "-00:00";

/**
 * Answers whether a year, a month and a day name a real civil date.
 *
 * Calendar arithmetic that rolls `2026-02-30` forward into March is a silent
 * reinterpretation of what the text said, so the components are converted to a
 * day number and read back, and a date that does not survive that round trip
 * is not one. The day-number pair is written-out arithmetic over the proleptic
 * Gregorian calendar, which is why the test is made with it rather than with
 * the host's epoch constructor: that constructor reads a year from zero to
 * ninety-nine as that year plus 1900, and this domain holds dates in those
 * years, writes them and does arithmetic on them.
 */
export function isCivilDate(year: number, month: number, day: number): boolean {
  const roundTrip = civilFromDays(daysFromCivil(year, month, day));
  return roundTrip.year === year && roundTrip.month === month && roundTrip.day === day;
}

function pad(magnitude: number, width: number): string {
  return String(magnitude).padStart(width, "0");
}

/** Writes a date as an ISO 8601 calendar date. */
export function formatDate(value: PDate): string {
  return `${pad(value.year, 4)}-${pad(value.month, 2)}-${pad(value.day, 2)}`;
}

/**
 * Writes an instant in the normative shape: ISO 8601 in UTC, with the fraction
 * omitted entirely when the sub-second component is zero and exactly six
 * digits when it is not, never any other count and never a zero fraction
 * spelled out.
 */
export function formatDateTime(value: PDateTime): string {
  const instant = new Date(value.epochSeconds * 1000);
  const year = pad(instant.getUTCFullYear(), 4);
  const date = `${year}-${pad(instant.getUTCMonth() + 1, 2)}-${pad(instant.getUTCDate(), 2)}`;
  const hours = pad(instant.getUTCHours(), 2);
  const time = `${hours}:${pad(instant.getUTCMinutes(), 2)}:${pad(instant.getUTCSeconds(), 2)}`;
  const fraction = value.microsecond === 0 ? "" : `.${pad(value.microsecond, 6)}`;
  return `${date}T${time}${fraction}Z`;
}

/**
 * Reads an ISO 8601 calendar date, or answers nothing when the text is not
 * one.
 *
 * The whole text has to be the date. A JavaScript `$` outside multiline mode
 * asserts the end of the input rather than a position before a trailing
 * newline, so the anchors here refuse `"2026-08-09\n"` without a further
 * guard; a PCRE-flavoured `$` would have accepted it, which is the anchoring
 * defect the corpus carries cases for.
 *
 * One divergence from the reference is declared rather than closed, the same
 * one the datetime shape declares: the reference reads a leading sign on the
 * whole text as the sign of the year, and this refuses either sign. A minus
 * is refused for the round trip where it makes the year negative - `::string`
 * writes a year as four unsigned digits, so a negative year would read in and
 * not write back. A plus names a year this shape already admits without it,
 * and so does a minus before a year of four zeroes; each is refused beside the
 * negative year so that the sign is one rule rather than two.
 */
export function readDate(text: string): PDate | undefined {
  const match = DATE_TEXT.exec(text);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isCivilDate(year, month, day)) return undefined;
  return new PDate(year, month, day);
}

/**
 * Reads an ISO 8601 datetime carrying a UTC offset and answers the instant it
 * names, or nothing when the text is not one.
 *
 * The offset is applied rather than remembered: the value domain's instant
 * carries no zone, so two texts naming the same instant read back equal. Digits
 * past the sixth are truncated, which is the precision the domain holds, and
 * that truncation is why writing a parsed instant back out is a
 * canonicalization rather than a string identity.
 */
export function readDateTime(text: string): PDateTime | undefined {
  const match = DATETIME_TEXT.exec(text);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (!isCivilDate(year, month, day)) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  // The offset group is not optional in the pattern, so this arm narrows the
  // type rather than answering a text the pattern admitted.
  const written = match[8];
  if (written === undefined) return undefined;
  const offset = readOffset(written);
  if (offset === undefined) return undefined;
  const microsecond = Number(`${match[7] ?? ""}000000`.slice(0, 6));
  const seconds =
    daysFromCivil(year, month, day) * SECONDS_PER_DAY +
    hour * SECONDS_PER_HOUR +
    minute * SECONDS_PER_MINUTE +
    second;
  return new PDateTime(seconds - offset, microsecond);
}

/**
 * The seconds a written UTC offset stands east of UTC, or nothing when the
 * reference refuses that offset.
 *
 * The pattern above fixes the offset's shape and leaves its magnitudes to
 * this, the same division of labour the time of day gets. The hour and minute
 * bounds are the reference's own, and so is the singled-out spelling: written
 * without its colon the same offset is accepted, which reads more like an
 * accident of the clause order than a rule, and is mirrored here anyway,
 * because a text the reference calls undefined is not a text this may answer a
 * value for.
 */
function readOffset(text: string): number | undefined {
  if (text === "Z") return 0;
  if (text === REFUSED_OFFSET) return undefined;
  const digits = text.slice(1).replace(":", "");
  const hours = Number(digits.slice(0, 2));
  const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
  if (hours > 23 || minutes > 59) return undefined;
  const magnitude = hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE;
  return text.startsWith("-") ? -magnitude : magnitude;
}

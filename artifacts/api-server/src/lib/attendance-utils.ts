/**
 * Returns the calendar date in IST (Asia/Kolkata) as "YYYY-MM-DD".
 * Used to stamp attendance_date at check-in time so that if the admin
 * changes the event date later the old check-in is treated as invalid.
 */
export function getISTDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * Attendance status helpers.
 *
 * All comparisons use full 24-hour datetimes in IST (+05:30) so there are no
 * AM/PM ambiguities and no timezone drift.  Status is ALWAYS computed
 * dynamically from the stored actual times vs the stored expected times —
 * never hardcoded.
 */

/**
 * Build an IST datetime (as a Date) from an event date and a "HH:MM" time string.
 *
 * @param eventStartDate  Any ISO/Date representing the event day (used for the
 *                        calendar date only; time component is ignored)
 * @param hhMM            24-hour time string, e.g. "09:00" or "18:30"
 * @returns               A Date representing that moment in IST, or null when
 *                        either argument is falsy / un-parseable.
 */
export function buildISTDatetime(
  eventStartDate: Date | string | null | undefined,
  hhMM: string | null | undefined,
): Date | null {
  if (!eventStartDate || !hhMM) return null;
  try {
    const [h, m] = hhMM.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return null;

    const evtDate = typeof eventStartDate === "string"
      ? new Date(eventStartDate)
      : eventStartDate;

    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric", month: "2-digit", day: "2-digit",
    });
    const parts = formatter.formatToParts(evtDate);
    const get = (t: string) => parts.find(p => p.type === t)!.value;
    const dateStr = `${get("year")}-${get("month")}-${get("day")}`;

    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    const result = new Date(`${dateStr}T${hh}:${mm}:00+05:30`);
    return isNaN(result.getTime()) ? null : result;
  } catch {
    return null;
  }
}

/**
 * Compute check-in status by comparing actual check-in time against the
 * event's expected check-in time.
 *
 * Rules:
 *   checkedInAt > expectedCheckInDT  →  "late"
 *   checkedInAt <= expectedCheckInDT →  "on-time"
 *   missing data                     →  null
 */
export function computeCheckInStatus(
  checkedInAt: Date | string | null | undefined,
  expectedCheckIn: string | null | undefined,
  eventStartDate: Date | string | null | undefined,
): "late" | "on-time" | null {
  if (!checkedInAt) return null;
  const expectedDT = buildISTDatetime(eventStartDate, expectedCheckIn);
  if (!expectedDT) return null;
  const actual = typeof checkedInAt === "string" ? new Date(checkedInAt) : checkedInAt;
  return actual > expectedDT ? "late" : "on-time";
}

/**
 * Compute check-out status by comparing actual check-out time against the
 * event's expected check-out time.
 *
 * Rules:
 *   checkOutAt < expectedCheckOutDT  →  "early"
 *   checkOutAt >= expectedCheckOutDT →  null  (on-time or overtime — no label)
 *   missing data                     →  null
 */
export function computeCheckOutStatus(
  checkOutAt: Date | string | null | undefined,
  expectedCheckOut: string | null | undefined,
  eventStartDate: Date | string | null | undefined,
): "early" | null {
  if (!checkOutAt) return null;
  const expectedDT = buildISTDatetime(eventStartDate, expectedCheckOut);
  if (!expectedDT) return null;
  const actual = typeof checkOutAt === "string" ? new Date(checkOutAt) : checkOutAt;
  return actual < expectedDT ? "early" : null;
}

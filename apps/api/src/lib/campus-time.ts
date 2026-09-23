// The university runs on Dhaka time (UTC+6, no daylight saving); the server usually runs on UTC.
const dhakaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Midnight at the start of the current campus (Dhaka) day. */
export const campusDayStart = (now = new Date()): Date => new Date(`${dhakaDate.format(now)}T00:00:00+06:00`);

/** Midnight at the end of the current campus (Dhaka) day. */
export const campusDayEnd = (now = new Date()): Date => new Date(campusDayStart(now).getTime() + 86_400_000);

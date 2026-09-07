/**
 * Meal schedule — single source of truth for food breaks.
 * The event is a 2-day hackathon. Each day has the same set of meal windows.
 * Times are in local server time; adjust for the actual event.
 *
 * Event days are computed from a real anchor date (EVENT_DAY_ONE, env or
 * default), never from calendar-date parity — so food tokens are minted for
 * the correct event day.
 *
 * The current meal is derived from the current time (see getCurrentMeal).
 * When no meal is active, participants see "No food break right now".
 */

export const MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS'];

export const EVENT_DAYS = [1, 2];

/** Time windows per meal, [start, end) as "HH:MM". */
export const MEAL_WINDOWS = {
  BREAKFAST: ['08:00', '09:30'],
  LUNCH: ['13:00', '14:30'],
  DINNER: ['19:30', '21:00'],
  SNACKS: ['16:30', '17:30'],
};

/**
 * Anchor date of event day 1 (YYYY-MM-DD, local server time). Configurable via
 * EVENT_DAY_ONE so the real event dates drive food access; dev default keeps a
 * fresh seed/demo usable without extra env setup.
 */
function getEventDayOne() {
  const raw = process.env.EVENT_DAY_ONE;
  if (!raw) return null;
  const d = new Date(`${raw}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Convert "HH:MM" to minutes since midnight. */
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Event day 1/2 for the given time, or null when the date is not one of the
 * two event days. Day 1 = the EVENT_DAY_ONE anchor date; day 2 = the next day.
 * When no anchor is configured, returns 1 so dev/demo flows keep working
 * (documented dev behavior, not a production default).
 */
export function getCurrentEventDay(now = new Date()) {
  const dayOne = getEventDayOne();
  if (!dayOne) return 1;

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayOneStart = new Date(dayOne.getFullYear(), dayOne.getMonth(), dayOne.getDate());
  const diffDays = Math.round((startOfDay - dayOneStart) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 1;
  if (diffDays === 1) return 2;
  return null;
}

/**
 * Return the active meal for the given time, or null if no meal window is open
 * or the date is not an event day. { mealType, eventDay }
 */
export function getCurrentMeal(now = new Date()) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const eventDay = getCurrentEventDay(now);
  if (eventDay === null) return null;

  for (const mealType of MEAL_TYPES) {
    const [start, end] = MEAL_WINDOWS[mealType].map(toMinutes);
    if (minutes >= start && minutes < end) {
      return { mealType, eventDay };
    }
  }
  return null;
}

/** Human-readable label, e.g. "Day 1 · Lunch". */
export function mealLabel(mealType, eventDay) {
  const capitalized = mealType.charAt(0) + mealType.slice(1).toLowerCase();
  return `Day ${eventDay} · ${capitalized}`;
}

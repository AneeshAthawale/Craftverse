/**
 * Meal schedule — single source of truth for food breaks.
 * The event is a 2-day hackathon. Each day has the same set of meal windows.
 * Times are in local server time; adjust for the actual event.
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

/** Convert "HH:MM" to minutes since midnight. */
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Event day 1/2 based on the server's current date (fixed offset from epoch day). */
export function getCurrentEventDay(now = new Date()) {
  const daysSinceEpoch = Math.floor(now.getTime() / (1000 * 60 * 60 * 24));
  return (daysSinceEpoch % 2) + 1;
}

/**
 * Return the active meal for the given time, or null if no meal window is open.
 * { mealType, eventDay }
 */
export function getCurrentMeal(now = new Date()) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const eventDay = getCurrentEventDay(now);

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

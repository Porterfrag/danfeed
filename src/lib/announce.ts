/**
 * Tell a screen reader about something it cannot see.
 *
 * Most of this app's feedback is visual and lands on an element the user is not standing on: a
 * bookmark fills in, a row says "Copied" after focus has moved past it, a search replaces the
 * feed behind a closed panel. None of that reaches someone listening instead of looking, so
 * those moments are announced through one polite live region at the app root.
 *
 * A module-level event rather than a callback threaded through the tree: the announcer is not
 * part of any component's data flow, and the alternative is prop-drilling a setter into every
 * leaf that has something to say.
 */
export const ANNOUNCE_EVENT = 'danfeed:announce'

export function announce(message: string) {
  window.dispatchEvent(new CustomEvent(ANNOUNCE_EVENT, { detail: message }))
}

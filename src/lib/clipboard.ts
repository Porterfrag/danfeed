/**
 * Copy text to the clipboard.
 *
 * The async clipboard API needs a secure context and a permission, and neither is guaranteed:
 * the app also runs from an http:// address on a LAN, inside in-app browsers, and in older
 * WebViews. `execCommand` is deprecated but remains the only path in those places, so it is a
 * fallback rather than the primary. Returns whether the text made it.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return legacyCopy(text)
  }
}

function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    // Off-screen rather than hidden: a `display: none` element cannot hold a selection.
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

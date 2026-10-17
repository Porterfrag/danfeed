/**
 * Save text as a file from the page, with no server involved.
 *
 * The object URL is revoked on a delay rather than immediately after the click: the download
 * starts asynchronously, and a URL revoked too early leaves an empty file.
 */
export function downloadText(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** `danfeed-backup-2026-10-17.json` — the date says which browser the copy came from. */
export function backupFilename() {
  const day = new Date().toISOString().slice(0, 10)
  return `danfeed-backup-${day}.json`
}

/**
 * Tag searches are space-separated, so autocomplete must only complete the word
 * currently being typed and leave the earlier tags alone.
 *
 *   "1girl hats" -> { prefix: "1girl ", token: "hats" }
 *   "hats"       -> { prefix: "",       token: "hats" }
 *   "1girl "     -> { prefix: "1girl ", token: ""     }  // nothing to complete
 */
export function splitQuery(value: string): { prefix: string; token: string } {
  const lastSpace = value.lastIndexOf(' ')
  if (lastSpace < 0) return { prefix: '', token: value }
  return {
    prefix: value.slice(0, lastSpace + 1),
    token: value.slice(lastSpace + 1),
  }
}

/** Build the new input value after accepting a suggestion. */
export function applySuggestion(value: string, tagValue: string): string {
  const { prefix } = splitQuery(value)
  return `${prefix}${tagValue} `
}

/**
 * Pure, dependency-free templating for reusable prompts (and, later, snippets and
 * workspace commands). Deliberately **logic-less**: a template is plain text with
 * `{{variable}}` placeholders, and rendering only ever *substitutes* a value for a
 * placeholder. Values are never re-interpreted as template syntax, and nothing is
 * ever evaluated as code — this is the data-vs-template separation that keeps the
 * engine safe against template-injection (a rendered value containing `{{x}}` or
 * shell/JS metacharacters is inert, treated as literal text).
 *
 * Placeholder grammar (mirrors Warp's `{{...}}` convention so muscle memory
 * transfers):
 * - `{{name}}`                 — a required variable.
 * - `{{name:default text}}`    — a variable with a default value.
 * - `{{name|description}}`     — a variable with a fill-UI description.
 * - `{{name:default|desc}}`    — both (default first, then description).
 *
 * A literal double-brace is written `\{{` and renders as `{{` with no
 * substitution. Names are trimmed; a name may contain spaces but not `{`, `}`,
 * `:`, `|`, or a leading/trailing space (those delimit the parts).
 */

export interface TemplateVar {
  /** The variable name (trimmed). */
  name: string
  /** Default value if the caller supplies none; undefined when absent. */
  default?: string
  /** Optional human description for the fill UI; undefined when absent. */
  description?: string
}

// A placeholder: `{{ ... }}` not preceded by a backslash (which escapes it).
// The negative-lookbehind keeps `\{{` from being treated as a placeholder.
const PLACEHOLDER = /(?<!\\)\{\{([^{}]*)\}\}/g

// The escape for a literal `{{` — a backslash immediately before `{{`.
const ESCAPED_OPEN = /\\\{\{/g

interface ParsedPlaceholder {
  name: string
  default?: string
  description?: string
}

/**
 * Splits the inside of a `{{...}}` into name / default / description. Order is
 * `name[:default][|description]`. Returns null when the name is empty.
 */
function parsePlaceholderBody(body: string): ParsedPlaceholder | null {
  // Description is everything after the first '|'.
  let description: string | undefined
  let head = body
  const pipe = body.indexOf('|')
  if (pipe !== -1) {
    head = body.slice(0, pipe)
    description = body.slice(pipe + 1).trim()
  }

  // Default is everything after the first ':' in the head.
  let def: string | undefined
  let name = head
  const colon = head.indexOf(':')
  if (colon !== -1) {
    name = head.slice(0, colon)
    def = head.slice(colon + 1).trim()
  }

  name = name.trim()
  if (name === '') return null
  return { name, default: def, description }
}

/**
 * Extracts the distinct variables declared in a template, in first-seen order.
 * When the same name appears more than once, the first occurrence that carries a
 * default/description wins for that field (later bare `{{name}}` uses don't erase
 * an earlier default). Never throws.
 */
export function parseTemplateVars(text: string): TemplateVar[] {
  const order: string[] = []
  const byName = new Map<string, TemplateVar>()

  for (const match of text.matchAll(PLACEHOLDER)) {
    const parsed = parsePlaceholderBody(match[1] ?? '')
    if (parsed === null) continue

    const existing = byName.get(parsed.name)
    if (existing === undefined) {
      order.push(parsed.name)
      byName.set(parsed.name, {
        name: parsed.name,
        default: parsed.default,
        description: parsed.description,
      })
    } else {
      // Fill in fields the first occurrence left undefined.
      if (existing.default === undefined && parsed.default !== undefined) {
        existing.default = parsed.default
      }
      if (existing.description === undefined && parsed.description !== undefined) {
        existing.description = parsed.description
      }
    }
  }

  return order.map((name) => byName.get(name) as TemplateVar)
}

/**
 * Renders a template by substituting each `{{name}}` with its value. Resolution
 * per placeholder: the caller's value if provided (including an explicit empty
 * string), else the placeholder's inline default, else the empty string. A
 * placeholder with an empty name (`{{}}` / `{{ }}`) is left verbatim. Escaped
 * `\{{` becomes a literal `{{`. Substituted values are inserted literally and are
 * never re-scanned for placeholders. Never throws.
 */
export function renderTemplate(text: string, values: Record<string, string> = {}): string {
  const substituted = text.replace(PLACEHOLDER, (whole, body: string) => {
    const parsed = parsePlaceholderBody(body ?? '')
    if (parsed === null) return whole // keep malformed/empty placeholders verbatim
    const provided = Object.hasOwn(values, parsed.name) ? values[parsed.name] : undefined
    return provided ?? parsed.default ?? ''
  })
  // Unescape `\{{` → `{{` only after substitution, so an escaped brace can never
  // become an active placeholder.
  return substituted.replace(ESCAPED_OPEN, '{{')
}

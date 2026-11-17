/** Leading characters spreadsheet apps may interpret as a formula. */
const FORMULA_PREFIXES = new Set(['=', '+', '-', '@', '\t', '\r'])

/**
 * Prefixes formula-like values with an apostrophe so spreadsheet software
 * treats them as text. Applied before quoting, so the apostrophe stays inside
 * the quoted cell.
 */
function neutralizeFormula(value: string): string {
  return value.length > 0 && FORMULA_PREFIXES.has(value[0])
    ? `'${value}`
    : value
}

function quoteCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** RFC 4180 cell with spreadsheet formula-injection protection. */
export function csvCell(value: string): string {
  return quoteCell(neutralizeFormula(value))
}

export function csvRow(values: string[]): string {
  return values.map(csvCell).join(',')
}

/** CRLF-delimited CSV with a trailing newline. */
export function toCsv(rows: string[][]): string {
  return `${rows.map(csvRow).join('\r\n')}\r\n`
}

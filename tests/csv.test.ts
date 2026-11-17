import { describe, expect, it } from 'vitest'
import { csvCell, toCsv } from '../worker/lib/csv'

describe('CSV escaping', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('Smith, Jamie')).toBe('"Smith, Jamie"')
    expect(csvCell('Smith "Jamie"')).toBe('"Smith ""Jamie"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell('two\r\nlines')).toBe('"two\r\nlines"')
  })

  it('neutralizes every spreadsheet formula prefix', () => {
    expect(csvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)")
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('-1')).toBe("'-1")
    expect(csvCell('@cmd')).toBe("'@cmd")
    expect(csvCell('\tvalue')).toBe("'\tvalue")
    expect(csvCell('\rvalue')).toBe(`"'\rvalue"`)
  })

  it('writes CRLF-separated rows with a trailing newline', () => {
    expect(
      toCsv([
        ['Reference', 'Name'],
        ['SLO-1', 'Smith, Jamie'],
      ]),
    ).toBe('Reference,Name\r\nSLO-1,"Smith, Jamie"\r\n')
  })
})

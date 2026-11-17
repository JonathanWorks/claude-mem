import { describe, expect, it } from 'bun:test';

import { summarizeSql } from '../../src/services/sqlite/sql-text.js';

describe('summarizeSql', () => {
  it('collapses every run of whitespace, newlines and tabs to one space and trims the ends', () => {
    expect(summarizeSql('  SELECT\n\t a,\r\n   b\n  FROM   t  \n')).toBe('SELECT a, b FROM t');
  });

  it('caps the result at 300 characters', () => {
    expect(summarizeSql(`SELECT ${'x'.repeat(1000)}`)).toHaveLength(300);
    expect(summarizeSql('y'.repeat(300))).toHaveLength(300);
    expect(summarizeSql('y'.repeat(299))).toHaveLength(299);
  });

  it('reads only the first 4000 characters, so text beyond them never reaches the log', () => {
    const padded = `${' '.repeat(3990)}SELECT 1${' '.repeat(10)}SECRET_TAIL`;
    expect(summarizeSql(padded)).toBe('SELECT 1');
    expect(summarizeSql(`SELECT 1${' '.repeat(3992)}SECRET_TAIL`)).toBe('SELECT 1');
    expect(summarizeSql(`${'a'.repeat(3999)} b`)).toHaveLength(300);
  });

  it('returns an empty string for empty or whitespace-only text', () => {
    expect(summarizeSql('')).toBe('');
    expect(summarizeSql(' \n\t ')).toBe('');
  });

  it('keeps multi-line statements on one line', () => {
    const sql = `SELECT *
      FROM observations
     WHERE project = ?
       AND created_at > ?`;
    expect(summarizeSql(sql)).toBe('SELECT * FROM observations WHERE project = ? AND created_at > ?');
  });
});

const SQL_LOG_LIMIT = 300;
const SQL_SCAN_LIMIT = 4000;

/** One line of SQL text for a log record: whitespace collapsed, bounded; never reads bound parameters. */
export function summarizeSql(sql: string): string {
  return sql.slice(0, SQL_SCAN_LIMIT).replace(/\s+/g, ' ').trim().slice(0, SQL_LOG_LIMIT);
}

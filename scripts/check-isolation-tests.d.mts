export interface IsolationTest {
  name: string;
  source: string;
}
export interface TableCoverage {
  table: string;
  file: string | undefined;
}
export function findTables(sources: string[]): string[];
export function coverage(tables: string[], tests: IsolationTest[]): TableCoverage[];
export function findUntestedTables(tables: string[], testSources: string[]): string[];
export function checkIsolation(input: {
  migrations: string[];
  tests: IsolationTest[];
  exempt: readonly string[];
}): { rows: TableCoverage[]; missing: string[] };
export function findUnauditedAdminReads(
  tables: readonly string[],
  tests: IsolationTest[],
): string[];

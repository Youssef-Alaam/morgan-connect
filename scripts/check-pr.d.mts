export interface ChangedFile {
  filename: string;
  additions: number;
  deletions: number;
}
type DepMap = Record<string, string>;
export interface PackageJson {
  dependencies?: DepMap;
  devDependencies?: DepMap;
  optionalDependencies?: DepMap;
}
export interface PrInput {
  title: string;
  body: string;
  files: ChangedFile[];
  basePackage: PackageJson;
  headPackage: PackageJson;
}
export function hasTicketId(title: string): boolean;
export function changedLineCount(files: ChangedFile[]): number;
export function srcChangedWithoutTest(files: ChangedFile[]): boolean;
export function addedDependencies(base: PackageJson, head: PackageJson): string[];
export function hasDependencyLine(body: string): boolean;
export function evaluatePr(input: PrInput): string[];

export interface SourceFile {
  name: string;
  source: string;
}
export interface OptionalImport {
  file: string;
  pkg: string;
}
export function importedPackages(source: string): string[];
export function isAdapterPath(name: string): boolean;
export function checkOptionalImports(
  files: SourceFile[],
  optionalNames: readonly string[],
): OptionalImport[];

interface NpmNode {
  version?: string;
  resolved?: string;
  dependencies?: Record<string, NpmNode>;
}
export function packagesIn(tree: NpmNode, seen?: Set<string>): Set<string>;
export function fontsWithoutLicence(
  fontPaths: string[],
  entries: { dir: string; licenceFile: string }[],
  fileExists: (path: string) => boolean,
): string[];

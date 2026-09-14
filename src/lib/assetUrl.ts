/**
 * Resolve a path inside /public against the deployment base.
 *
 * The current Vite base is './', so assets work at both the site root and
 * a GitHub Pages project path. Strip the leading slash from public paths.
 */
export function assetUrl(path: string): string {
  const clean = path.replace(/^\/+/, '')
  return `${import.meta.env.BASE_URL}${clean}`
}

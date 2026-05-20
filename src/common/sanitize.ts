export function sanitize(input: string, maxLength = 200): string {
  return input
    .trim()
    .slice(0, maxLength)
    .replace(/<[^>]*>/g, '')
    .replace(/[\0\\]/, '');
}

export function hr(width = 60): string {
  return '─'.repeat(width);
}

export function pad(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + ' '.repeat(width - s.length);
}

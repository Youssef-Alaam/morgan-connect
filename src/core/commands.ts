/** `/name` or `/name@BotName`, nothing else. */
export function isCommand(text: string, name: string): boolean {
  return new RegExp(`^/${name}(?:@[A-Za-z0-9_]+)?$`, 'i').test(text.trim());
}

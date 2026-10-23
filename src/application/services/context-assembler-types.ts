export interface StandingOrdersPort {
  read(): Promise<string>;
}

export interface ContextAssemblerOptions {
  maxMessages: number;
  maxContextChars: number;
  maxObservationChars: number;
  maxMemoryChars: number;
  maxSkillIndexChars: number;
}

export function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

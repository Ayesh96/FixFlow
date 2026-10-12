export const LEVELS: readonly string[];
export const POLL_INTERVALS: readonly { label: string; ms: number }[];
export const LEVEL_CHOICES: readonly { value: string; label: string }[];

export interface ProviderCheck {
  ok: boolean;
  models: string[];
  error?: string;
  unreachable?: boolean;
}

export function checkPort(port: number, host?: string): Promise<{ ok: boolean; error?: string }>;
export function checkOllama(url: string): Promise<ProviderCheck>;
export function checkDeepSeek(apiKey: string, apiUrl?: string): Promise<ProviderCheck>;
export function checkAnthropic(apiKey: string, apiUrl?: string): Promise<ProviderCheck>;
export function validateValues(values: Record<string, unknown>): { errors: Record<string, string> };
export function validateWithServer(envText: string, root: string): Promise<{ ok: boolean; problems: string[] }>;

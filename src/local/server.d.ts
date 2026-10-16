export function handleLocal(request: Request): Promise<Response>;
export function installLocalBackend(): void;
export function localAdmin<T = any>(path: string, method?: string, body?: unknown): Promise<T>;

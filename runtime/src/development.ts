export type CoreEnvironment = Readonly<Record<string, string | undefined>>;
export const DEVELOPMENT_OPTIONS = Object.freeze([
  'GAMEPLAY_CORE_DEV_CLASS_LEVEL', 'GAMEPLAY_CORE_DEV_ATTRIBUTES', 'GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY',
  'GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV', 'ENABLE_STANDING_STONE_SPIKE'
] as const);

/** offlineMode is a transport/login setting, including on the official server. */
export function isDevelopmentEnvironment(env: CoreEnvironment): boolean {
  return env.NODE_ENV === 'local' && env.GAME_ACCESS_CONTROL !== 'true'
    && env.GAMEPLAY_CORE_ALLOW_DEV_OPTIONS === 'true';
}

/** Presence, even an empty value or "false", must never silently fall through. */
export function requireDevelopmentOption(env: CoreEnvironment, option: string): void {
  if (env[option] === undefined || isDevelopmentEnvironment(env)) return;
  const reasons = [
    ...(env.NODE_ENV !== 'local' ? ['NODE_ENV must be explicitly local'] : []),
    ...(env.GAME_ACCESS_CONTROL === 'true' ? ['GAME_ACCESS_CONTROL must not be true'] : []),
    ...(env.GAMEPLAY_CORE_ALLOW_DEV_OPTIONS !== 'true' ? ['GAMEPLAY_CORE_ALLOW_DEV_OPTIONS=true is required'] : [])
  ];
  throw Object.assign(new Error(`${option} refused: ${reasons.join('; ')}`), { code: 'DEV_OPTIONS_REFUSED' });
}

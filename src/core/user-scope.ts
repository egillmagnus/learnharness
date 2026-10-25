/**
 * The current user's id for process-wide registries and the event bus
 * (fork addition, 2026-10-24 — see user-context.ts at the repo root).
 * Reads the server's globalThis anchor instead of importing it, so this
 * stays safe for the client bundles that import the core barrel.
 * Undefined in single-user mode: keys and events behave exactly as before.
 */

interface UserScopeGlobal {
	__lhUserScope?: { currentId: () => string | undefined };
}

export function currentUserId(): string | undefined {
	return (globalThis as typeof globalThis & UserScopeGlobal).__lhUserScope?.currentId();
}

/** A registry key that can't collide with, or be looked up by, another
 *  user: "<user>\u0000<key>" when a user is active, `key` otherwise. */
export function userScopedKey(key: string): string {
	const user = currentUserId();
	return user === undefined ? key : `${user}\u0000${key}`;
}

/** Whether a userScopedKey() key belongs to the current user (always,
 *  single-user) — for registries that list their entries. */
export function isOwnScopedKey(key: string): boolean {
	const user = currentUserId();
	return user === undefined || key.startsWith(`${user}\u0000`);
}

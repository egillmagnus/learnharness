/**
 * USERS (fork addition, 2026-10-24): one server, several learners, each
 * with their own data dir, API keys and files.
 *
 * OFF unless LH_USERS_FILE is set — then the app is single-user exactly as
 * before (config.ts falls back to LH_DATA_DIR / LH_AUTH_FILE). When on:
 *
 * - Every request runs inside runAsUser() (lib/with-user.ts wraps the
 *   route handlers and server pages), and an AsyncLocalStorage carries
 *   the user through everything the request starts — background jobs,
 *   compaction, extraction — so config.ts paths, keys and events resolve
 *   to that user wherever they are read.
 * - Anything that reads per-user state OUTSIDE a user context throws
 *   (requireUser). A missed seam fails loudly instead of quietly
 *   falling back to someone else's data.
 *
 * LH_USERS_FILE (JSON, keep it 0600 — it holds password hashes):
 *   { "users": [
 *       { "id": "egill", "passwordHash": "scrypt$…$…",
 *         "home": "/home/egill/learners/egill" },      // all paths under one dir
 *       { "id": "anna", "passwordHash": "…", "home": "…",
 *         "dataDir": "…", "authFile": "…", "filesRoot": "…", "sourcesDir": "…" } // optional overrides
 *   ] }
 * From `home`: dataDir = home/data, authFile = home/auth.json,
 * filesRoot = home, sourcesDir = home/sources/courses.
 * Add users with `node scripts/add-user.mjs <id>`; the file is re-read
 * when it changes, so no restart is needed.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import * as fs from "node:fs";
import path from "node:path";

export interface LhUser {
	id: string;
	passwordHash: string;
	/** Chats, graph, settings, jobs — what LH_DATA_DIR is single-user. */
	dataDir: string;
	/** Provider/search keys — what LH_AUTH_FILE is single-user. */
	authFile: string;
	/** The agent's file tools resolve and fence paths here (its "home"). */
	filesRoot: string;
	/** The Sources page's course folders (inside filesRoot). */
	sourcesDir: string;
}

const USER_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

interface Scope {
	als: AsyncLocalStorage<LhUser>;
	cache?: { file: string; mtimeMs: number; users: LhUser[] };
}

// globalThis, not module level: Next compiles route entries as separate
// module instances, and they must all see one store (the same idiom as
// the run registries). src/core/user-scope.ts reads currentId from here
// without importing node built-ins.
function scope(): Scope & { currentId: () => string | undefined } {
	const g = globalThis as typeof globalThis & { __lhUserScope?: Scope & { currentId: () => string | undefined } };
	if (!g.__lhUserScope) {
		const als = new AsyncLocalStorage<LhUser>();
		g.__lhUserScope = { als, currentId: () => als.getStore()?.id };
	}
	return g.__lhUserScope;
}

export function multiUser(): boolean {
	return Boolean(process.env.LH_USERS_FILE);
}

function parseUser(raw: unknown, usersFile: string): LhUser {
	const r = (raw ?? {}) as Record<string, unknown>;
	const id = typeof r.id === "string" ? r.id : "";
	if (!USER_ID.test(id)) throw new Error(`${usersFile}: invalid user id ${JSON.stringify(r.id)}`);
	const str = (key: string) => (typeof r[key] === "string" && r[key] ? path.resolve(r[key] as string) : undefined);
	const home = str("home");
	const pick = (key: string, fromHome: string) => {
		const value = str(key) ?? (home ? path.join(home, fromHome) : undefined);
		if (!value) throw new Error(`${usersFile}: user ${id} needs "home" or "${key}"`);
		return value;
	};
	return {
		id,
		passwordHash: typeof r.passwordHash === "string" ? r.passwordHash : "",
		dataDir: pick("dataDir", "data"),
		authFile: pick("authFile", "auth.json"),
		filesRoot: pick("filesRoot", ""),
		sourcesDir: pick("sourcesDir", path.join("sources", "courses")),
	};
}

/** Every configured user (re-read when the file changes). */
export function listUsers(): LhUser[] {
	const file = process.env.LH_USERS_FILE;
	if (!file) return [];
	const s = scope();
	const { mtimeMs } = fs.statSync(file);
	if (s.cache?.file === file && s.cache.mtimeMs === mtimeMs) return s.cache.users;
	const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as { users?: unknown[] };
	const users = (parsed.users ?? []).map((u) => parseUser(u, file));
	if (new Set(users.map((u) => u.id)).size !== users.length) throw new Error(`${file}: duplicate user ids`);
	s.cache = { file, mtimeMs, users };
	return users;
}

export function findUser(id: string): LhUser | undefined {
	return listUsers().find((u) => u.id === id);
}

/** Run `fn` (and everything it starts) as `user`. */
export function runAsUser<T>(user: LhUser, fn: () => T): T {
	return scope().als.run(user, fn);
}

/** The user this code runs for; undefined single-user or outside a request. */
export function currentUser(): LhUser | undefined {
	return scope().als.getStore();
}

/** Multi-user: the current user, or throw — never guess whose data. */
export function requireUser(what: string): LhUser | undefined {
	if (!multiUser()) return undefined;
	const user = currentUser();
	if (!user) throw new Error(`[users] ${what} read outside a user context`);
	return user;
}

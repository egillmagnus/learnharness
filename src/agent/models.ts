import {
	clampThinkingLevel,
	createModels,
	getSupportedThinkingLevels,
	type Api,
	type Model,
	type Models,
	type StreamFunction,
} from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import * as fs from "node:fs";
import { authFile, type ModelRole } from "../../config.ts";
import { multiUser } from "../../user-context.ts";
import { AUTH_PROVIDER_KEYS } from "../core/auth-keys.ts";
import { DEFAULT_THINKING_ORDER } from "../core/settings.ts";
import packageMetadata from "../../package.json" with { type: "json" };

/** App identity is immutable and shared by Models and every native Agent.
 * Agent's default Pi attribution otherwise overrides the Models identity. */
export const APP_IDENTITY = Object.freeze({
	userAgent: Object.freeze({ custom: `learnharness/${packageMetadata.version}` }),
	attribution: Object.freeze({ name: packageMetadata.name, url: packageMetadata.homepage }),
});

/**
 * The one engine factory every agent's model comes from (the pi-ai swap,
 * docs/pi-engine-swap.md). BYOK ALL THE WAY DOWN (owner, 2026-09-22):
 * there are no factory pins — every engine resolves from a RESOLVED SPEC
 * (the settings chain's output) and the one builder here wires it to
 * pi-ai's federated catalogs.
 *
 * An "engine" is the model + the stream function the agent loop runs on —
 * the two things a test fake replaces. Production engines resolve the model
 * from pi-ai's static catalogs and stream through the same Models
 * collection.
 */

export interface PiEngine {
	model: Model<Api>;
	streamFn: StreamFunction;
	/** The resolved (config-or-settings, CLAMPED) thinking level —
	 *  observability + tests; the streamFn pins it anyway. */
	level?: ThinkingLevel;
}

export type { ThinkingLevel };

let collection: ReturnType<typeof createModels> | undefined;

/** The process-wide pi-ai Models collection — EVERY builtin provider's
 *  catalog (model slots wave, 2026-09-20): engines and the picker resolve
 *  against all of pi-ai's per-provider catalogs, so a settings slot can pin
 *  any native model id. Auth is resolved per request by pi-ai itself from
 *  the environment (the keys seam reflects file-saved keys into env), and
 *  a provider with no key simply fails its stream with "not configured" —
 *  honest, late, and unreachable through the picker, which gates on
 *  keyPresent. */
export function piModels() {
	if (!collection) {
		collection = createModels({ identity: APP_IDENTITY });
		for (const provider of builtinProviders()) collection.setProvider(provider);
	}
	return collection;
}

/** OpenRouter API key (BYOK); tests never read this — they inject engines. */
export function openRouterApiKey(): string | undefined {
	if (multiUser()) return userKeyOption("openrouter").apiKey;
	return process.env.OPENROUTER_API_KEY || undefined;
}

/** MULTI-USER (fork addition, 2026-10-24): the calling user's key for
 *  this provider, read from their auth file on every request. Single-user
 *  returns nothing and pi-ai reads the env as before; multi-user the env
 *  holds no keys (keys.ts initAuthEnv), so a user without a key gets
 *  pi-ai's "not configured" error, never another user's key. */
function userKeyOption(provider: string): { apiKey?: string } {
	if (!multiUser()) return {};
	const envVar = AUTH_PROVIDER_KEYS.find((p) => p.id === provider)?.envVar;
	if (!envVar) return {};
	try {
		const value = (JSON.parse(fs.readFileSync(authFile(), "utf-8")) as Record<string, unknown>)[envVar];
		return typeof value === "string" && value.trim() ? { apiKey: value.trim() } : {};
	} catch {
		return {};
	}
}

/** A fully-resolved model pin — the shape every engine now comes from:
 *  the settings-resolution chain's output (role override → slot, or the
 *  chat's conversation chain). thinkingLevel is OPTIONAL: unset means
 *  the baked default resolves here (owner 2026-09-22) — the first entry
 *  of DEFAULT_THINKING_ORDER the model supports. */
export interface ResolvedModelSpec {
	provider: string;
	id: string;
	thinkingLevel?: ThinkingLevel;
}

/** The first entry of the baked default order the model supports (owner,
 *  2026-09-22). A non-reasoning model reports exactly ["off"], so the
 *  order walk lands there naturally. */
function defaultThinkingLevel(model: Model<Api>): ThinkingLevel {
	const supported = getSupportedThinkingLevels(model);
	for (const level of DEFAULT_THINKING_ORDER) {
		if (supported.includes(level)) return level;
	}
	return supported[0] ?? "off";
}

/** The production engine for a RESOLVED spec (model slots wave,
 *  2026-09-20): provider-aware catalog lookup + thinking clamp. The API
 *  key is resolved by pi-ai itself from the environment per request (the
 *  keys seam reflects file-saved keys into env), so the engine never
 *  hardcodes OpenRouter's. */
export function piEngineForSpec(spec: ResolvedModelSpec): PiEngine {
	const models: Models = piModels();
	const model = models.getModel(spec.provider, spec.id);
	if (!model) {
		throw new Error(`${spec.provider} catalog has no model ${spec.id}`);
	}
	// UNSET level → the baked default order (first entry the model
	// supports); SET level → pi's native nearest-clamp (model swaps keep
	// the user's intent and adapt honestly).
	const level = spec.thinkingLevel
		? clampThinkingLevel(model, spec.thinkingLevel)
		: defaultThinkingLevel(model);
	return {
		model,
		level,
		// bound streamSimple: the agent loop forwards state.thinkingLevel as
		// `reasoning` (undefined = off on pi-ai's scale); the clamp above keeps
		// the pin honest even when config or settings drift off the map.
		streamFn: (requestModel, context, options) =>
			models.streamSimple(requestModel, context, {
				...options,
				...userKeyOption(requestModel.provider),
				reasoning: level === "off" ? undefined : level,
			}),
	};
}

/** The LEGACY role entry point — BYOK made it an honest THROWER (owner,
 *  2026-09-22): no factory pins exist to fall back to, and this module
 *  cannot read settings (architecture law — the agent layer never
 *  imports the server layer). Production resolves the chain in
 *  chat-handler and ALWAYS injects engines; reaching this means a
 *  wiring bug, so it fails loudly instead of guessing a model. */
export function piEngineFor(role: ModelRole): PiEngine {
	throw new Error(
		`no configured model for role "${role}" — set your model slots (settings → models)`,
	);
}

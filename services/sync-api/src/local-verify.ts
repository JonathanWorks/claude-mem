/**
 * Self-hosted token verification (PWM fork). When LOCAL_TOKEN_SHA256 is set, the hub answers
 * its own token check instead of calling TOKEN_VERIFY_URL, so a hub run on your own machine
 * never sends a token to any outside service.
 *
 * LOCAL_TOKEN_SHA256 is JSON: `{"<sha256 hex of a device token>": "<user id>", ...}`. Only the
 * hashes sit in the environment. The response matches the verify contract `authenticate`
 * expects: 200 with `{ userId }` when the token belongs to the presented user, 401 otherwise.
 */

export type TokenTable = ReadonlyMap<string, string>;

export function parseTokenTable(raw: string): TokenTable {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("LOCAL_TOKEN_SHA256 is not valid JSON");
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("LOCAL_TOKEN_SHA256 must be a JSON object");
	}
	const table = new Map<string, string>();
	for (const [hash, user] of Object.entries(parsed)) {
		if (!/^[0-9a-f]{64}$/.test(hash) || typeof user !== "string" || user.trim() === "") {
			throw new Error("LOCAL_TOKEN_SHA256 entries must map 64-char lowercase sha256 hex to a non-empty user id");
		}
		table.set(hash, user.trim());
	}
	if (table.size === 0) {
		throw new Error("LOCAL_TOKEN_SHA256 has no entries");
	}
	return table;
}

const parsedTables = new Map<string, TokenTable>();

/** Parses once per distinct value; `authenticate` builds its dependencies on every call. */
export function tokenTableFor(raw: string): TokenTable {
	let table = parsedTables.get(raw);
	if (table === undefined) {
		table = parseTokenTable(raw);
		parsedTables.set(raw, table);
	}
	return table;
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function localVerify(request: Request, table: TokenTable): Promise<Response> {
	const auth = request.headers.get("Authorization") ?? "";
	const claimed = (request.headers.get("X-User-Id") ?? "").trim();
	const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
	if (token === "" || claimed === "") {
		return Response.json({ error: "missing token or user id" }, { status: 401 });
	}
	const owner = table.get(await sha256Hex(token));
	if (owner === undefined || owner !== claimed) {
		return Response.json({ error: "unknown token for this user" }, { status: 401 });
	}
	return Response.json({ userId: owner });
}

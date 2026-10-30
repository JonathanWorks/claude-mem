import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { __resetAuthVerdictMemoryForTests, authenticateRequest } from "../src/auth";
import { loadEnv, type SyncApiEnv } from "../src/env";
import { localVerify, parseTokenTable } from "../src/local-verify";

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const req = (headers: Record<string, string>) => new Request("http://hub.test/v1/sync/status", { headers });

describe("parseTokenTable", () => {
	it("maps sha256 hex to user id", async () => {
		const h = await sha256Hex("device-a");
		expect(parseTokenTable(JSON.stringify({ [h]: "jon" })).get(h)).toBe("jon");
	});
	it.each([
		["not json", "not valid JSON"],
		["[]", "must be a JSON object"],
		["{}", "no entries"],
		[JSON.stringify({ abc: "jon" }), "64-char"],
		[JSON.stringify({ ["a".repeat(64)]: " " }), "64-char"],
		[JSON.stringify({ ["A".repeat(64)]: "jon" }), "64-char"],
	])("rejects %p", (raw, message) => {
		expect(() => parseTokenTable(raw)).toThrow(message);
	});
});

describe("localVerify", () => {
	it("200 with the owner for a known token and matching user; 401 otherwise", async () => {
		const table = new Map([[await sha256Hex("device-a"), "jon"]]);
		const ok = await localVerify(req({ Authorization: "Bearer device-a", "X-User-Id": "jon" }), table);
		expect(ok.status).toBe(200);
		expect(await ok.json()).toEqual({ userId: "jon" });
		expect((await localVerify(req({ Authorization: "Bearer other", "X-User-Id": "jon" }), table)).status).toBe(401);
		expect((await localVerify(req({ Authorization: "Bearer device-a", "X-User-Id": "eve" }), table)).status).toBe(401);
		expect((await localVerify(req({ "X-User-Id": "jon" }), table)).status).toBe(401);
	});
});

describe("authenticateRequest with LOCAL_TOKEN_SHA256", () => {
	const realFetch = globalThis.fetch;
	let fetchCalls = 0;
	beforeEach(() => {
		__resetAuthVerdictMemoryForTests();
		fetchCalls = 0;
		globalThis.fetch = (async () => {
			fetchCalls += 1;
			throw new Error("network must not be used when LOCAL_TOKEN_SHA256 is set");
		}) as unknown as typeof fetch;
	});
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	async function localEnv(): Promise<SyncApiEnv> {
		return loadEnv({
			DATABASE_URL: "postgres://unused/db",
			LOCAL_TOKEN_SHA256: JSON.stringify({ [await sha256Hex("device-a")]: "jon" }),
		});
	}

	it("accepts a known device token without any network call", async () => {
		const result = await authenticateRequest(
			req({ Authorization: "Bearer device-a", "X-User-Id": "jon", "X-Device-Id": "d1" }),
			await localEnv(),
		);
		expect(result.ok).toBe(true);
		expect(fetchCalls).toBe(0);
	});

	it("rejects an unknown token with 401 without any network call", async () => {
		const result = await authenticateRequest(req({ Authorization: "Bearer nope", "X-User-Id": "jon" }), await localEnv());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.response.status).toBe(401);
		expect(fetchCalls).toBe(0);
	});

	it("fails closed (503) with no local table and no TOKEN_VERIFY_URL, without any network call", async () => {
		const env = loadEnv({ DATABASE_URL: "postgres://unused/db" });
		expect(env.TOKEN_VERIFY_URL).toBe("");
		const result = await authenticateRequest(req({ Authorization: "Bearer device-a", "X-User-Id": "jon" }), env);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.response.status).toBe(503);
		expect(fetchCalls).toBe(0);
	});

	it("still calls TOKEN_VERIFY_URL when LOCAL_TOKEN_SHA256 is unset (upstream behaviour)", async () => {
		const env = loadEnv({ DATABASE_URL: "postgres://unused/db", TOKEN_VERIFY_URL: "http://verify.test/v" });
		expect(env.LOCAL_TOKEN_SHA256).toBe("");
		const result = await authenticateRequest(req({ Authorization: "Bearer device-a", "X-User-Id": "jon" }), env);
		expect(result.ok).toBe(false);
		expect(fetchCalls).toBe(1);
	});
});

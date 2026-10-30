import { afterAll, describe, expect, it } from "bun:test";
import { loadEnv } from "../src/env";
import { startSyncApi, type SyncApiApp } from "../src/index";
import { DEFAULT_DATABASE_URL, observationOp } from "./helpers";

// PWM fork: a self-hosted hub has no hosted projector. In log-only mode a stored page counts
// as projected, so a push is acknowledged and other devices pull it from the op log.

const TOKEN = "a".repeat(64);
const started: SyncApiApp[] = [];

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function startLogOnlyHub(userId: string): Promise<SyncApiApp> {
	const env = loadEnv({
		DATABASE_URL: DEFAULT_DATABASE_URL,
		TOKEN_VERIFY_URL: "",
		LOCAL_TOKEN_SHA256: JSON.stringify({ [await sha256Hex(TOKEN)]: userId }),
		PROJECTION_MODE: "log-only",
		PORT: "0",
		HOST: "127.0.0.1",
	});
	const app = await startSyncApi(env);
	started.push(app);
	return app;
}

function headers(userId: string, deviceId: string): Record<string, string> {
	return { Authorization: `Bearer ${TOKEN}`, "X-User-Id": userId, "X-Device-Id": deviceId };
}

afterAll(async () => {
	for (const app of started) await app.stop();
});

describe("log-only projection (self-hosted hub)", () => {
	it("acks a push with no projector configured and serves it to another device", async () => {
		const userId = `user-${crypto.randomUUID()}`;
		const app = await startLogOnlyHub(userId);
		const op = await observationOp("1", "1", "dev-a");

		const push = await fetch(`${app.url}/v1/sync/ops`, {
			method: "POST",
			headers: { ...headers(userId, "dev-a"), "Content-Type": "application/json" },
			body: JSON.stringify({ protocol_version: 2, ops: [op] }),
		});
		expect(push.status).toBe(200);
		const body = await push.json() as { acked: Array<{ seq: string }>; head_seq: string; projected_seq: string };
		expect(body.acked.map((a) => a.seq)).toEqual(["1"]);
		expect(body.projected_seq).toBe("1");

		const changes = await fetch(`${app.url}/v1/sync/changes?since=0`, { headers: headers(userId, "dev-b") });
		expect(changes.status).toBe(200);
		const page = await changes.json() as { ops: Array<{ seq: string; body: string }> };
		expect(page.ops.map((o) => o.body)).toEqual([op.body]);
	});

	it("refuses an unknown projection mode at boot", () => {
		expect(() => loadEnv({ DATABASE_URL: DEFAULT_DATABASE_URL, PROJECTION_MODE: "off" })).toThrow(/PROJECTION_MODE/);
	});

	it("refuses a malformed token table at boot", () => {
		expect(() => loadEnv({ DATABASE_URL: DEFAULT_DATABASE_URL, LOCAL_TOKEN_SHA256: '{"ABC":"u"}' })).toThrow(/LOCAL_TOKEN_SHA256/);
	});
});

describe("log-only projection under concurrent pushes", () => {
	it("acks every concurrent push instead of answering projection_busy", async () => {
		const userId = `user-${crypto.randomUUID()}`;
		const app = await startLogOnlyHub(userId);
		const pushes = await Promise.all(Array.from({ length: 8 }, async (_, device) => {
			const ops = await Promise.all(Array.from({ length: 40 }, (_, i) => observationOp(String(i + 1), "1", `dev-${device}`)));
			return fetch(`${app.url}/v1/sync/ops`, {
				method: "POST",
				headers: { ...headers(userId, `dev-${device}`), "Content-Type": "application/json" },
				body: JSON.stringify({ protocol_version: 2, ops }),
			});
		}));
		const statuses = pushes.map((r) => r.status);
		expect(statuses).toEqual(Array(8).fill(200));
		const status = await (await fetch(`${app.url}/v1/sync/status`, { headers: headers(userId, "dev-0") })).json() as { head_seq: string; projected_seq: string };
		expect(status.head_seq).toBe("320");
		expect(status.projected_seq).toBe("320");
	});
});

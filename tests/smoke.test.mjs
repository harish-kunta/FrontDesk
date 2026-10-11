import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, test } from "node:test";

const port = 3417;
const origin = `http://127.0.0.1:${port}`;
let server;

before(async () => {
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AUTH_SECRET: "frontdesk-local-smoke-test-secret",
        AUTH_GOOGLE_ID: "",
        AUTH_GOOGLE_SECRET: "",
        DATABASE_URL: "postgres://frontdesk:frontdesk@127.0.0.1:5432/frontdesk",
      },
      stdio: "inherit",
    },
  );

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next.js exited before becoming ready (code ${server.exitCode}).`);
    }

    try {
      await fetch(origin);
      return;
    } catch {
      await delay(250);
    }
  }

  throw new Error("Next.js did not become ready within 45 seconds.");
});

after(() => {
  server?.kill("SIGTERM");
});

test("the public landing page renders", async () => {
  const response = await fetch(origin);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Your best support person/);
});

test("the sign-in page explains missing Google OAuth setup", async () => {
  const response = await fetch(`${origin}/signin`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Google sign-in needs setup/);
});

test("the dashboard redirects anonymous visitors to sign in", async () => {
  const response = await fetch(`${origin}/dashboard`, { redirect: "manual" });

  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location"), origin).pathname, "/signin");
});

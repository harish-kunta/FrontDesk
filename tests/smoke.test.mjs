import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const port = 3417;
let origin = `http://127.0.0.1:${port}`;
let server;

before(async () => {
  const existingOrigin = "http://127.0.0.1:3000";
  try {
    await fetch(existingOrigin);
    origin = existingOrigin;
    return;
  } catch {
    // Start an isolated dev server below when the app is not already running.
  }

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

test("the sign-in page renders OAuth setup or the configured provider button", async () => {
  const response = await fetch(`${origin}/signin`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Google sign-in needs setup|Continue with Google/);
});

test("the dashboard redirects anonymous visitors to sign in", async () => {
  const response = await fetch(`${origin}/dashboard`, { redirect: "manual" });

  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location"), origin).pathname, "/signin");
});

test("the chatbot list is protected by the workspace session", async () => {
  const response = await fetch(`${origin}/dashboard/chatbots`, { redirect: "manual" });

  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location"), origin).pathname, "/signin");
});

test("a guessed chatbot playground URL is protected by the workspace session", async () => {
  const response = await fetch(
    `${origin}/dashboard/chatbots/8d6a14e6-7b3b-4e80-a8da-aef426d54425/playground`,
    { redirect: "manual" },
  );

  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location"), origin).pathname, "/signin");
});

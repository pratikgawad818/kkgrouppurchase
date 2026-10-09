import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

// Exercises the exact inline script that is delivered before React hydrates.
const root = readFileSync("src/routes/__root.tsx", "utf8");
const match = root.match(/const STALE_CHUNK_RECOVERY = `([\s\S]*?)`;/);
assert.ok(match, "The route shell must keep the recovery code inline");
const script = match[1];

function environment({ storage = new Map(), disabledStorage = false, pathname = "/auth", now = 1_000_000 } = {}) {
  const listeners = new Map();
  const elements = [];
  let reloads = 0;
  const window = {
    location: { pathname, reload() { reloads += 1; } },
    sessionStorage: {
      getItem(key) {
        if (disabledStorage) throw new Error("Storage disabled");
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        if (disabledStorage) throw new Error("Storage disabled");
        storage.set(key, value);
      },
    },
    addEventListener(type, fn) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
  };
  function element(tag) {
    return {
      tag,
      children: [],
      style: {},
      textContent: "",
      attrs: {},
      events: {},
      setAttribute(key, value) { this.attrs[key] = value; },
      addEventListener(type, fn) { this.events[type] = fn; },
      appendChild(child) { this.children.push(child); },
      focus() { this.focused = true; },
    };
  }
  const document = {
    body: { appendChild(child) { elements.push(child); } },
    createElement: element,
    getElementById(id) { return elements.find(node => node.id === id) ?? null; },
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) ?? []), fn]); },
  };
  runInNewContext(script, { window, document, Date: { now: () => now } });
  return {
    storage, elements,
    get reloads() { return reloads; },
    emit(type, details = {}) {
      const event = { type, ...details };
      for (const fn of listeners.get(type) ?? []) fn(event);
      return event;
    },
  };
}

test("unrelated app errors do not trigger reload", () => {
  const e = environment();
  e.emit("error", { message: "Not allowed to change purchase order" });
  assert.equal(e.reloads, 0);
  assert.equal(e.elements.length, 0);
});

test("a missing stale chunk is automatically retried only once", () => {
  const storage = new Map();
  const first = environment({ storage });
  first.emit("error", { message: "Importing a module script failed." });
  assert.equal(first.reloads, 1);
  assert.equal(storage.size, 1);

  // Emulate a page reload preserving tab sessionStorage; missing file again.
  const again = environment({ storage });
  again.emit("error", { message: "Importing a module script failed." });
  assert.equal(again.reloads, 0, "must not enter a reload loop");
  assert.equal(again.elements.length, 1, "must show a recovery message");
  assert.equal(again.elements[0].id, "kk-chunk-recovery");
});

test("Vite preload error is handled; duplicate errors cannot double reload", () => {
  const e = environment();
  let prevented = false;
  e.emit("vite:preloadError", { preventDefault() { prevented = true; } });
  e.emit("error", { message: "Failed to fetch dynamically imported module" });
  assert.equal(prevented, true);
  assert.equal(e.reloads, 1);
});

test("storage blocked by browser privacy settings produces a notice, never a reload loop", () => {
  const e = environment({ disabledStorage: true });
  e.emit("unhandledrejection", { reason: new Error("Failed to fetch dynamically imported module") });
  assert.equal(e.reloads, 0);
  assert.equal(e.elements.length, 1);
  e.emit("error", { message: "ChunkLoadError" });
  assert.equal(e.elements.length, 1);
});

test("a different route may retry independently", () => {
  const storage = new Map();
  const auth = environment({ storage, pathname: "/auth" });
  const projects = environment({ storage, pathname: "/projects" });
  auth.emit("error", { message: "Importing a module script failed." });
  projects.emit("error", { message: "Importing a module script failed." });
  assert.equal(auth.reloads, 1);
  assert.equal(projects.reloads, 1);
  assert.equal(storage.size, 2);
});

test("retry window eventually expires without retaining a tab-wide error forever", () => {
  const storage = new Map();
  const first = environment({ storage, now: 1_000_000 });
  first.emit("error", { message: "Importing a module script failed." });
  const later = environment({ storage, now: 1_301_000 });
  later.emit("error", { message: "Importing a module script failed." });
  assert.equal(later.reloads, 1);
});

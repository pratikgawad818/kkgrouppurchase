import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shiftWheelScrollTarget } from "../../src/lib/horizontal-scroll.ts";

const state = { scrollLeft: 50, clientWidth: 900, scrollWidth: 2200 };
const wheel = (props = {}) => ({
  shiftKey: true, ctrlKey: false, metaKey: false, altKey: false,
  deltaX: 0, deltaY: 120, deltaMode: 0, ...props,
});

test("normal two-finger Mac trackpad deltaX stays completely native", () => {
  assert.equal(shiftWheelScrollTarget(state, wheel({ shiftKey: false, deltaX: 45, deltaY: 0 })), null);
  assert.equal(shiftWheelScrollTarget(state, wheel({ deltaX: 120, deltaY: 20 })), null);
  assert.equal(shiftWheelScrollTarget(state, wheel({ shiftKey: false, deltaY: 120 })), null);
});

test("Shift+wheel scrolls a wide register horizontally and respects both edges", () => {
  assert.equal(shiftWheelScrollTarget(state, wheel()), 170);
  assert.equal(shiftWheelScrollTarget(state, wheel({ deltaY: -1000 })), 0);
  assert.equal(shiftWheelScrollTarget({ ...state, scrollLeft: 1250 }, wheel({ deltaY: 300 })), 1300);
  assert.equal(shiftWheelScrollTarget({ ...state, scrollLeft: 1300 }, wheel({ deltaY: 300 })), null);
  assert.equal(shiftWheelScrollTarget({ ...state, scrollLeft: 0 }, wheel({ deltaY: -20 })), null);
});

test("not-scrollable tables and zoom/accessibility gestures are not captured", () => {
  assert.equal(shiftWheelScrollTarget({ scrollLeft: 0, scrollWidth: 900, clientWidth: 900 }, wheel()), null);
  assert.equal(shiftWheelScrollTarget(state, wheel({ ctrlKey: true })), null);
  assert.equal(shiftWheelScrollTarget(state, wheel({ metaKey: true })), null);
  assert.equal(shiftWheelScrollTarget(state, wheel({ altKey: true })), null);
  assert.equal(shiftWheelScrollTarget(state, wheel({ deltaY: Number.NaN })), null);
  assert.equal(shiftWheelScrollTarget(state, wheel({ deltaMode: 1, deltaY: 3 })), 110);
  assert.equal(shiftWheelScrollTarget(state, wheel({ deltaMode: 2, deltaY: 1 })), 950);
});

test("desktop tables provide native horizontal overflow and prevent browser swipe history", () => {
  const css = readFileSync("src/styles.css", "utf8");
  const hook = readFileSync("src/components/erp/doc-table.tsx", "utf8");
  assert.match(css, /@media \(min-width: 768px\)/);
  assert.match(css, /\.doc-table, \.overflow-x-auto:has\(> table\)/);
  assert.match(css, /overflow-x: auto;/);
  assert.match(css, /overscroll-behavior-x: contain;/);
  assert.match(css, /min-width: max-content;/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(hook, /Horizontally scrollable table/);
  assert.match(hook, /tabIndex = 0/);
  assert.match(hook, /shiftWheelScrollTarget\(container, event\)/);
  assert.match(hook, /container\.addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
  assert.match(hook, /window\.addEventListener\("resize", resize\)/);
  assert.match(hook, /container\.removeEventListener\("wheel", area\.onWheel\)/);
});

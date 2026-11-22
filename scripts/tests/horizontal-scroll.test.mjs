import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shiftWheelScrollTarget, tableWheelScrollTarget } from "../../src/lib/horizontal-scroll.ts";

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
  assert.match(hook, /tableWheelScrollTarget\(container, event\)/);
  assert.match(hook, /if \(target === null \|\| !event\.cancelable\) return/);
  assert.match(hook, /event\.preventDefault\(\)/);
  assert.match(hook, /container\.addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
  assert.match(hook, /window\.addEventListener\("resize", resize\)/);
  assert.match(hook, /container\.removeEventListener\("wheel", area\.onWheel\)/);
});

test("Mac two-finger wheel moves tables in both directions with natural deltaX sign", () => {
  const at = { scrollLeft: 530, clientWidth: 800, scrollWidth: 2200 };
  // Move the scroll position right, then return left using negative deltaX.
  const right = tableWheelScrollTarget(at, wheel({ shiftKey:false, deltaX:140, deltaY:8 }));
  assert.equal(right,670);
  assert.equal(tableWheelScrollTarget({ ...at, scrollLeft:right },wheel({
    shiftKey:false, deltaX:-125, deltaY:5
  })),545);
  assert.equal(tableWheelScrollTarget(at,wheel({ shiftKey:false,deltaX:-140,deltaY:3 })),390);
  assert.equal(tableWheelScrollTarget(at,wheel({ shiftKey:false,deltaX:90,deltaY:-20 })),620);
});

test("horizontal gestures are consumed at BOTH ends to avoid Opera/Chrome history swipe", () => {
  const max=1400;
  const start={scrollLeft:0, clientWidth:800, scrollWidth:2200};
  assert.equal(tableWheelScrollTarget(start,wheel({shiftKey:false,deltaX:-200,deltaY:0})),0);
  assert.equal(tableWheelScrollTarget({...start,scrollLeft:max},wheel({
    shiftKey:false,deltaX:200,deltaY:0
  })),max);
  // A null result only occurs when it truly should be left to the browser.
  assert.equal(tableWheelScrollTarget(start,wheel({shiftKey:false,deltaX:0,deltaY:80})),null);
  assert.equal(tableWheelScrollTarget({...start,scrollWidth:800},wheel({
    shiftKey:false,deltaX:-100,deltaY:0
  })),null);
});

test("horizontal gesture detection preserves vertical scroll, zoom and Mac modifier keys",()=>{
  assert.equal(tableWheelScrollTarget(state,wheel({
    shiftKey:false,deltaX:20,deltaY:200
  })),null);
  assert.equal(tableWheelScrollTarget(state,wheel({
    shiftKey:false,deltaX:-30,deltaY:5,metaKey:true
  })),null);
  assert.equal(tableWheelScrollTarget(state,wheel({
    shiftKey:false,deltaX:-30,deltaY:5,ctrlKey:true
  })),null);
  assert.equal(tableWheelScrollTarget(state,wheel({
    shiftKey:false,deltaX:-30,deltaY:5,altKey:true
  })),null);
  assert.equal(tableWheelScrollTarget(state,wheel({
    shiftKey:false,deltaX:40,deltaY:0,deltaMode:1
  })),850);
  assert.equal(tableWheelScrollTarget(state,wheel({
    shiftKey:false,deltaX:1,deltaY:0,deltaMode:2
  })),950);
  assert.equal(tableWheelScrollTarget(state,wheel({
    shiftKey:true,deltaX:0,deltaY:-90
  })),0);
});

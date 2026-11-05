// Blueprint with a big diagram. Herdr cuts off a render that runs about 50 ms
// (the pane then shows a red error bar), so: the layout is made between frames,
// what is off screen isn't built, a render that runs out of time or throws
// still ends with a frame, and the refresh button starts over.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { state, div } from "./herdr-stub.mjs";
import Blueprint from "../mods/blueprint/main.js";
import { parseFlowchart } from "../mods/blueprint/mermaid.js";
import { text, LANGS } from "../mods/blueprint/i18n.js";

const T = new Proxy({}, { get: () => "#808080" });
const PAL = { active: "#ffcc00", done: "#00cc66" };
const SIZE = { width: 900, height: 600 };
const flat = (e, out = []) => { if (e && typeof e === "object") { out.push(e); (e.kids ?? []).forEach((c) => flat(c, out)); } return out; };
const ids = (el) => flat(el).map((e) => String(e.props?.id ?? ""));
const boxes = (el) => ids(el).filter((id) => id.startsWith("bp-n-")).map((id) => id.split("-").pop());
const words = (el) => flat(el).flatMap((e) => (e.kids ?? []).filter((k) => typeof k === "string"));

// n boxes in rows of 8, each fed from the row before.
function big(n) {
  const lines = ["flowchart LR"];
  for (let i = 0; i < n; i++) lines.push(`  n${i}[Box ${i}]`);
  for (let i = 8; i < n; i++) lines.push(`  n${i - 8 + (i % 3)} --> n${i}`);
  return lines.join("\n");
}

// A Blueprint pane showing src. Its timers wait until run(): what is on screen
// in between is what a render shows.
function blueprint(src) {
  state.settings.zoom = 1;
  const bp = Object.create(Blueprint.prototype);
  Object.assign(bp, {
    graphs: [{ key: "big.mmd", rev: 1, src, g: parseFlowchart(src) }], tab: 0, measured: {}, vers: {}, whole: new Set(),
    cache: new Map(), views: {}, dirs: {}, prev: {}, failed: new Set(), paths: {}, lite: 0,
    size: null, selected: null, hovered: null, exporting: false, paneFocused: false, compose: null, editing: false,
    drag: null, mono: "mono", T: text("en"), lang: "en", loading: false, width: SIZE.width,
  });
  const timers = [], tasks = [];
  const cx = { notify() {}, timer: { after: (_ms, f) => timers.push(f) }, spawn: (f) => tasks.push(f(cx)) };
  bp.heal = () => {};
  bp.canvas(T, PAL, cx).handlers.on_size_change(SIZE, cx);
  const run = () => { while (timers.length) timers.shift()(cx); };
  const settle = async () => { while (tasks.length) await tasks.shift(); };
  return { bp, cx, run, settle, canvas: () => bp.canvas(T, PAL, cx) };
}

test("a big diagram is laid out between frames, not in a render", () => {
  const { bp, run, canvas } = blueprint(big(300));
  assert.equal(boxes(canvas()).length, 0);
  run();
  assert.ok(boxes(canvas()).length > 0);
});

test("a diagram in another tab is laid out once its text is measured", () => {
  const { bp, cx, run, canvas } = blueprint(big(20));
  const other = parseFlowchart("flowchart LR\n  x[One] --> y[Two]");
  bp.graphs.push({ key: "other.mmd", rev: 2, src: "", g: other });
  run();
  for (const id of other.nodes.keys()) bp.measured[`n:other.mmd@2:${id}`] = { w: 30, h: 16 };
  bp.redraw(cx);
  run();
  bp.setTab(1); // no timers run after this: it is drawn at once
  assert.deepEqual(boxes(canvas()).sort(), ["x", "y"]);
});

test("only what is on screen is built", () => {
  const { bp, run, canvas } = blueprint(big(300));
  run();
  canvas();
  bp.views["big.mmd"] = { z: 1, x: 0, y: 0 }; // 100%, the drawing's origin at the top left
  const built = new Set(boxes(canvas()));
  const { L } = bp.current();
  const inside = L.nodes.filter((n) => n.x - n.w / 2 >= 0 && n.x + n.w / 2 <= SIZE.width && n.y - n.h / 2 >= 0 && n.y + n.h / 2 <= SIZE.height);
  const away = L.nodes.filter((n) => n.x + n.w / 2 < -40 || n.x - n.w / 2 > SIZE.width + 40 || n.y + n.h / 2 < -40 || n.y - n.h / 2 > SIZE.height + 40);
  assert.ok(inside.length > 0 && away.length > 0, "the view shows part of the diagram");
  for (const n of inside) assert.ok(built.has(n.node.id), `${n.node.id} is on screen but not built`);
  for (const n of away) assert.ok(!built.has(n.node.id), `${n.node.id} is off screen but built`);
});

test("a render out of time draws boxes first and says so", () => {
  const { bp, run, canvas } = blueprint(big(300));
  run();
  const all = boxes(canvas()).length;
  bp.deadline = Date.now() - 1; // its budget is used up
  bp.paths = {}; // and nothing is built yet
  const some = boxes(canvas()).length;
  assert.ok(some > 0 && some < all, `${some} of ${all} boxes`);
  assert.ok(words(bp.footer(T, false)).includes(bp.T.partial));
});

test("a render that throws shows the frame and a refresh button", () => {
  const { bp, cx } = blueprint(big(10));
  bp.renderBody = () => { throw new Error("odd file"); };
  const el = bp.render(cx);
  assert.ok(ids(el).includes("bp-refresh"));
  assert.ok(words(el).includes("odd file"));
});

test("after a render Herdr cut off, the next ones get less time", () => {
  const { bp, cx } = blueprint(big(10));
  bp.renderBody = () => div();
  const budget = () => {
    const t0 = Date.now();
    bp.render(cx);
    return bp.deadline - t0;
  };
  const normal = budget();
  bp.inRender = true; // a render that never reached its end
  assert.ok(budget() < normal);
});

test("the refresh button reads the files again and keeps the view", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bp-refresh-"));
  try {
    const { bp, cx, run, settle, canvas } = blueprint("flowchart LR\n  a --> b");
    writeFileSync(join(dir, "big.mmd"), "");
    state.files = { [`${dir}/big.mmd`]: "flowchart LR\n  a --> b --> c" }; // changed on disk
    bp.project = { path: "/p", dir, known: true, meta: { path: "/p", pinned: [], seen: {}, files: {} } };
    run();
    canvas();
    bp.measured["n:big.mmd@1:a"] = { w: 40, h: 16 };
    bp.views["big.mmd"] = { z: 1.2, x: 10, y: 20 };
    bp.refresh(cx);
    await settle();
    assert.ok(bp.graph.nodes.has("c"), "the file is read again");
    assert.equal(Object.keys(bp.measured).length, 0, "sizes are measured again");
    assert.deepEqual(bp.views["big.mmd"], { z: 1.2, x: 10, y: 20 });
    run();
    assert.ok(boxes(canvas()).includes("c"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the refresh button has its tooltip in every language", () => {
  for (const lang of LANGS) {
    const bp = Object.create(Blueprint.prototype);
    Object.assign(bp, { T: text(lang), targetList: [], project: null, loading: false, inPanel: false, editing: false });
    const button = flat(bp.header(T, PAL, null, false)).find((e) => e.props?.id === "bp-refresh");
    assert.ok(button, lang);
    assert.ok(text(lang).refreshTip && button.props.tooltip === text(lang).refreshTip, lang);
  }
});

test("a diagram that arrives after the list went empty is still laid out", () => {
  const { bp, cx, run, canvas } = blueprint(big(300));
  bp.redraw(cx); // a layout on its way
  const job = bp.job;
  bp.setDiagrams([]); // the last file deleted meanwhile
  run();
  assert.notEqual(bp.job, job);
  bp.setDiagrams([{ file: "new.mmd", src: "flowchart LR\n  p --> q", mtime: Date.now(), pinned: false }]);
  bp.redraw(cx);
  run();
  assert.deepEqual(boxes(canvas()).sort(), ["p", "q"]);
});

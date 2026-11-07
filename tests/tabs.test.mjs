// Blueprint's diagram tabs: dragged onto another they take its place, × or a
// middle click closes one (hidden until the agent changes the file), and the
// panel and a pane on the same project agree on both.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { state } from "./herdr-stub.mjs";
import Blueprint from "../mods/blueprint/main.js";
import { readMeta, updateMeta } from "../mods/blueprint/store.js";
import { text, LANGS } from "../mods/blueprint/i18n.js";

const T = new Proxy({}, { get: () => "#808080" });
const flat = (e, out = []) => { if (e && typeof e === "object") { out.push(e); (e.kids ?? []).forEach((c) => flat(c, out)); } return out; };
const src = (name) => `flowchart LR\n  ${name}1[${name}] --> ${name}2`;

// A project folder with a.mmd, b.mmd and c.mmd (their text in state.files,
// where readTextFile reads it).
function folder() {
  const dir = mkdtempSync(join(tmpdir(), "bp-tabs-")).replace(/\\/g, "/");
  state.files = {};
  state.batches = [];
  for (const n of ["a", "b", "c"]) put(dir, n);
  return dir;
}
function put(dir, name, text = src(name)) {
  writeFileSync(join(dir, `${name}.mmd`), "");
  state.files[`${dir}/${name}.mmd`] = text;
}

// A Blueprint (the panel, say) with that project open and read.
async function open(dir, lang = "en") {
  const bp = Object.create(Blueprint.prototype);
  Object.assign(bp, {
    graphs: [], items: [], tab: 0, revs: 0, measured: {}, vers: {}, whole: new Set(), cache: new Map(), views: {}, dirs: {},
    prev: {}, failed: new Set(), paths: {}, lite: 0, size: null, selected: null, compose: null, width: 0, T: text(lang),
    project: { path: "/p", dir, known: true, meta: await readMeta(dir, "/p") },
  });
  bp.heal = () => {};
  const tasks = [], cx = { notify() {}, timer: { after() {} }, spawn: (f) => tasks.push(f(cx)) };
  const settle = async () => {
    while (tasks.length) await tasks.shift();
    await updateMeta(dir, "/p", () => {}); // after whatever was being written
  };
  await bp.reload(cx);
  await settle();
  const ui = () => flat(bp.tabs(T));
  const tab = (name) => ui().find((e) => e.props.id === `bp-tab-${bp.graphs.findIndex((d) => d.key === `${name}.mmd`)}`);
  const pointer = {
    press: (name) => tab(name).handlers["on_mouse_down:left"]({}, cx),
    release: (name) => tab(name).handlers["on_mouse_up:left"]({}, cx),
    middle: (name) => tab(name).handlers["on_mouse_down:middle"]({}, cx),
    close: () => ui().find((e) => e.props.id === "bp-close").handlers.on_click({}, cx),
  };
  return { bp, cx, settle, ui, pointer };
}

const names = (bp) => bp.graphs.map((d) => d.key.replace(".mmd", ""));
const shown = (bp) => bp.graphs[bp.tab]?.key.replace(".mmd", "");

test("a tab dropped on another takes its place, and keeps it", async () => {
  const dir = folder();
  try {
    const { bp, cx, settle, pointer } = await open(dir);
    pointer.press("a");
    pointer.release("c");
    assert.deepEqual(names(bp), ["b", "c", "a"]);
    pointer.press("a");
    pointer.release("b");
    assert.deepEqual(names(bp), ["a", "b", "c"], "moved left, it goes before");
    pointer.press("c");
    pointer.release("b");
    assert.deepEqual(names(bp), ["a", "c", "b"]);
    await settle();
    await bp.reload(cx);
    assert.deepEqual(names(bp), ["a", "c", "b"], "read again");
    assert.deepEqual(names((await open(dir)).bp), ["a", "c", "b"], "opened again");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pressing a tab and letting go on it shows it", async () => {
  const dir = folder();
  try {
    const { bp, pointer } = await open(dir);
    pointer.press("b");
    pointer.release("b");
    assert.equal(shown(bp), "b");
    assert.deepEqual(names(bp), ["a", "b", "c"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("letting go on a tab after a press elsewhere changes nothing", async () => {
  const dir = folder();
  try {
    const { bp, pointer } = await open(dir);
    const before = shown(bp);
    pointer.release("c"); // say, the end of dragging the drawing
    assert.equal(shown(bp), before);
    assert.deepEqual(names(bp), ["a", "b", "c"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a diagram seen for the first time goes to the right end", async () => {
  const dir = folder();
  try {
    const { bp, cx, settle } = await open(dir);
    put(dir, "0");
    await bp.reload(cx);
    await settle();
    assert.deepEqual(names(bp), ["a", "b", "c", "0"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("× closes the shown tab: the one to its right is shown, the file stays", async () => {
  const dir = folder();
  try {
    const { bp, cx, settle, pointer } = await open(dir);
    pointer.press("b");
    pointer.release("b");
    pointer.close();
    assert.deepEqual(names(bp), ["a", "c"]);
    assert.equal(shown(bp), "c");
    assert.ok(existsSync(join(dir, "b.mmd")));
    await settle();
    await bp.reload(cx);
    assert.deepEqual(names(bp), ["a", "c"], "read again");
    assert.deepEqual(names((await open(dir)).bp), ["a", "c"], "opened again");
    pointer.close(); // the last one: the one to its left
    assert.equal(shown(bp), "a");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a middle click closes a tab that isn't shown; the shown one stays", async () => {
  const dir = folder();
  try {
    const { bp, pointer } = await open(dir);
    pointer.press("c");
    pointer.release("c");
    pointer.middle("a");
    assert.deepEqual(names(bp), ["b", "c"]);
    assert.equal(shown(bp), "c");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a closed diagram the agent changes is back, and shown", async () => {
  const dir = folder();
  try {
    const { bp, cx, settle, pointer } = await open(dir);
    pointer.middle("b");
    await settle();
    put(dir, "b", "flowchart LR\n  b1[b] --> b2 --> b3");
    await bp.reload(cx);
    assert.deepEqual(names(bp), ["a", "b", "c"]);
    assert.equal(shown(bp), "b");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("closing a pinned tab unpins it", async () => {
  const dir = folder();
  try {
    const { bp, settle, pointer } = await open(dir);
    bp.togglePin({ spawn: (f) => f() });
    await settle();
    assert.ok((await readMeta(dir, "/p")).pinned.includes("a.mmd"));
    pointer.close();
    await settle();
    assert.deepEqual((await readMeta(dir, "/p")).pinned, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the panel and a pane on one project agree on moves and closes", async () => {
  const dir = folder();
  try {
    const panel = await open(dir), pane = await open(dir);
    panel.pointer.press("a");
    panel.pointer.release("c");
    panel.pointer.middle("b");
    await panel.settle();
    state.batches = [[`${dir}/project.json`]]; // the pane's folder watch
    pane.bp.watch(pane.cx, pane.bp.project);
    await pane.settle();
    assert.deepEqual(names(pane.bp), ["c", "a"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("× has its tooltip in every language", async () => {
  const dir = folder();
  try {
    for (const lang of LANGS) {
      const { ui } = await open(dir, lang);
      const close = ui().find((e) => e.props.id === "bp-close");
      assert.ok(text(lang).closeTip && close.props.tooltip === text(lang).closeTip, lang);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

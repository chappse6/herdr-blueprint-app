// Blueprint picking up what the agent saves: from the folder watch, from the
// timer that reads the files again should the watch miss a save, and from a
// watch started again after it ended.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { state } from "./herdr-stub.mjs";
import Blueprint from "../mods/blueprint/main.js";

const V1 = "flowchart LR\n  a --> b", V2 = "flowchart LR\n  a --> b --> c";

// A Blueprint showing a project whose folder holds a.mmd (its text in
// state.files, as readTextFile reads it), read once.
async function project() {
  const dir = mkdtempSync(join(tmpdir(), "bp-watch-")).replace(/\\/g, "/");
  writeFileSync(join(dir, "a.mmd"), "");
  state.files = { [`${dir}/a.mmd`]: V1 };
  state.batches = [];
  state.watched = [];
  const bp = Object.create(Blueprint.prototype);
  Object.assign(bp, {
    graphs: [], tab: 0, revs: 0, measured: {}, vers: {}, whole: new Set(), cache: new Map(), views: {}, dirs: {},
    prev: {}, failed: new Set(), paths: {}, lite: 0, size: null, selected: null, compose: null,
    project: { path: "/p", dir, known: true, meta: { path: "/p", pinned: [], seen: {}, files: {} } },
  });
  bp.heal = () => {};
  const tasks = [], cx = { notes: 0, notify() { cx.notes++; }, timer: { after() {} }, spawn: (f) => tasks.push(f(cx)) };
  const settle = async () => { while (tasks.length) await tasks.shift(); };
  await bp.reload(cx);
  cx.notes = 0;
  return { bp, cx, dir, settle, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a save Herdr reports as the whole folder is read", async () => {
  const { bp, cx, dir, settle, done } = await project();
  try {
    state.files[`${dir}/a.mmd`] = V2;
    state.batches = [[dir]]; // too much changed to list
    bp.watch(cx, bp.project);
    await settle();
    assert.ok(bp.graph.nodes.has("c"));
  } finally {
    done();
  }
});

test("a save the watch missed shows up on the next read", async () => {
  const { bp, cx, dir, settle, done } = await project();
  try {
    state.files[`${dir}/a.mmd`] = V2; // and the watch says nothing
    bp.poll(cx);
    await settle();
    assert.ok(bp.graph.nodes.has("c"));
  } finally {
    done();
  }
});

test("reading again with nothing new doesn't redraw", async () => {
  const { bp, cx, settle, done } = await project();
  try {
    const before = bp.graphs[0];
    bp.poll(cx);
    await settle();
    assert.equal(cx.notes, 0);
    assert.equal(bp.graphs[0].rev, before.rev);
  } finally {
    done();
  }
});

test("a watch that ended starts again", async () => {
  const { bp, cx, dir, settle, done } = await project();
  try {
    bp.watch(cx, bp.project); // no change to give: it ends, as on an error
    await settle();
    assert.equal(state.watched.length, 1);
    bp.poll(cx);
    await settle();
    assert.equal(state.watched.length, 2, "the timer starts it again");
    bp.refresh(cx);
    await settle();
    assert.equal(state.watched.length, 3, "so does the refresh button");
    assert.ok(state.watched.every((d) => d === dir));
  } finally {
    done();
  }
});

// The update button: GitHub is asked about a newer version at most once a day,
// the button shows only for a newer one, and a click hands the update to the
// tab's agent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state } from "./herdr-stub.mjs";
import { newer, checkUpdate, setUpdateCheck, installedVersion } from "../mods/blueprint/update.js";
import { text } from "../mods/blueprint/i18n.js";
import Blueprint from "../mods/blueprint/main.js";

const DAY = 86400000, T0 = 1_000_000_000_000;
const T = new Proxy({}, { get: () => "#808080" });
const flat = (e, out = []) => { if (e && typeof e === "object") { out.push(e); (e.kids ?? []).forEach((c) => flat(c, out)); } return out; };
let asked = 0;
const github = (version) => { asked = 0; globalThis.fetch = async () => (asked++, { ok: true, json: async () => ({ version }) }); };

function blueprint(version, latest, agents = []) {
  const bp = Object.create(Blueprint.prototype);
  Object.assign(bp, { version, latest, targetList: agents, project: null, loading: false, inPanel: false, editing: false, T: text("en"), lang: "en" });
  bp.redraw = () => {};
  return bp;
}
const updateButton = (bp) => flat(bp.header(T, { active: "#ffcc00", done: "#00cc66" }, null, false)).find((e) => e.props?.id === "bp-update");

test("versions compare as dotted numbers", () => {
  assert.equal(newer("0.10.0", "0.9.2"), true);
  assert.equal(newer("1.0.0", "0.99.99"), true);
  assert.equal(newer("0.3.0", "0.3.0"), false);
  assert.equal(newer("0.3", "0.3.1"), false);
  assert.equal(newer(null, "0.3.0"), false);
  assert.equal(newer("main", "0.3.0"), false);
});

test("the installed version comes from the mod's own mod.json", async () => {
  state.files = { "/tmp/mods/blueprint/mod.json": '{ "place": "none", "version": "0.3.0" }' };
  assert.equal(await installedVersion(), "0.3.0");
});

test("GitHub is asked at most once a day, and every Blueprint shares the answer", async () => {
  state.shared = {};
  github("0.4.0");
  assert.equal((await checkUpdate(T0)).latest, "0.4.0");
  assert.equal((await checkUpdate(T0 + 3600000)).latest, "0.4.0"); // another Blueprint, an hour later
  assert.equal(asked, 1);
  await checkUpdate(T0 + DAY + 1);
  assert.equal(asked, 2);
});

test("a failed request is asked again an hour later, and says why", async () => {
  state.shared = {};
  asked = 0;
  globalThis.fetch = async () => { asked++; throw new Error("offline"); };
  assert.equal((await checkUpdate(T0)).error, "offline");
  await checkUpdate(T0 + 30 * 60000);
  assert.equal(asked, 1);
  await checkUpdate(T0 + 3600000 + 1);
  assert.equal(asked, 2);
});

test("turned off, it never asks; turned on, it asks again", async () => {
  state.shared = {};
  github("0.4.0");
  setUpdateCheck(false);
  await checkUpdate(T0 + 10 * DAY);
  assert.equal(asked, 0);
  setUpdateCheck(true);
  assert.equal((await checkUpdate(T0 + 10 * DAY)).latest, "0.4.0");
  assert.equal(asked, 1);
});

test("the header shows the update button only for a newer version", () => {
  assert.ok(updateButton(blueprint("0.3.0", "0.4.0")), "0.4.0 over 0.3.0");
  assert.equal(updateButton(blueprint("0.3.0", "0.3.0")), undefined);
  assert.equal(updateButton(blueprint("0.3.0", null)), undefined);
  assert.equal(updateButton(blueprint(null, "0.4.0")), undefined);
});

test("a click asks the tab's agent to update, naming both versions", async () => {
  state.sent = [];
  state.notes = [];
  const bp = blueprint("0.3.0", "0.4.0", [{ address: "t3", name: "Claude Code" }]);
  let job;
  bp.askUpdate({ spawn: (fn) => (job = fn({})) });
  await job;
  assert.equal(state.sent.length, 1);
  const [verb, to, prompt] = state.sent[0];
  assert.equal(verb, "send");
  assert.equal(to, "t3");
  assert.match(prompt, /0\.4\.0/);
  assert.match(prompt, /installed: 0\.3\.0/);
  assert.match(prompt, /mods\/blueprint/);
});

test("with no agent in the tab, a click only says how", () => {
  state.sent = [];
  state.notes = [];
  blueprint("0.3.0", "0.4.0", []).askUpdate({ spawn: () => assert.fail("nothing to send") });
  assert.equal(state.sent.length, 0);
  assert.equal(state.notes.length, 1);
});

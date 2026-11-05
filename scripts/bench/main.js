// Blueprint with one big diagram, rendered once by `herdr-app check` in Herdr's
// own engine (see scripts/bench.sh). The layout job and a first drawing are
// timed in init, which may run longer than a render; the render then reports
// by throwing, or Herdr cuts it off ("interrupted").
//   cold:   nothing laid out yet, the first render of a new diagram
//   warm:   laid out and measured, seen whole (fit)
//   zoomed: the same at 100% on the drawing's top-left corner
import { theme } from "herdr";
import Blueprint from "./bp/main.js";
import { P } from "./params.js";

export default class Bench extends Blueprint {
  init(props, cx) {
    super.init(props, cx);
    this.ctxTab = null; // a pane serving no tab keeps its diagram through the render
    this.setDiagrams([{ file: "big.mmd", src: P.src, mtime: Date.now(), pinned: false }]);
    Object.assign(this, { rawSize: { width: 1200, height: 800 }, size: { width: 1200, height: 800 }, width: 1200, zoom: 1, mono: "Menlo", measuredFont: "Menlo" });
    const r = {};
    if (P.mode !== "cold") {
      const mk = this.mkey(this.tab), g = this.graph;
      for (const n of g.nodes.values()) this.measured[`n:${mk}:${n.id}`] = this.labelBox(mk, n);
      g.edges.forEach((e, k) => e.label && (this.measured[`e:${mk}:${k}`] = this.edgeLabelBox(mk, g, e)));
      // The layout job to its end (in the app a timer runs it a slice at a time).
      const now = { timer: { after: (_ms, f) => f(now) }, notify() {} };
      this.redraw = (c) => c.timer && this.prepare(c);
      let t0 = Date.now();
      this.prepare(now);
      r.layouts = Date.now() - t0;
      delete this.redraw;
      this.current();
      if (P.mode === "zoomed") this.views[this.vkey] = { z: 1, x: 0, y: 0 };
      const t = theme();
      t0 = Date.now();
      r.elements = this.drawing(t, { active: t.working, done: t.done }).length;
      r.firstDrawing = Date.now() - t0;
    }
    this.result = r;
  }

  render(cx) {
    const t0 = Date.now();
    super.render(cx);
    const ms = Date.now() - t0, drawn = this.current() ? "drawn" : "laying out";
    throw new Error(`RESULT ${P.mode} n=${P.n} render ${ms} ms, ${drawn}${this.cut ? ", cut short" : ""} ${JSON.stringify(this.result)}`);
  }
}

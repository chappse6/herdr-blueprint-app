// A big Blueprint-style flowchart: n boxes in rows of about sqrt(n), each fed
// from one or two in the row before; some cylinders, diamonds and stadiums, a
// third of the edges labelled, the first 40% done and the next 10% active.
// The same n gives the same diagram.
export function bigDiagram(n, seed = 7) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const shapes = [["[", "]"], ["[(", ")]"], ["{", "}"], ["([", "])"]];
  const lines = ["---", `title: Big ${n}`, "---", "flowchart LR"];
  const per = Math.max(3, Math.round(Math.sqrt(n)));
  for (let i = 0; i < n; i++) {
    const [a, b] = shapes[i % 7 === 0 ? 1 : i % 11 === 0 ? 2 : i % 13 === 0 ? 3 : 0];
    lines.push(`  n${i}${a}"Node ${i} handler<br/>src/mod${i % 17}/file${i}.ts"${b}`);
  }
  let e = 0;
  for (let i = per; i < n; i++) {
    const row = Math.floor(i / per);
    for (let j = 1 + Math.floor(rnd() * 2); j > 0; j--) {
      const from = Math.floor((row - 1) * per + rnd() * per);
      lines.push(`  n${from} -->${rnd() < 0.3 ? `|step ${e}|` : ""} n${i}`);
      e++;
    }
  }
  const ids = (from, to) => Array.from({ length: Math.max(0, Math.floor(to) - Math.floor(from)) }, (_, k) => `n${Math.floor(from) + k}`);
  if (n >= 3) lines.push(`  class ${ids(0, n * 0.4).join(",")} done`, `  class ${ids(n * 0.4, n * 0.5).join(",")} active`);
  return lines.join("\n");
}

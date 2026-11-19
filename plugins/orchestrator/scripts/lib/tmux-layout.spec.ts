import { expect, test } from "bun:test";
import { paneIO } from "./mux/io";

function* permutations(items: string[]): Generator<string[]> {
  if (!items.length) { yield []; return; }
  for (const head of items)
    for (const tail of permutations(items.filter(item => item !== head))) yield [head, ...tail];
}

for (const count of [2, 3, 4, 5]) {
  test(`[REQ-6] LAYOUT-PERM: manager stays left and child order survives all ${count}-pane permutations`, () => {
    const ids = Array.from({ length: count }, (_, index) => `%${index + 1}`);
    const main = ids[0]!;
    for (const initial of permutations(ids)) {
      const order = initial.slice();
      let focus = initial.at(-1)!;
      const active = focus;
      let cells: string[][] = [];
      const ok = (out = "") => ({ ok: true, out });
      const io = paneIO("tmux", { tmux: argv => {
        const flag = (name: string) => argv[argv.indexOf(name) + 1]!;
        switch (argv[0]) {
          case "display": return ok(argv.at(-1)!.replace(/#\{(pane_id|window_width|window_height)\}/g,
            (_, field) => ({ pane_id: main, window_width: "200", window_height: "55" })[field as "pane_id" | "window_width" | "window_height"]));
          case "list-panes":
            if (flag("-F").includes("pane_index"))
              return ok(order.map((pane, index) => [pane, index, Number(pane === focus), "", "", ""].join("\t")).join("\n"));
            return ok(order.map((pane, index) => [pane, ...(cells[index] ?? [])].join("\t")).join("\n"));
          case "swap-pane": {
            const a = order.indexOf(flag("-s")), b = order.indexOf(flag("-t"));
            [order[a], order[b]] = [order[b]!, order[a]!];
            return ok();
          }
          case "select-layout":
            cells = [...argv.at(-1)!.matchAll(/(\d+)x(\d+),(\d+),(\d+),\d+/g)]
              .map(([, w, h, x, y]) => [x!, y!, w!, h!]);
            return ok();
          case "select-pane": focus = flag("-t"); return ok();
          default: return { ok: false, out: "unexpected tmux command" };
        }
      } });
      const result = io.layout({ layout: "main-columns", main, members: ids });
      expect(result.status).toBe("applied");
      expect(order).toEqual([main, ...initial.filter(pane => pane !== main)]);
      expect(focus).toBe(active);
      expect(cells).toHaveLength(count);
      expect(Number(cells[0]![0])).toBe(0);
      for (const child of cells.slice(1)) expect(Number(child[0])).toBeGreaterThan(0);
      for (let i = 1; i + 1 < cells.length; i += 2) {
        expect(cells[i]![0]).toBe(cells[i + 1]![0]);
        expect(Number(cells[i]![1])).toBeLessThan(Number(cells[i + 1]![1]));
      }
    }
  });
}

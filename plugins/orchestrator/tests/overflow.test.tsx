import { expect } from "claude-code/testing";
import { test } from "./kit";
import { machine, seedFamily, start, captures } from "./fake-machine";
import { SURFACES, mountBand, mountPane, bandProps, paneProps, press, pressRow, button, textOf } from "./ui";

for (const surface of SURFACES) {
  test(`[REQ-1, REQ-6] TEST-1501 [R1.1, R1.6; §6 Mod wiring] ${surface} More pages every family session and hidden-row actions target that session`, async ($, on) => {
    const h = machine(on), records = seedFamily(h, 11);
    await start($, h, surface);
    const band = await mountBand($, surface, bandProps(140, 4));
    expect(await textOf(band)).not.toContain("child-11");
    const more = await button(band, "More");
    expect(more).toBeDefined();
    await h.clock.settle();
    h.effects.length = 0;
    await band.press({ key: more!.key! });
    expect(h.effects[0]).toBe("ui.open");
    const pane = await mountPane($, surface, paneProps(100, 6));
    const seen = new Set<string>();
    for (let page = 0; page < 20; page++) {
      const text = await textOf(pane);
      for (const r of records) if (text.includes(r.name!)) seen.add(r.name!);
      if (!(await button(pane, "Next"))) break;
      await press(pane, "Next");
    }
    expect([...seen].sort()).toEqual(records.map(r => r.name!).sort());
    expect(await button(pane, "Prev")).toBeDefined();
    await press(pane, "Prev");
    await press(pane, "Next");
    expect(await textOf(pane)).toContain("child-11");

    const target = records.find(r => r.name === "child-11")!;
    await pressRow(pane, "child-11", "Msg");
    expect(h.fills.at(-1)?.text).toBe("SendMessage to child-11: ");
    const before = h.commands.length;
    await pressRow(pane, "child-11", "Jump");
    expect(h.commands.slice(before)).toEqual([
      ["tmux", "display-message", "-p", "-t", "%701", "#{client_tty}\t#{session_name}"],
      ["tmux", "select-window", "-t", "%" + target.pid], ["tmux", "select-pane", "-t", "%" + target.pid],
    ]);
    h.openerExits = [0];
    await pressRow(pane, "child-11", "Open");
    expect(h.commands.at(-1)).toEqual(["open", target.ticket!.url!]);
    await pressRow(pane, "child-11", "Show");
    await h.clock.settle();
    expect(await textOf(pane)).toContain("child-11");
    expect(captures(h).at(-1)).toEqual(["tmux", "capture-pane", "-p", "-N", "-t", "%" + target.pid]);
    await press(pane, "List");
    expect(await button(pane, "Next")).toBeDefined();
  });
}

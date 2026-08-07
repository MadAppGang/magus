# Facade

**Intent:** provide a unified, simplified interface to a set of interfaces in a subsystem.

## The force

Using a subsystem correctly requires knowing too much: which objects to create, in what
order, with what cleanup.

```ts
// Every caller repeats this, and every caller can get it wrong.
const file    = await Bun.file(path).arrayBuffer();
const decoder = new VideoDecoder(codecFor(path));
const frames  = await decoder.decode(file);
const audio   = new AudioMixer().extract(frames);
const encoder = new VideoEncoder({ codec: "h264", bitrate: 4_000_000 });
const output  = await encoder.encode(frames, audio);
await Bun.write(dest, output);
decoder.dispose(); encoder.dispose();      // forget this and you leak
```

## Structure

One entry point that encapsulates the sequence and exposes the common case.

```ts
export async function convertVideo(src: string, dest: string, format = "h264"): Promise<void> {
  const decoder = new VideoDecoder(codecFor(src));
  const encoder = new VideoEncoder({ codec: format, bitrate: 4_000_000 });
  try {
    const frames = await decoder.decode(await Bun.file(src).arrayBuffer());
    const audio  = new AudioMixer().extract(frames);
    await Bun.write(dest, await encoder.encode(frames, audio));
  } finally {
    decoder.dispose();                     // cleanup guaranteed, once, here
    encoder.dispose();
  }
}
```

**The facade does not restrict access.** Callers with unusual needs may still use the
subsystem directly. That is deliberate: a facade covers the common path, and forbidding the
rest turns it into a bottleneck that grows a method per special case.

## Does TypeScript already do this

**A module is a facade.** A file exporting three functions over a messy subsystem, with the
internals unexported, is the pattern in its natural form. A `Facade` class with static
methods adds nothing:

```ts
// video/index.ts — the public surface. Internals stay unexported.
export { convertVideo, extractThumbnail } from "./operations";
```

This is also why the module entry point in `../styles/modular-monolith.md` is a facade by
another name: `modules/billing/index.ts` exposes the common operations and hides the rest.

## Trade-offs

| Gain | Cost |
|---|---|
| Callers learn one function instead of six classes | Risks becoming a God Object (`UNI-01`) if it accretes a method per caller |
| Setup and teardown happen correctly, in one place | An extra layer to trace through when debugging |
| The subsystem can be refactored behind a stable surface | Hides capability; callers may not discover what is available |

## When NOT to use this

- **The subsystem is already simple.** Wrapping one call in another function is a rename.
- **Every caller needs different parts of the subsystem.** The facade will grow one method
  per caller and become a directory listing.
- **You need to restrict access, not simplify it.** That is `proxy.md`.

## Relations

- **Adapter** (`adapter.md`) converts one interface into a specific other one; Facade invents
  a new simpler interface over many objects.
- **Mediator** (`mediator.md`) also centralizes: Mediator's colleagues know about it and it
  coordinates them; Facade's subsystem is unaware the facade exists.
- **Singleton** (`singleton.md`) is the usual and usually mistaken way facades get exposed;
  a module export is better.

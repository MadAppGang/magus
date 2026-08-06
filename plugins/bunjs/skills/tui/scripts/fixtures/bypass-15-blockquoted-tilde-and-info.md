# Bypass 15 — blockquoting the other two fence forms

Bypass 1 covers a blockquoted plain ```` ```tsx ````. The quoting and the fence spelling are
independent evasions, so they compose: a blockquoted tilde fence and a blockquoted fence carrying
an info string each hid a mixed snippet on their own.
EXPECT rule 4. EXPECT 2 violations. EXPECT 2 blocks.

> A quoted aside, fenced with tildes:
>
> ~~~tsx
> import * as core from "@opentui/core"
>
> export function Panel() {
>   return <box flexDirection="row">{core.Box({ gap: 1 })}</box>
> }
> ~~~

And nested, with an info string, which is both evasions plus the namespace call at once:

> > ```tsx title=aside.tsx
> > const B = Box
> > const row = B({ gap: 1 })
> > const jsx = <text>{String(row)}</text>
> > ```

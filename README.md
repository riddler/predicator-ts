# @riddler/predicator

A conformant TypeScript sibling of the Predicator expression language.

Predicator is a small, safe expression language a host embeds so that a
non-programmer can author a condition - a feature flag's audience, a signup
wizard's branch, a rule about whether a credit-card charge needs review - and
the host can decide it without running arbitrary code. An expression compiles
to a flat instruction list; an evaluator runs that list against a context and
answers a value.

The reference implementation is
[predicator-ex](https://github.com/riddler/predicator-ex), written in Elixir.
This package is the TypeScript sibling: same language, same instruction set,
same answers, so an expression authored once can be compiled on a server and
evaluated in a browser or in a React Native app without a round trip.

> **Pre-release.** The version is `0.0.0` and nothing is published yet. The
> surface below is what the package is being built toward; see the changelog
> for what actually ships.

## Install

```bash
pnpm add @riddler/predicator
```

The package has **no runtime dependencies** - there is no `dependencies` key in
its `package.json` at all - and assumes no host environment. It imports no Node
built-in and touches no DOM, so it runs unchanged on a server runtime, in a
browser, and on React Native's JavaScript engine.

## The two surfaces

```ts
import { isaVersion } from "@riddler/predicator";
import {} from "@riddler/predicator/tagged";
```

- **`@riddler/predicator`** is the main surface: compiling an expression,
  evaluating an instruction list, and the ISA version this build implements.
- **`@riddler/predicator/tagged`** is the tagged-value surface, for a host that
  needs to hand the evaluator a value whose type the runtime cannot infer from
  the JavaScript value alone - a date rather than a string, a duration rather
  than a number.

Both are shipped as ESM and CommonJS with type declarations.

### The ISA version

```ts
isaVersion(); // 6
```

The instruction set architecture is the contract between a compiler and every
evaluator that runs its output. A host holding a compiled instruction list can
ask an evaluator whether it is new enough to run it: a list that requires a
higher ISA version than the evaluator implements is refused rather than
mis-evaluated. The number here is re-derived from the reference
implementation's ISA document, not chosen independently.

## Conformance

"Conformant" is not a claim, it is a corpus. The Predicator family shares one
language-neutral conformance corpus - cases, their expected results, and the
schemas over them - vendored from the reference implementation at a named tag
and recorded with that tag and its commit. Every sibling runs the same cases,
and a registry records which case each implementation answers today. A
disagreement between this package and the corpus is this package's bug.

The corpus, the registry and the ratchet that keeps the answered count from
going backwards arrive in a later change; `pnpm run corpus:check` reports that
nothing is vendored yet until then.

## Documentation

The language reference - the grammar, the operators, the function set, the
value space and the refusals - lives with the reference implementation for now
and is mirrored here in a later change.

## Development

```bash
mise install                 # the pinned node and pnpm
pnpm install --frozen-lockfile
pnpm run gate:loop           # typecheck, lint, the suite
pnpm run gate                # the full gate, which CI runs too
```

`mise.toml` is the single source of truth for the toolchain, and CI reads the
versions out of it rather than duplicating them.

## License

MIT. See [LICENSE](LICENSE).

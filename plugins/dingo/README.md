# Dingo Language Plugin

AI agent skill for writing idiomatic [Dingo](https://github.com/MadAppGang/dingo) code — a meta-language for Go with Result/Option types, error propagation, enums, pattern matching, lambdas, and more.

## What is Dingo?

Dingo transpiles `.dingo` files to idiomatic `.go` files, providing modern language features while maintaining 100% Go ecosystem compatibility.

## Skill: dingo-developer

Single comprehensive skill covering all 12 Dingo features:

| Feature | Syntax | Section |
|---------|--------|---------|
| Error Propagation | `expr?`, `expr ? "msg"`, `expr ? \|e\| wrap(e)` | Error Handling |
| Result Type | `Result[T, E]`, `Ok()`, `Err()` | Result & Option |
| Option Type | `Option[T]`, `Some()`, `None()` | Result & Option |
| Enums / Sum Types | `enum Status { Active; Done { code: int } }` | Enums |
| Pattern Matching | `match expr { Variant => ... }` | Pattern Matching |
| Guard Let | `guard x := expr else \|err\| { ... }` | Error Handling |
| Lambdas | `\|x\| expr` or `(x) => expr` | Lambdas & Functional |
| Safe Navigation | `config?.Database?.Host` | Safe Navigation |
| Null Coalescing | `host ?? "localhost"` | Null Coalescing |
| Ternary | `cond ? a : b` | Expression Sugar |
| Tuples | `(x, y) := getPoint()` | Generics & Tuples |
| Generics | `func Map<T, R>(...)` | Generics & Tuples |

Also includes:
- **Code Review Rules** — 14 rules to detect Go-in-Dingo patterns (CRITICAL to LOW severity)
- **20 Anti-Patterns** — compiler-verified common mistakes
- **9 Feature Combinations** — named patterns for composing features
- **Go Boundary Guide** — when to stay Go-compatible
- **Migration Guide** — step-by-step Go to Dingo migration

## Compiler-Verified Accuracy

All patterns verified against the Dingo compiler:

- `guard` only works with Result/Option (NOT booleans)
- `?.` works for field access only (NOT method calls)
- `??` auto-dereferences pointer types
- Result API: `.IsOk()`, `.IsErr()`, `.MustOk()`, `.MustErr()`, `.OkOr()`
- Option API: `.IsSome()`, `.IsNone()`, `.MustSome()`, `.SomeOr()`, `.SomeOrElse()`

## Architecture

Designed using multi-model consensus from 5 AI models (Claude, GPT-5.4, MiniMax, GLM-5, Gemini).

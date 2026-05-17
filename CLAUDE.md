# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start Vite 
npm run build     # vite build
npm run lint      # Check Prettier formatting
npm run format    # Auto-fix formatting
npm start         # Preview dist/ with vite preview (after build)
```

## Code Style

- **Never** use `ÆON` in code; always use `AION`
- **Always** follow the _Art of Readable Code_
  - Code should be self explanatory and self documenting
  - Use abbreviations only for names that do not travel far
  - Reduce boilerplate comments; comment only the non-obvious aspects
  - Always add a unit suffix (`angleRad` vs `angle`)
  - Prefer elegance where possible
- Do not try to be clever / over-complicate; keep code simple and concise
- **Always** use advanced algorithms for performance benefits
  - When possible, add a comment that references a paper or implementation detail (example: "We use a De Bruijn sequence for perfect hashing")
- Use ES6 class syntax throughout
  - `#privateField` declarations at the top of the class body
  - `get prop()` getters for computed read-only properties
  - Private methods use `#methodName()` syntax
  - Prefer `#private` over `_underscore` conventions.
- Never use `_underscore` in any context.
- Prettier enforces: no semicolons, double quotes, 2-space indent, 120-char line width, ES6 trailing commas. 

## Project

ÆON (or Aion) is a purely functional audio engine written in JavaScript making use of the `AudioWorklet` API.

In Aion, synthesizers are of the form `f(t, ...) -> [left, right]` where each invocation of `f` generates a sample.

The Aion audio engine must call for each block of samples the root function `N` times to produce `N` samples.
In doing so, it must advance the time `t` properly.

Aion is special in the sense that a delay can be built like `f(t, ...) -> sin(t * 2 * PI) + f(t - delay, ...)` where
`f` needs to take care of recursion depth.

The audio engine should receive a parameter that is JavaScript code. The code will be compiled at runtime and
evaluated via `new Function`.

Aside from functions that produce samples, we also have functions that produce notes and envelopes. The function `n(t)`
returns `{pitch, velocity, triggerTime}` where `velocity` may be computed via `adsr(t)`. 

ALL sample, note or envelope functions in Aion are considered pure and idempotent.

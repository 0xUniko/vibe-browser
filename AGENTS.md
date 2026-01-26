# Section 1 — Bun-Only JavaScript / TypeScript Tooling (Node-Free Policy)

This repository uses **Bun as the only JavaScript / TypeScript runtime and package manager**.
Node.js and the entire npm ecosystem are **explicitly forbidden** in all commands, scripts, docs, CI, and agent outputs.

The agent MUST follow this section strictly.

---

## Rule 0 — Hard ban list (must not appear anywhere)

The following commands and tools are **not allowed** in this repository:

* `node`, `node.exe`
* `npm`, `npx`
* `pnpm`, `pnpx`
* `yarn`
* `corepack`
* `tsx`, `ts-node`, `ts-node-dev`
* `node ./node_modules/.bin/*`

If any of these appear in generated commands, scripts, documentation, CI steps, or troubleshooting, the output is **invalid** and must be rewritten using Bun.

---

### Rule 1 — Package management (Bun only)

All dependency management must use Bun.

Allowed:

* Install dependencies
  `bun install`

* Add dependency
  `bun add <pkg>`

* Add dev dependency
  `bun add -d <pkg>`

* Remove dependency
  `bun remove <pkg>`

* Update
  `bun update`

* Global install (only if strictly necessary)
  `bun add -g <pkg>`

Lockfiles:

* Use `bun.lockb` only.
* Do NOT introduce:

  * `package-lock.json`
  * `pnpm-lock.yaml`
  * `yarn.lock`

---

### Rule 2 — Running scripts (replace `npm run ...`)

All scripts must be executed with Bun.

Allowed:

* `bun run <script>`

Examples:

* ❌ `npm run dev`
  ✅ `bun run dev`

* ❌ `npm run build`
  ✅ `bun run build`

* ❌ `npm run lint`
  ✅ `bun run lint`

---

### Rule 3 — Direct TypeScript / JavaScript execution (no tsx / ts-node)

Bun can execute TypeScript directly.
Do NOT use `tsx`, `ts-node`, or `bunx tsx`.

Allowed:

* `bun run index.ts`
* `bun index.ts`

Watch mode:

* `bun --watch index.ts`
* or via scripts: `bun run --watch dev`

Replacements:

* ❌ `tsx index.ts`
  ✅ `bun run index.ts`

* ❌ `bunx tsx index.ts`
  ✅ `bun run index.ts`
  (or `bun index.ts`)

---

### Rule 4 — One-off CLI execution (replace npx)

Use `bunx` only when a CLI is not installed locally.

Prefer:

* Add as dev dependency and run via script
  `bun add -d <cli>`
  `bun run <cli> ...`

If one-off is unavoidable:

* Allowed:
  `bunx <cli> ...`

Forbidden:

* ❌ `npx <cli> ...`

---

### Rule 5 — Testing

Default test runner is Bun.

Allowed:

* `bun test`
* `bun run test`

Forbidden:

* Any `jest` / `vitest` / `mocha` invocation through `npm`, `npx`, or `node`

---

### Rule 6 — Build & tooling policy

General principles:

1. Prefer **Bun-native execution**:

   * `bun run ...`
   * `bun <file>`
   * `bunx ...`

2. Prefer scripts in `package.json` and always execute via:

   * `bun run <script>`

3. Never invoke:

   * `node ./node_modules/.bin/...`
   * `npx ...`

---

### Rule 7 — Agent output constraints (strict)

When generating:

* Commands
* README instructions
* CI steps
* Troubleshooting guides
* Dev environment setup

The agent MUST:

* Output only Bun-based commands.
* Rewrite any npm / node / npx instructions into Bun equivalents.
* Never suggest installing or using Node.js.

If Node is mentioned for context, it must be clearly labeled as **not allowed in this repository**, and the Bun alternative must be provided.

---

### Quick substitution table (mandatory for the agent)

| Forbidden           | Required replacement |
| ------------------- | -------------------- |
| `npm install`       | `bun install`        |
| `npm i <pkg>`       | `bun add <pkg>`      |
| `npm i -D <pkg>`    | `bun add -d <pkg>`   |
| `npm run <script>`  | `bun run <script>`   |
| `npx <cli>`         | `bunx <cli>`         |
| `tsx index.ts`      | `bun run index.ts`   |
| `bunx tsx index.ts` | `bun run index.ts`   |
| `jest` via npm      | `bun test`           |

---

# Section 2 — Extension & Skill Architecture Rules (Strict Functional Policy)

This section defines **mandatory architectural and coding rules** for all code under:

* `extension/`
* `skill/`

These rules are **hard constraints** and override any default behavior of the agent or tooling.

---

## Rule 2.1 — `extension/` must use effect-ts exclusively

All code under `extension/` MUST:

* Use **effect-ts** as the core abstraction layer
* Follow **pure functional programming style** strictly

Mandatory requirements:

1. All business logic MUST be expressed using:

   * `Effect`
   * `Layer`
   * `Context.Tag`
   * `Stream` (if streaming is required)

2. Forbidden in `extension/`:

* Class-based design
* Mutable shared state
* Singleton objects
* Implicit side effects
* Direct `Promise`-based orchestration for business logic

1. Side effects MUST:

* Be isolated in well-defined effect layers
* Be injectable via `Layer`
* Never be executed at module top-level

1. All functions MUST be:

* Referentially transparent (except inside effect boundaries)
* Explicit in required environment dependencies
* Free of hidden global state

---

## Rule 2.2 — Functional style is mandatory in `extension/`

Coding style requirements:

* Prefer composition over inheritance
* Prefer data + functions over classes
* No runtime service locators
* No dynamic mutation of module-level variables

Patterns that MUST be used:

* Dependency injection via `Context.Tag`
* Resource construction via `Layer`
* Control flow via `Effect.gen` or combinators

Patterns that are FORBIDDEN:

* `new Service(...)` inside business logic
* Factory patterns returning mutable instances
* Hidden initialization logic in constructors

---

## Rule 2.3 — `skill/` third‑party dependency policy

All code under `skill/` MUST follow a **runtime‑zero‑dependency policy** with a limited dev‑only exception.

### Runtime rules (strict)

All runtime code under `skill/` MUST:

* Use **Bun built‑in libraries only**
* Use standard Web / Bun APIs only

Strict prohibitions at runtime:

* No third‑party npm packages in production code
* No external SDKs
* No helper libraries

This includes (but is not limited to):

* HTTP clients (axios, got, ky, etc.)
* Utility libraries (lodash, ramda, fp-ts, etc.)
* Validation libraries
* Logging libraries

Allowed at runtime:

* Bun native APIs
* Standard Web APIs (`fetch`, `URL`, `Headers`, etc.)
* TypeScript standard library

---

### Dev‑only exception (allowed)

The following are allowed **only as dev dependencies** for `skill/`:

* Type checking tools
* Linters / formatters
* Test frameworks
* Build‑time tooling

Rules:

1. Dev‑only packages MUST be installed as:

   * `bun add -d <pkg>`

2. Dev‑only packages MUST NOT:

* Be imported in runtime code
* Appear in production bundles
* Be required by deployed artifacts

1. The agent MUST ensure:

* All runtime `skill/` code runs with **zero third‑party runtime dependencies**
* Dev tooling is stripped from any production output

---

## Rule 2.4 — Rationale and enforcement intent

The purpose of these rules is:

* Keep `extension/` as a **pure, testable, effect-controlled core**
* Keep `skill/` as a **minimal, dependency-free execution layer**
* Prevent:

  * Dependency explosion
  * Hidden side effects
  * Runtime-only architecture errors

The agent MUST:

* Reject designs that violate these constraints
* Refactor any generated code to comply
* Prefer explicit effects and minimal surfaces over convenience

---

## Rule 2.5 — Mandatory strict type checking and self-correction

After generating or modifying any code under:

* `extension/`
* `skill/`

The agent MUST perform **strict TypeScript type checking** and correct all issues before final output.

Mandatory requirements:

1. Type checking mode MUST be strict:

* `"strict": true` in `tsconfig.json`
* No implicit `any`
* No unchecked type assertions

1. The agent MUST:

* Run (or logically simulate) `tsc --noEmit` or equivalent
* Inspect all reported type errors and warnings
* Fix every type error before presenting the final result

1. Forbidden outcomes:

* Leaving known type errors unfixed
* Silencing errors with `as any`
* Adding `// @ts-ignore` or `// @ts-expect-error` without explicit architectural justification

1. All public APIs MUST:

* Have explicit input and return types
* Avoid structural ambiguity
* Avoid overly generic types (`any`, `unknown` without narrowing)

1. Effect / Layer typing requirements (for `extension/`):

* All `Effect` values MUST declare:

  * Environment type
  * Error type
  * Success type

* No implicit widening of environment or error channels

The agent MUST treat **type errors as correctness failures**, not cosmetic issues.

---

End of AGENTS.md

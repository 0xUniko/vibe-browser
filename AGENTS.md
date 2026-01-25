# Bun-Only JavaScript / TypeScript Tooling (Node-Free Policy)

This repository uses **Bun as the only JavaScript / TypeScript runtime and package manager**.  
Node.js and the entire npm ecosystem are **explicitly forbidden** in all commands, scripts, docs, CI, and agent outputs.

The agent MUST follow this section strictly.

---

## Rule 0 — Hard ban list (must not appear anywhere)

The following commands and tools are **not allowed** in this repository:

- `node`, `node.exe`
- `npm`, `npx`
- `pnpm`, `pnpx`
- `yarn`
- `corepack`
- `tsx`, `ts-node`, `ts-node-dev`
- `node ./node_modules/.bin/*`

If any of these appear in generated commands, scripts, documentation, CI steps, or troubleshooting, the output is **invalid** and must be rewritten using Bun.

---

### Rule 1 — Package management (Bun only)

All dependency management must use Bun.

Allowed:

- Install dependencies  
  `bun install`

- Add dependency  
  `bun add <pkg>`

- Add dev dependency  
  `bun add -d <pkg>`

- Remove dependency  
  `bun remove <pkg>`

- Update  
  `bun update`

- Global install (only if strictly necessary)  
  `bun add -g <pkg>`

Lockfiles:

- Use `bun.lockb` only.
- Do NOT introduce:
  - `package-lock.json`
  - `pnpm-lock.yaml`
  - `yarn.lock`

---

### Rule 2 — Running scripts (replace `npm run ...`)

All scripts must be executed with Bun.

Allowed:

- `bun run <script>`

Examples:

- ❌ `npm run dev`  
  ✅ `bun run dev`

- ❌ `npm run build`  
  ✅ `bun run build`

- ❌ `npm run lint`  
  ✅ `bun run lint`

---

### Rule 3 — Direct TypeScript / JavaScript execution (no tsx / ts-node)

Bun can execute TypeScript directly.  
Do NOT use `tsx`, `ts-node`, or `bunx tsx`.

Allowed:

- `bun run index.ts`
- `bun index.ts`

Watch mode:

- `bun --watch index.ts`
- or via scripts: `bun run --watch dev`

Replacements:

- ❌ `tsx index.ts`  
  ✅ `bun run index.ts`

- ❌ `bunx tsx index.ts`  
  ✅ `bun run index.ts`  
  (or `bun index.ts`)

---

### Rule 4 — One-off CLI execution (replace npx)

Use `bunx` only when a CLI is not installed locally.

Prefer:

- Add as dev dependency and run via script  
  `bun add -d <cli>`  
  `bun run <cli> ...`

If one-off is unavoidable:

- Allowed:  
  `bunx <cli> ...`

Forbidden:

- ❌ `npx <cli> ...`

Examples:

- ❌ `npx prisma migrate dev`  
  ✅ `bunx prisma migrate dev`  
  (or install prisma and use `bun run prisma ...`)

- ❌ `npx eslint .`  
  ✅ `bunx eslint .`  
  (or install eslint and use `bun run lint`)

---

### Rule 5 — Testing

Default test runner is Bun.

Allowed:

- `bun test`
- `bun run test`

Forbidden:

- Any `jest` / `vitest` / `mocha` invocation through `npm`, `npx`, or `node`

---

### Rule 6 — Build & tooling policy

General principles:

1. Prefer **Bun-native execution**:
   - `bun run ...`
   - `bun <file>`
   - `bunx ...`

2. Prefer scripts in `package.json` and always execute via:
   - `bun run <script>`

3. Never invoke:
   - `node ./node_modules/.bin/...`
   - `npx ...`

---

### Rule 7 — Agent output constraints (strict)

When generating:

- Commands
- README instructions
- CI steps
- Troubleshooting guides
- Dev environment setup

The agent MUST:

- Output only Bun-based commands.
- Rewrite any npm / node / npx instructions into Bun equivalents.
- Never suggest installing or using Node.js.

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

End of Bun-only policy.

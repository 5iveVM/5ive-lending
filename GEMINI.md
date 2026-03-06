# GEMINI.md - 5IVE VM Project Context

This file provides the instructional context for Gemini CLI when working on the `5ive-lending` project.

## Project Overview

**5ive-lending** is a project built using the **5IVE VM DSL**, a specialized language for developing high-performance smart contracts (likely for the Solana blockchain). The project uses the `5ive` CLI for compilation, testing, and deployment.

- **Primary Language:** 5IVE DSL (V-based syntax, `.v` files)
- **Runtime:** 5IVE VM
- **Build System:** `npm` (wrapper for `5ive` CLI)
- **Configuration:** `five.toml`

## Project Structure

- `src/`: 5IVE VM source files (`.v`).
- `tests/`: Test files (`.v` files with `pub test_*` functions).
- `build/`: Compiled bytecode and artifacts.
- `five.toml`: Project configuration including optimizations and deployment settings.
- `package.json`: Node.js manifest with build and test scripts.
- `AGENTS.md`: Mandatory operating contract for agents (this project follows strict rules).

## Building and Running

The project uses `npm` scripts to interface with the `5ive` CLI.

| Task | Command | Description |
| :--- | :--- | :--- |
| **Build** | `npm run build` | Compiles source files in `src/`. |
| **Build (Release)** | `npm run build:release` | Compiles with level 3 optimizations. |
| **Test** | `npm test` | Runs all tests discovered in the project. |
| **Watch** | `npm run watch` | Auto-compiles on file changes. |
| **Deploy** | `npm run deploy` | Deploys the project to the configured network (default: `devnet`). |

## Development Conventions

This project follows the **5IVE Agent Operating Contract** defined in `AGENTS.md`.

### Mandatory Workflow
1. Inspect `five.toml` for configuration.
2. Compile code to `.five` artifacts before testing/deploying.
3. Run tests/local runtime checks.
4. Deploy only with explicit target and program ID.
5. Verify execution results (ensure `meta.err == null`).

### Hard Authoring Rules
- **Syntax:** Every account field must end with a semicolon `;`.
- **Authentication:** Use `account @signer` for authentication parameters, not `pubkey @signer`.
- **Key Access:** Use `.key` on `account` values for comparisons or assignments.
- **Functions:** Explicitly declare return types using `-> ReturnType`.
- **Immutability:** Locals are immutable by default. Use `let mut` for reassignment.
- **Attribute Order:** Canonical order for initialized accounts: `Type @mut @init(payer=name, space=bytes) @signer`.
- **Time:** Use `get_clock() -> u64` for Unix timestamps (seconds).
- **Fixed-Point Math:** Maintain consistent scaling standards (e.g., Prices: `1e6`, Rates: `1e9`).

### Testing Practices
- Name test functions `pub test_<name>`.
- Use the `// @test-params <args...> <expected>` comment format for automatic parameter injection and validation.
- Preferred test path: `tests/main.test.v`.

## Additional Resources
- Refer to `../AGENTS_REFERENCE.md` for deep syntax inventory and recipes.
- Refer to `../AGENTS_CHECKLIST.md` for step-by-step gating.

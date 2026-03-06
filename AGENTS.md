# AGENTS.md - 5IVE Agent Operating Contract (Short)

This is the mandatory, high-signal contract for agents working in this repo.
Use this file first.
Use `/Users/ivmidable/Development/five-mono/AGENTS_REFERENCE.md` for deep syntax inventory, recipes, and long examples.

## 1) Mission

Build correct, production-ready 5IVE programs with deterministic compile/test/deploy behavior.
No placeholder logic in production paths.

## 1.1) Policy Overrides (2026-03)

These rules override any older examples:
1. Typed account metadata access uses `acct.ctx.*` (for example `acct.ctx.key`), not `acct.key`.
2. Account serializer keywords are `raw`, `borsh`, `bincode`.
3. Default account serializer is `raw`.
4. Serializer precedence is parameter override > account type default > interface/program default.
5. `anchor` is not a serializer keyword.

## 2) Source of Truth Order

When docs conflict, follow this order:
1. Compiler/CLI/SDK source code
2. Package manifests + command definitions
3. READMEs/examples/docs

## 3) Non-Negotiable Workflow

Always do this sequence:
1. Inspect `five.toml`.
2. Compile to `.five`.
3. Run tests/local runtime checks.
4. Deploy only with explicit target + program ID resolution.
5. Execute and verify confirmed tx metadata (`meta.err == null`).
6. Record signatures + compute units.

## 4) Hard Authoring Rules

1. Every account field ends with `;`.
2. Use `account @signer` for auth params (not `pubkey @signer`).
3. Use `.ctx.key` on account values for metadata pubkey access.
4. Functions returning values must declare `-> ReturnType`.
5. `0` and `pubkey(0)` are valid pubkey zero-init/revocation values.
6. `string<N>` is production-safe.
7. `require()` supports `==`, `!=`, `<`, `<=`, `>`, `>=`, `!`, `&&`, `||`.
8. Locals are immutable by default. Use `let mut` if reassigning.
9. Zero-stub mandate: no mock timestamps/rates/auth bypasses in production logic.

## 5) Attribute Stacking (Parser-Critical)

Canonical order for initialized account params:

`Type @mut @init(payer=name, space=bytes) @signer`

Examples:
1. `state: State @mut @init(payer=creator, space=128) @signer`
2. `authority: account @mut @signer`

## 6) Built-ins and Units (Do Not Guess)

Compiler-aligned signatures:
1. `get_clock() -> u64` (Unix timestamp, seconds)
2. `derive_pda(seed1, seed2, ...) -> (pubkey, u8)`
3. `derive_pda(seed1, seed2, ..., bump: u8) -> pubkey`

Practical conventions:
1. Prefer `param.ctx.key` for account key extraction.
2. Use `get_clock()` for all time-dependent flows.
3. Use fixed-point math consistently across contract math.

Default scaling standards:
1. Time: seconds
2. Prices/USD: `1e6`
3. Rates: `1e9` (or `1e12`, but keep one standard per contract)

## 7) CPI Rules (Critical)

1. Interface must use `@program("...")`.
2. Interface program ID in `@program("...")` must be a valid base58 public key string.
3. Use `@discriminator(N)` when required by the target interface ABI.
4. Do not treat `anchor` as a serializer; use `@serializer("raw" | "borsh" | "bincode")` when needed.
5. Interface account params use `Account` (not `pubkey`).
6. Call methods with dot notation: `Interface.method(...)`.
7. Pass account params directly (not `.key`) in CPI calls.
8. Any CPI-writable account must be `account @mut` in caller signature.
9. For internal authority (vault/PDA signer), pass authority as `account @signer`.

## 8) Testing and Discovery

Canonical expectations:
1. `5ive test` discovers `.v` tests and `.test.json` suites.
2. Prefer `pub test_*` function naming in `.v` tests.
3. Use `// @test-params <arg...> <expected>` where deterministic outputs are expected.
4. Common scaffold path: `tests/main.test.v`.

Useful commands:
1. `5ive test --filter "test_*" --verbose`
2. `5ive test --watch`
3. `5ive test --sdk-runner`

## 9) Program ID/Target Resolution

On-chain command precedence (`deploy`, `execute`, `namespace`):
1. `--program-id`
2. `five.toml [deploy].program_id`
3. `5ive config` for current target
4. `FIVE_PROGRAM_ID`

Never run on-chain commands with ambiguous target/program-id context.

## 10) Build Feedback Loop

Use build output to self-correct:
1. Watch `source chars -> bytecode bytes` per file.
2. Watch final artifact byte size in build summary.
3. Treat sudden bytecode growth as regression risk.
4. Before deploy, inspect `.five` bytecode length and ABI shape changes.

## 11) Definition of Done

Work is complete only when all applicable items are satisfied:
1. `.five` artifact produced.
2. Tests passed with evidence.
3. Deployment confirmed (if in scope).
4. Execution confirmed with `meta.err == null` (if in scope).
5. Signatures + CU metrics recorded.
6. Integration snippet delivered (SDK/frontend) when requested.

## 12) Execution Contract for Agents

1. Prefer deterministic, minimal command paths.
2. Verify outcomes; do not assume send success means execution success.
3. Avoid hidden defaults for deploy/CPI-critical settings.
4. Keep changes auditable and reproducible.
5. If uncertain, inspect compiler/CLI source before assuming behavior.

## 13) Where to Look Next

For full detail use:
1. `/Users/ivmidable/Development/five-mono/AGENTS_CHECKLIST.md` for step-by-step gating.
2. `/Users/ivmidable/Development/five-mono/AGENTS_REFERENCE.md` for deep language inventory and full reference implementations.

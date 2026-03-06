# AGENTS_CHECKLIST.md - 5IVE Delivery Gates

Use this checklist during execution. Do not skip gates.

## A) Pre-Authoring

1. Read `five.toml` and resolve:
   - target
   - program ID source
   - entry/output conventions
2. Confirm contract type/pattern (vault, escrow, lending, token, CPI-heavy).
3. Set explicit fixed-point/unit constants up front:
   - time = seconds
   - price scale
   - rate scale
4. Confirm whether any CPI paths are required.

## B) Authoring Gate

1. Account schemas:
   - every field ends with `;`
   - include `authority: pubkey;` where access control exists
   - include `status: u8;` for state machine flows
2. Init functions:
   - use `Type @mut @init(payer=..., space=...) @signer`
   - payer is `account @mut @signer`
   - initialize all fields
3. Auth and guards:
   - use `account @signer`
   - `require(state.authority == signer.key);`
   - include zero-amount and balance checks where applicable
4. Local variables:
   - `let` for immutable
   - `let mut` for reassignment
5. No stubs:
   - no hardcoded timestamps/rates/auth bypasses in production paths

## C) CPI Gate (If Applicable)

1. Interface declaration:
   - `@program("...")` is present
   - `@program("...")` value is a valid base58 public key
   - Anchor: `@anchor` and no manual `@discriminator`
   - Non-Anchor: each method has `@discriminator(N)` (single u8)
2. Types and call style:
   - interface accounts use `Account`
   - CPI call uses dot notation
   - pass account values directly, not `.key`
3. Mutability/signing:
   - CPI-writable accounts are `account @mut` in caller signature
   - PDA/internal authority passed as `account @signer`

## D) Compile Gate

1. Run:
```bash
5ive build
```
2. If compile fails, first check:
   - missing semicolons in account fields
   - wrong attribute order
   - immutable local reassignment
   - `pubkey @signer` misuse
3. Capture artifact details:
   - `.five` file path
   - bytecode bytes
   - ABI/function shape changes

## E) Test Gate

1. Run local/sdk tests first:
```bash
5ive test --sdk-runner
```
2. Run focused tests:
```bash
5ive test --filter "test_*" --verbose
```
3. If needed, run on-chain test mode with explicit target:
```bash
5ive test tests/ --on-chain --target devnet
```
4. Record pass/fail evidence.

## F) Deploy Gate (If In Scope)

1. Resolve target/program ID explicitly using precedence:
   - `--program-id`
   - `five.toml [deploy].program_id`
   - `5ive config`
   - `FIVE_PROGRAM_ID`
2. Dry-run/chunk strategy when artifact is large:
```bash
5ive deploy build/main.five --target devnet --dry-run --format json
```
3. Deploy with explicit target.
4. Save deployment signature.

## G) Execute Verification Gate (If In Scope)

1. Execute explicit function index/args.
2. Fetch confirmed transaction.
3. Verify `meta.err == null`.
4. Record:
   - signature
   - compute units consumed

## H) Definition of Done Gate

All applicable conditions must be true:
1. `.five` artifact produced.
2. Tests passed with evidence.
3. Deployment confirmed (if requested).
4. Execution confirmed (`meta.err == null`) (if requested).
5. Signatures + CU metrics recorded.
6. SDK/frontend integration snippet delivered if requested.

## I) Failure Triage Quick Map

1. `No program ID resolved for Five VM`:
   - set explicit program ID source.
2. `Function '<name>' not found in ABI`:
   - call exact ABI function name.
3. Missing account/arg:
   - fix `.accounts(...)` / `.args(...)` completeness.
4. CPI mismatch:
   - recheck serializer/discriminator/account order/type/mutability.
5. Parser failure:
   - check semicolons and attribute stack order first.

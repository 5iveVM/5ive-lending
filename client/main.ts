import assert from 'node:assert/strict';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import { FiveProgram, FiveSDK } from '@5ive-tech/sdk';

const NETWORK = process.env.FIVE_NETWORK || 'localnet';
const RPC_BY_NETWORK: Record<string, string> = {
  localnet: 'http://127.0.0.1:8899',
  devnet: 'https://api.devnet.solana.com',
  mainnet: 'https://api.mainnet-beta.solana.com',
};
const RPC_URL =
  process.env.FIVE_RPC_URL ||
  (RPC_BY_NETWORK[NETWORK] || RPC_BY_NETWORK.localnet);
const PROGRAM_BY_NETWORK: Record<string, string> = {
  localnet: '8h8gqgMhfq5qmPbs9nNHkXNoy2jb1JywxaRC6W68wGVm',
  devnet: '5ive58PJUPaTyAe7tvU1bvBi25o7oieLLTRsJDoQNJst',
  mainnet: '5ive58PJUPaTyAe7tvU1bvBi25o7oieLLTRsJDoQNJst',
};
const FIVE_VM_PROGRAM_ID =
  process.env.FIVE_VM_PROGRAM_ID ||
  process.env.FIVE_PROGRAM_ID ||
  (PROGRAM_BY_NETWORK[NETWORK] || PROGRAM_BY_NETWORK.localnet);
const VM_STATE_BY_NETWORK: Record<string, string> = {
  localnet: '3grckjTe9o2AcNq7GWRtJFsYBHdsTAZeSDCGcUkyftCm',
  devnet: '8ip3qGGETf8774jo6kXbsTTrMm5V9bLuGC4znmyZjT3z',
  mainnet: 'GMQFFG9iy63CyUTq1pbXrAK9AcWYLbtcx5vm6KUT7CDY',
};
const VM_STATE_ACCOUNT =
  process.env.FIVE_VM_STATE_ACCOUNT ||
  process.env.VM_STATE_PDA ||
  (VM_STATE_BY_NETWORK[NETWORK] || VM_STATE_BY_NETWORK.localnet);

type EncodedInstruction = {
  programId: string;
  keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  data: string;
};

type StepResult = {
  name: string;
  signature: string;
  cu: number | null;
};

const EXPECTED_PUBLIC_FUNCTIONS = [
  'init_market',
  'set_market_pause',
  'transfer_market_admin',
  'init_reserve',
  'set_reserve_config',
  'init_obligation',
  'init_oracle',
  'set_oracle',
  'refresh_reserve',
  'refresh_obligation',
  'refresh_obligation_with_oracle',
  'deposit_reserve_liquidity',
  'withdraw_reserve_liquidity',
  'borrow_obligation_liquidity',
  'repay_obligation_liquidity',
  'liquidate_obligation',
  'collect_protocol_fees',
  'get_utilization',
  'get_borrow_rate',
] as const;
const INVOKED_FUNCTIONS = new Set<string>();

function parseConsumedUnits(logs: string[] | null | undefined): number | null {
  if (!logs) return null;
  for (const line of logs) {
    const m = line.match(/consumed (\d+) of/);
    if (m) return Number(m[1]);
  }
  return null;
}

async function loadPayer(): Promise<Keypair> {
  const path = process.env.SOLANA_KEYPAIR_PATH || join(homedir(), '.config/solana/id.json');
  const secret = JSON.parse(await readFile(path, 'utf8')) as number[];
  return Keypair.fromSecretKey(new Uint8Array(secret));
}

function normalizeKeys(keys: EncodedInstruction['keys'], payer: PublicKey) {
  return keys.map((k) => {
    if (k.pubkey === payer.toBase58()) {
      return { ...k, isSigner: true, isWritable: true };
    }
    return k;
  });
}

function readU64LE(buf: Buffer, offset: number): bigint {
  return buf.readBigUInt64LE(offset);
}

function findPatternOffset(data: Buffer, chunks: Buffer[]): number {
  for (let off = 0; off + chunks.length * 32 <= data.length; off++) {
    let ok = true;
    for (let i = 0; i < chunks.length; i++) {
      if (!data.subarray(off + i * 32, off + (i + 1) * 32).equals(chunks[i])) {
        ok = false;
        break;
      }
    }
    if (ok) return off;
  }
  throw new Error('could not locate expected account field pattern');
}

async function fetchData(connection: Connection, pubkey: PublicKey): Promise<Buffer> {
  const info = await connection.getAccountInfo(pubkey, 'confirmed');
  assert(info, `account not found: ${pubkey.toBase58()}`);
  return Buffer.from(info.data);
}

async function fetchTokenAmount(connection: Connection, account: PublicKey): Promise<bigint> {
  const info = await getAccount(connection, account, 'confirmed');
  return info.amount;
}

function decodeMarket(
  data: Buffer,
  admin: PublicKey,
  quoteCurrency: PublicKey
): { offset: number; isPaused: boolean; abiVersion: number; protocolFeesCollected: bigint; admin: PublicKey } {
  const off = findPatternOffset(data, [Buffer.from(admin.toBytes()), Buffer.from(quoteCurrency.toBytes())]);
  return {
    offset: off,
    isPaused: data[off + 64] !== 0,
    abiVersion: data.readUInt16LE(off + 65),
    protocolFeesCollected: readU64LE(data, off + 67),
    admin: new PublicKey(data.subarray(off, off + 32)),
  };
}

function decodeReserve(
  data: Buffer,
  market: PublicKey,
  liquidityMint: PublicKey,
  liquiditySupply: PublicKey,
  collateralMint: PublicKey
): {
  offset: number;
  u64Slots: bigint[];
  configBytes: number[];
  supplyCap: bigint;
} {
  const off = findPatternOffset(data, [
    Buffer.from(market.toBytes()),
    Buffer.from(liquidityMint.toBytes()),
    Buffer.from(liquiditySupply.toBytes()),
    Buffer.from(collateralMint.toBytes()),
  ]);
  const base = off + 128;
  const u64Slots = Array.from({ length: 6 }, (_, i) => readU64LE(data, base + i * 8));
  const cfgBase = base + 6 * 8;
  const configBytes = Array.from({ length: 7 }, (_, i) => data[cfgBase + i]);
  const supplyCap = readU64LE(data, cfgBase + 7);
  return { offset: off, u64Slots, configBytes, supplyCap };
}

function decodeObligation(
  data: Buffer,
  market: PublicKey,
  authority: PublicKey
): { offset: number; depositedValue: bigint; borrowedValue: bigint; allowedBorrowValue: bigint } {
  const off = findPatternOffset(data, [Buffer.from(market.toBytes()), Buffer.from(authority.toBytes())]);
  const base = off + 64;
  return {
    offset: off,
    depositedValue: readU64LE(data, base),
    borrowedValue: readU64LE(data, base + 8),
    allowedBorrowValue: readU64LE(data, base + 16),
  };
}

function decodeOracle(
  data: Buffer,
  authority: PublicKey
): { offset: number; price: bigint; decimals: number; lastUpdate: bigint } {
  const off = data.indexOf(Buffer.from(authority.toBytes()));
  if (off < 0) {
    throw new Error('oracle authority pattern not found');
  }
  return {
    offset: off,
    price: readU64LE(data, off + 32),
    decimals: data[off + 40],
    lastUpdate: readU64LE(data, off + 41),
  };
}

async function sendIx(
  connection: Connection,
  payer: Keypair,
  encoded: EncodedInstruction,
  signers: Keypair[]
): Promise<{ signature: string; cu: number | null }> {
  const uniqueSigners = new Map<string, Keypair>([[payer.publicKey.toBase58(), payer]]);
  for (const s of signers) uniqueSigners.set(s.publicKey.toBase58(), s);

  const keys = normalizeKeys(encoded.keys, payer.publicKey).map((k) => ({
    pubkey: new PublicKey(k.pubkey),
    isSigner: k.pubkey === payer.publicKey.toBase58() || k.isSigner || uniqueSigners.has(k.pubkey),
    isWritable: k.isWritable,
  }));

  if (!keys.some((k) => k.pubkey.equals(SystemProgram.programId))) {
    keys.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
  }

  const requiredSignerPubkeys = new Set(
    keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())
  );
  const signingKeypairs = Array.from(uniqueSigners.values()).filter((kp) =>
    kp.publicKey.equals(payer.publicKey) || requiredSignerPubkeys.has(kp.publicKey.toBase58())
  );
  const maxAttempts = 3;
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: new PublicKey(encoded.programId),
        keys,
        data: Buffer.from(encoded.data, 'base64'),
      })
    );
    tx.feePayer = payer.publicKey;
    try {
      const signature = await sendAndConfirmTransaction(connection, tx, signingKeypairs, {
        commitment: 'confirmed',
      });
      const meta = await connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      return {
        signature,
        cu: meta?.meta?.computeUnitsConsumed ?? parseConsumedUnits(meta?.meta?.logMessages),
      };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable =
        msg.includes('TransactionExpiredBlockheightExceededError') ||
        msg.includes('block height exceeded') ||
        msg.includes('has expired');
      if (!retryable || attempt === maxAttempts) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? 'unknown sendIx error'));
}

async function call(
  program: FiveProgram,
  connection: Connection,
  payer: Keypair,
  name: string,
  accounts: Record<string, string>,
  args: Record<string, unknown>,
  signers: Keypair[],
  steps: StepResult[]
): Promise<void> {
  INVOKED_FUNCTIONS.add(name);
  const encoded = (await program
    .function(name)
    .payer(payer.publicKey.toBase58())
    .accounts(accounts)
    .args(args)
    .instruction()) as EncodedInstruction;
  const result = await sendIx(connection, payer, encoded, signers);
  steps.push({ name, signature: result.signature, cu: result.cu });
}

async function expectFailure(
  program: FiveProgram,
  connection: Connection,
  payer: Keypair,
  name: string,
  accounts: Record<string, string>,
  args: Record<string, unknown>,
  signers: Keypair[],
  expectedNeedles: string | string[]
): Promise<void> {
  INVOKED_FUNCTIONS.add(name);
  const encoded = (await program
    .function(name)
    .payer(payer.publicKey.toBase58())
    .accounts(accounts)
    .args(args)
    .instruction()) as EncodedInstruction;

  let failed = false;
  try {
    await sendIx(connection, payer, encoded, signers);
  } catch (e) {
    failed = true;
    const msg = e instanceof Error ? e.message : String(e);
    const needles = Array.isArray(expectedNeedles) ? expectedNeedles : [expectedNeedles];
    assert(
      needles.some((needle) => msg.includes(needle)),
      `expected failure "${needles.join('" | "')}" for ${name}, got: ${msg}`
    );
  }
  assert(failed, `${name} unexpectedly succeeded`);
}

async function deployWithRetry(
  loaded: Awaited<ReturnType<typeof FiveSDK.loadFiveFile>>,
  connection: Connection,
  payer: Keypair
): Promise<{ success: boolean; scriptAccount?: string; programId?: string; error?: string }> {
  const maxAttempts = 3;
  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const deploy =
      loaded.bytecode.length > 1200
        ? await FiveSDK.deployLargeProgramToSolana(loaded.bytecode, connection, payer, {
            fiveVMProgramId: FIVE_VM_PROGRAM_ID,
          })
        : await FiveSDK.deployToSolana(loaded.bytecode, connection, payer, {
            fiveVMProgramId: FIVE_VM_PROGRAM_ID,
          });
    if (deploy.success) return deploy as any;
    lastError = deploy.error || 'unknown error';
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  return { success: false, error: lastError };
}

async function main() {
  const artifact = await readFile(join(process.cwd(), '..', 'build', 'main.five'), 'utf8');
  const loaded = await FiveSDK.loadFiveFile(artifact);
  const abi = Array.isArray(loaded.abi) ? { functions: loaded.abi } : loaded.abi;
  const connection = new Connection(RPC_URL, 'confirmed');
  const payer = await loadPayer();
  const user = Keypair.generate();

  if (NETWORK === 'localnet') {
    const payerBal = await connection.getBalance(payer.publicKey, 'confirmed');
    if (payerBal < 2 * LAMPORTS_PER_SOL) {
      const sig = await connection.requestAirdrop(payer.publicKey, 3 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, 'confirmed');
    }
    const userAirdrop = await connection.requestAirdrop(user.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(userAirdrop, 'confirmed');
  }

  const userBalance = await connection.getBalance(user.publicKey, 'confirmed');
  const minUserLamports = 10_000_000; // 0.01 SOL covers account-init rent in this harness.
  if (userBalance < minUserLamports) {
    const topUpSig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: user.publicKey,
          lamports: minUserLamports - userBalance,
        })
      ),
      [payer],
      { commitment: 'confirmed' }
    );
    await connection.confirmTransaction(topUpSig, 'confirmed');
  }

  const deploy = await deployWithRetry(loaded, connection, payer);

  const deployResult = deploy as any;
  const scriptAccount = deployResult.scriptAccount || deployResult.programId;
  if (!deploy.success || !scriptAccount) {
    throw new Error(`Deployment failed: ${deploy.error || 'unknown error'}`);
  }

  const program = FiveProgram.fromABI(scriptAccount, abi, {
    fiveVMProgramId: FIVE_VM_PROGRAM_ID,
    vmStateAccount: VM_STATE_ACCOUNT,
  });

  const market = Keypair.generate();
  const reserve = Keypair.generate();
  const obligation = Keypair.generate();
  const oracle = Keypair.generate();

  const liquidityMint = await createMint(connection, payer, payer.publicKey, null, 6);
  const collateralMint = await createMint(connection, payer, payer.publicKey, null, 6);
  const userLiquidity = (
    await getOrCreateAssociatedTokenAccount(connection, payer, liquidityMint, user.publicKey)
  ).address;
  const userCollateral = (
    await getOrCreateAssociatedTokenAccount(connection, payer, collateralMint, user.publicKey)
  ).address;
  const feeRecipient = (
    await getOrCreateAssociatedTokenAccount(connection, payer, liquidityMint, payer.publicKey)
  ).address;
  const liquiditySupply = (
    await getOrCreateAssociatedTokenAccount(connection, payer, liquidityMint, payer.publicKey)
  ).address;
  await mintTo(connection, payer, liquidityMint, userLiquidity, payer, 1_000_000n);

  const steps: StepResult[] = [];

  await call(
    program,
    connection,
    payer,
    'init_market',
    {
      market: market.publicKey.toBase58(),
      quote_currency: SystemProgram.programId.toBase58(),
      admin: payer.publicKey.toBase58(),
    },
    {},
    [market],
    steps
  );

  let marketState = decodeMarket(
    await fetchData(connection, market.publicKey),
    payer.publicKey,
    SystemProgram.programId
  );
  assert.equal(marketState.admin.toBase58(), payer.publicKey.toBase58());
  assert.equal(marketState.isPaused, false);
  assert.equal(marketState.abiVersion, 2);
  assert.equal(marketState.protocolFeesCollected, 0n);

  await call(
    program,
    connection,
    payer,
    'set_market_pause',
    { market: market.publicKey.toBase58(), admin: payer.publicKey.toBase58() },
    { paused: true },
    [],
    steps
  );
  marketState = decodeMarket(
    await fetchData(connection, market.publicKey),
    payer.publicKey,
    SystemProgram.programId
  );
  assert.equal(marketState.isPaused, true);

  await call(
    program,
    connection,
    payer,
    'set_market_pause',
    { market: market.publicKey.toBase58(), admin: payer.publicKey.toBase58() },
    { paused: false },
    [],
    steps
  );
  marketState = decodeMarket(
    await fetchData(connection, market.publicKey),
    payer.publicKey,
    SystemProgram.programId
  );
  assert.equal(marketState.isPaused, false);

  await call(
    program,
    connection,
    payer,
    'transfer_market_admin',
    { market: market.publicKey.toBase58(), admin: payer.publicKey.toBase58() },
    { new_admin: user.publicKey.toBase58() },
    [],
    steps
  );
  marketState = decodeMarket(
    await fetchData(connection, market.publicKey),
    user.publicKey,
    SystemProgram.programId
  );
  assert.equal(marketState.admin.toBase58(), user.publicKey.toBase58());

  await expectFailure(
    program,
    connection,
    payer,
    'set_market_pause',
    { market: market.publicKey.toBase58(), admin: payer.publicKey.toBase58() },
    { paused: true },
    [],
    'custom program error: 0x232b'
  );

  await call(
    program,
    connection,
    payer,
    'transfer_market_admin',
    { market: market.publicKey.toBase58(), admin: user.publicKey.toBase58() },
    { new_admin: payer.publicKey.toBase58() },
    [user],
    steps
  );
  marketState = decodeMarket(
    await fetchData(connection, market.publicKey),
    payer.publicKey,
    SystemProgram.programId
  );
  assert.equal(marketState.admin.toBase58(), payer.publicKey.toBase58());
  assert.equal(marketState.isPaused, false);

  await call(
    program,
    connection,
    payer,
    'init_reserve',
    {
      market: market.publicKey.toBase58(),
      reserve: reserve.publicKey.toBase58(),
      liquidity_mint: liquidityMint.toBase58(),
      liquidity_supply: liquiditySupply.toBase58(),
      collateral_mint: collateralMint.toBase58(),
      admin: payer.publicKey.toBase58(),
    },
    {
      config_optimal_utilization: 80,
      config_loan_to_value: 75,
      config_reserve_factor: 10,
      config_supply_cap: 2_000_000,
    },
    [reserve],
    steps
  );

  let reserveState = decodeReserve(
    await fetchData(connection, reserve.publicKey),
    market.publicKey,
    liquidityMint,
    liquiditySupply,
    collateralMint
  );
  assert.deepEqual(reserveState.configBytes, [80, 75, 80, 5, 20, 2, 10]);
  assert.equal(reserveState.supplyCap, 2_000_000n);
  assert.equal(reserveState.u64Slots.filter((x) => x === 0n).length >= 4, true);
  assert.equal(reserveState.u64Slots.includes(1_000_000_000n), true);

  await call(
    program,
    connection,
    payer,
    'set_reserve_config',
    {
      reserve: reserve.publicKey.toBase58(),
      market: market.publicKey.toBase58(),
      admin: payer.publicKey.toBase58(),
    },
    { new_reserve_factor: 12, new_supply_cap: 9_000_000, new_loan_to_value: 70 },
    [],
    steps
  );
  reserveState = decodeReserve(
    await fetchData(connection, reserve.publicKey),
    market.publicKey,
    liquidityMint,
    liquiditySupply,
    collateralMint
  );
  assert.equal(reserveState.configBytes[1], 70);
  assert.equal(reserveState.configBytes[6], 12);
  assert.equal(reserveState.supplyCap, 9_000_000n);

  await call(
    program,
    connection,
    payer,
    'init_obligation',
    {
      market: market.publicKey.toBase58(),
      obligation: obligation.publicKey.toBase58(),
      borrower: user.publicKey.toBase58(),
    },
    {},
    [obligation, user],
    steps
  );
  let obligationState = decodeObligation(
    await fetchData(connection, obligation.publicKey),
    market.publicKey,
    user.publicKey
  );
  assert.equal(obligationState.depositedValue, 0n);
  assert.equal(obligationState.borrowedValue, 0n);
  assert.equal(obligationState.allowedBorrowValue, 0n);

  await call(
    program,
    connection,
    payer,
    'init_oracle',
    { oracle: oracle.publicKey.toBase58(), authority: payer.publicKey.toBase58() },
    { price: 2_000_000, decimals: 6 },
    [oracle],
    steps
  );
  let oracleState = decodeOracle(await fetchData(connection, oracle.publicKey), payer.publicKey);
  assert.equal(oracleState.price, 2_000_000n);
  assert.equal(oracleState.decimals, 6);
  assert.equal(oracleState.lastUpdate > 0n, true);

  await call(
    program,
    connection,
    payer,
    'set_oracle',
    { oracle: oracle.publicKey.toBase58(), authority: payer.publicKey.toBase58() },
    { price: 1_900_000, decimals: 6, last_update: 999_999 },
    [],
    steps
  );
  oracleState = decodeOracle(await fetchData(connection, oracle.publicKey), payer.publicKey);
  assert.equal(oracleState.price, 1_900_000n);
  assert.equal(oracleState.decimals, 6);
  assert.equal(oracleState.lastUpdate, 999_999n);

  await expectFailure(
    program,
    connection,
    payer,
    'refresh_obligation',
    {
      market: market.publicKey.toBase58(),
      obligation: obligation.publicKey.toBase58(),
      reserve: reserve.publicKey.toBase58(),
      liquidity_mint: liquidityMint.toBase58(),
      oracle_state: oracle.publicKey.toBase58(),
    },
    {},
    [],
    ['custom program error: 0x232b', 'invalid instruction data']
  );

  const beforeRefreshReserve = decodeReserve(
    await fetchData(connection, reserve.publicKey),
    market.publicKey,
    liquidityMint,
    liquiditySupply,
    collateralMint
  );
  await call(
    program,
    connection,
    payer,
    'refresh_reserve',
    { reserve: reserve.publicKey.toBase58() },
    {},
    [],
    steps
  );
  const afterRefreshReserve = decodeReserve(
    await fetchData(connection, reserve.publicKey),
    market.publicKey,
    liquidityMint,
    liquiditySupply,
    collateralMint
  );
  assert.equal(
    afterRefreshReserve.u64Slots.some((x) => !beforeRefreshReserve.u64Slots.includes(x)),
    true
  );

  await call(
    program,
    connection,
    payer,
    'refresh_obligation_with_oracle',
    {
      market: market.publicKey.toBase58(),
      obligation: obligation.publicKey.toBase58(),
      reserve: reserve.publicKey.toBase58(),
      borrower: user.publicKey.toBase58(),
    },
    { oracle_price: 1_700_000 },
    [user],
    steps
  );
  obligationState = decodeObligation(
    await fetchData(connection, obligation.publicKey),
    market.publicKey,
    user.publicKey
  );
  assert.equal(obligationState.depositedValue, 1_700_000n);
  assert.equal(obligationState.allowedBorrowValue, 1_190_000n);

  await call(
    program,
    connection,
    payer,
    'deposit_reserve_liquidity',
    {
      market: market.publicKey.toBase58(),
      reserve: reserve.publicKey.toBase58(),
      user_liquidity: userLiquidity.toBase58(),
      user_collateral: userCollateral.toBase58(),
      liquidity_supply: liquiditySupply.toBase58(),
      collateral_mint: collateralMint.toBase58(),
      market_authority: payer.publicKey.toBase58(),
      user_authority: user.publicKey.toBase58(),
      token_program: TOKEN_PROGRAM_ID.toBase58(),
    },
    { amount: 400_000 },
    [user],
    steps
  );
  reserveState = decodeReserve(
    await fetchData(connection, reserve.publicKey),
    market.publicKey,
    liquidityMint,
    liquiditySupply,
    collateralMint
  );
  assert.equal(reserveState.u64Slots[0], 400_000n);
  assert.equal(reserveState.u64Slots[1], 400_000n);
  assert.equal(await fetchTokenAmount(connection, userLiquidity), 600_000n);
  assert.equal(await fetchTokenAmount(connection, userCollateral), 400_000n);
  assert.equal(await fetchTokenAmount(connection, liquiditySupply), 400_000n);

  await call(
    program,
    connection,
    payer,
    'borrow_obligation_liquidity',
    {
      market: market.publicKey.toBase58(),
      reserve: reserve.publicKey.toBase58(),
      obligation: obligation.publicKey.toBase58(),
      user_liquidity: userLiquidity.toBase58(),
      liquidity_supply: liquiditySupply.toBase58(),
      market_authority: payer.publicKey.toBase58(),
      user_authority: user.publicKey.toBase58(),
      token_program: TOKEN_PROGRAM_ID.toBase58(),
    },
    { amount: 100_000 },
    [user],
    steps
  );
  reserveState = decodeReserve(
    await fetchData(connection, reserve.publicKey),
    market.publicKey,
    liquidityMint,
    liquiditySupply,
    collateralMint
  );
  obligationState = decodeObligation(
    await fetchData(connection, obligation.publicKey),
    market.publicKey,
    user.publicKey
  );
  assert.equal(reserveState.u64Slots[1], 300_000n);
  assert.equal(reserveState.u64Slots[2], 100_000n);
  assert.equal(obligationState.borrowedValue, 100_000n);
  assert.equal(await fetchTokenAmount(connection, userLiquidity), 700_000n);
  assert.equal(await fetchTokenAmount(connection, liquiditySupply), 300_000n);

  await call(
    program,
    connection,
    payer,
    'repay_obligation_liquidity',
    {
      market: market.publicKey.toBase58(),
      reserve: reserve.publicKey.toBase58(),
      obligation: obligation.publicKey.toBase58(),
      user_liquidity: userLiquidity.toBase58(),
      liquidity_supply: liquiditySupply.toBase58(),
      user_authority: user.publicKey.toBase58(),
      token_program: TOKEN_PROGRAM_ID.toBase58(),
    },
    { amount: 40_000 },
    [user],
    steps
  );
  reserveState = decodeReserve(
    await fetchData(connection, reserve.publicKey),
    market.publicKey,
    liquidityMint,
    liquiditySupply,
    collateralMint
  );
  obligationState = decodeObligation(
    await fetchData(connection, obligation.publicKey),
    market.publicKey,
    user.publicKey
  );
  assert.equal(reserveState.u64Slots[1], 340_000n);
  assert.equal(reserveState.u64Slots[2], 60_000n);
  assert.equal(obligationState.borrowedValue, 60_000n);
  assert.equal(await fetchTokenAmount(connection, userLiquidity), 660_000n);
  assert.equal(await fetchTokenAmount(connection, liquiditySupply), 340_000n);

  await call(
    program,
    connection,
    payer,
    'withdraw_reserve_liquidity',
    {
      market: market.publicKey.toBase58(),
      reserve: reserve.publicKey.toBase58(),
      obligation: obligation.publicKey.toBase58(),
      user_liquidity: userLiquidity.toBase58(),
      user_collateral: userCollateral.toBase58(),
      liquidity_supply: liquiditySupply.toBase58(),
      collateral_mint: collateralMint.toBase58(),
      market_authority: payer.publicKey.toBase58(),
      user_authority: user.publicKey.toBase58(),
      token_program: TOKEN_PROGRAM_ID.toBase58(),
    },
    { collateral_amount: 100_000 },
    [user],
    steps
  );
  reserveState = decodeReserve(
    await fetchData(connection, reserve.publicKey),
    market.publicKey,
    liquidityMint,
    liquiditySupply,
    collateralMint
  );
  assert.equal(reserveState.u64Slots[0], 300_000n);
  assert.equal(reserveState.u64Slots[1], 240_000n);
  assert.equal(await fetchTokenAmount(connection, userLiquidity), 760_000n);
  assert.equal(await fetchTokenAmount(connection, userCollateral), 300_000n);
  assert.equal(await fetchTokenAmount(connection, liquiditySupply), 240_000n);

  await call(
    program,
    connection,
    payer,
    'get_utilization',
    {},
    { liquidity: 1_000_000, borrows: 250_000 },
    [],
    steps
  );

  await call(
    program,
    connection,
    payer,
    'get_borrow_rate',
    {},
    { min_rate: 2, max_rate: 20, optimal: 80, utilization: 40 },
    [],
    steps
  );

  await expectFailure(
    program,
    connection,
    payer,
    'deposit_reserve_liquidity',
    {
      market: market.publicKey.toBase58(),
      reserve: reserve.publicKey.toBase58(),
      user_liquidity: userLiquidity.toBase58(),
      user_collateral: userCollateral.toBase58(),
      liquidity_supply: liquiditySupply.toBase58(),
      collateral_mint: collateralMint.toBase58(),
      market_authority: payer.publicKey.toBase58(),
      user_authority: user.publicKey.toBase58(),
      token_program: TOKEN_PROGRAM_ID.toBase58(),
    },
    { amount: 0 },
    [user],
    ['custom program error: 0x232b', 'invalid instruction data']
  );

  await expectFailure(
    program,
    connection,
    payer,
    'borrow_obligation_liquidity',
    {
      market: market.publicKey.toBase58(),
      reserve: reserve.publicKey.toBase58(),
      obligation: obligation.publicKey.toBase58(),
      user_liquidity: userLiquidity.toBase58(),
      liquidity_supply: liquiditySupply.toBase58(),
      market_authority: payer.publicKey.toBase58(),
      user_authority: user.publicKey.toBase58(),
      token_program: TOKEN_PROGRAM_ID.toBase58(),
    },
    { amount: 0 },
    [user],
    ['custom program error: 0x232b', 'invalid instruction data']
  );

  await expectFailure(
    program,
    connection,
    payer,
    'borrow_obligation_liquidity',
    {
      market: market.publicKey.toBase58(),
      reserve: reserve.publicKey.toBase58(),
      obligation: obligation.publicKey.toBase58(),
      user_liquidity: userLiquidity.toBase58(),
      liquidity_supply: liquiditySupply.toBase58(),
      market_authority: payer.publicKey.toBase58(),
      user_authority: user.publicKey.toBase58(),
      token_program: TOKEN_PROGRAM_ID.toBase58(),
    },
    { amount: 2_000_000 },
    [user],
    ['custom program error: 0x232b', 'invalid instruction data']
  );

  await expectFailure(
    program,
    connection,
    payer,
    'repay_obligation_liquidity',
    {
      market: market.publicKey.toBase58(),
      reserve: reserve.publicKey.toBase58(),
      obligation: obligation.publicKey.toBase58(),
      user_liquidity: userLiquidity.toBase58(),
      liquidity_supply: liquiditySupply.toBase58(),
      user_authority: user.publicKey.toBase58(),
      token_program: TOKEN_PROGRAM_ID.toBase58(),
    },
    { amount: 0 },
    [user],
    ['custom program error: 0x232b', 'invalid instruction data']
  );

  await expectFailure(
    program,
    connection,
    payer,
    'withdraw_reserve_liquidity',
    {
      market: market.publicKey.toBase58(),
      reserve: reserve.publicKey.toBase58(),
      obligation: obligation.publicKey.toBase58(),
      user_liquidity: userLiquidity.toBase58(),
      user_collateral: userCollateral.toBase58(),
      liquidity_supply: liquiditySupply.toBase58(),
      collateral_mint: collateralMint.toBase58(),
      market_authority: payer.publicKey.toBase58(),
      user_authority: user.publicKey.toBase58(),
      token_program: TOKEN_PROGRAM_ID.toBase58(),
    },
    { collateral_amount: 0 },
    [user],
    ['custom program error: 0x232b', 'invalid instruction data']
  );

  await expectFailure(
    program,
    connection,
    payer,
    'liquidate_obligation',
    {
      market: market.publicKey.toBase58(),
      reserve: reserve.publicKey.toBase58(),
      obligation: obligation.publicKey.toBase58(),
      liquidator_liquidity: userLiquidity.toBase58(),
      liquidity_supply: liquiditySupply.toBase58(),
      user_collateral: userCollateral.toBase58(),
      collateral_mint: collateralMint.toBase58(),
      market_authority: payer.publicKey.toBase58(),
      liquidator: user.publicKey.toBase58(),
      token_program: TOKEN_PROGRAM_ID.toBase58(),
      oracle_state: oracle.publicKey.toBase58(),
    },
    { repay_amount: 0 },
    [user],
    ['custom program error: 0x232b', 'invalid instruction data']
  );

  await expectFailure(
    program,
    connection,
    payer,
    'collect_protocol_fees',
    {
      reserve: reserve.publicKey.toBase58(),
      market: market.publicKey.toBase58(),
      admin: payer.publicKey.toBase58(),
      fee_recipient: feeRecipient.toBase58(),
      liquidity_supply: liquiditySupply.toBase58(),
      market_authority: payer.publicKey.toBase58(),
      token_program: TOKEN_PROGRAM_ID.toBase58(),
    },
    {},
    [],
    ['custom program error: 0x232b', 'invalid instruction data']
  );

  console.log('\nLENDING2_LOCALNET_INTEGRATION_RESULTS');
  console.log(`  rpc=${RPC_URL}`);
  console.log(`  script_account=${scriptAccount}`);
  let totalCu = 0;
  for (const step of steps) {
    totalCu += step.cu || 0;
    console.log(`  ${step.name}: sig=${step.signature} cu=${step.cu ?? 'n/a'}`);
  }
  for (const fn of EXPECTED_PUBLIC_FUNCTIONS) {
    assert(
      INVOKED_FUNCTIONS.has(fn),
      `typescript localnet coverage missing public function: ${fn}`
    );
  }
  console.log(`  public_functions_covered=${INVOKED_FUNCTIONS.size}/${EXPECTED_PUBLIC_FUNCTIONS.length}`);
  console.log(`  total_cu=${totalCu}`);
  console.log('  assertions=passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

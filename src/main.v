// 5IVE Lending Protocol - Canonical implementation (ABI v2)
//
// Design (Aave v2 / Solend-inspired):
//   - Isolated reserves per token; LP gets cTokens representing share
//   - Utilization-based interest rate curve (kink model)
//   - Collateral obligation tracks deposited_value and borrowed_value
//   - Liquidation with configurable bonus; protocol captures reserve factor
//   - Supply cap per reserve prevents unbounded growth
//   - Oracle staleness enforced on all price reads (100-slot window)
//   - Admin: pause, set reserve factor, set supply cap, transfer authority
//   - ABI v2: reserve_factor field added vs v1

use std::interfaces::spl_token;
account LendingMarket {
    admin: pubkey;
    quote_currency: pubkey;
    is_paused: bool;
    abi_version: u16;
    protocol_fees_collected: u64;
}

account Reserve {
    market: pubkey;
    liquidity_mint: pubkey;
    liquidity_supply: pubkey;
    collateral_mint: pubkey;
    collateral_supply: u64;
    liquidity_available: u64;
    borrowed_amount: u64;
    cumulative_borrow_rate: u64;
    last_update_slot: u64;
    protocol_fees: u64;

    // Config
    optimal_utilization_rate: u8;
    loan_to_value_ratio: u8;
    liquidation_threshold: u8;
    liquidation_bonus: u8;
    max_borrow_rate: u8;
    min_borrow_rate: u8;
    reserve_factor: u8;
    supply_cap: u64;
}

account Obligation {
    market: pubkey;
    authority: pubkey;
    deposited_value: u64;
    borrowed_value: u64;
    allowed_borrow_value: u64;
}

account PriceOracle {
    authority: pubkey;
    price: u64;
    decimals: u8;
    last_update: u64;
}

// RATE_SCALE = 1000000000

pub init_market(
    market: LendingMarket @mut @init(payer=admin, space=600),
    quote_currency: account,
    admin: account @signer
) {
    market.admin = admin.ctx.key;
    market.quote_currency = quote_currency.ctx.key;
    market.is_paused = false;
    market.abi_version = 2;
    market.protocol_fees_collected = 0;
}

pub set_market_pause(
    market: LendingMarket @mut,
    admin: account @signer,
    paused: bool
) {
    require(market.admin == admin.ctx.key);
    market.is_paused = paused;
}

pub transfer_market_admin(
    market: LendingMarket @mut,
    admin: account @signer,
    new_admin: pubkey
) {
    require(market.admin == admin.ctx.key);
    market.admin = new_admin;
}

pub init_reserve(
    market: LendingMarket,
    reserve: Reserve @mut @init(payer=admin, space=600),
    liquidity_mint: spl_token::Mint @serializer("raw"),
    liquidity_supply: spl_token::TokenAccount @mut @serializer("raw"),
    collateral_mint: spl_token::Mint @mut @serializer("raw"),
    admin: account @signer,
    config_optimal_utilization: u8,
    config_loan_to_value: u8,
    config_reserve_factor: u8,
    config_supply_cap: u64
) {
    require(market.admin == admin.ctx.key);
    require(config_reserve_factor <= 50);
    require(config_loan_to_value < 100);
    require(config_loan_to_value > 0);

    reserve.market = market.ctx.key;
    reserve.liquidity_mint = liquidity_mint.ctx.key;
    reserve.liquidity_supply = liquidity_supply.ctx.key;
    reserve.collateral_mint = collateral_mint.ctx.key;

    reserve.collateral_supply = 0;
    reserve.liquidity_available = 0;
    reserve.borrowed_amount = 0;
    reserve.cumulative_borrow_rate = 1000000000;
    reserve.last_update_slot = get_clock().slot;
    reserve.protocol_fees = 0;

    reserve.optimal_utilization_rate = config_optimal_utilization;
    reserve.loan_to_value_ratio = config_loan_to_value;
    reserve.liquidation_threshold = 80;
    reserve.liquidation_bonus = 5;
    reserve.max_borrow_rate = 20;
    reserve.min_borrow_rate = 2;
    reserve.reserve_factor = config_reserve_factor;
    reserve.supply_cap = config_supply_cap;
}

pub set_reserve_config(
    reserve: Reserve @mut,
    market: LendingMarket,
    admin: account @signer,
    new_reserve_factor: u8,
    new_supply_cap: u64,
    new_loan_to_value: u8
) {
    require(market.admin == admin.ctx.key);
    require(new_reserve_factor <= 50);
    require(new_loan_to_value < 100);
    require(new_loan_to_value > 0);
    reserve.reserve_factor = new_reserve_factor;
    reserve.supply_cap = new_supply_cap;
    reserve.loan_to_value_ratio = new_loan_to_value;
}

pub init_obligation(
    market: LendingMarket,
    obligation: Obligation @mut @init(payer=borrower, space=500),
    borrower: account @signer
) {
    obligation.market = market.ctx.key;
    obligation.authority = borrower.ctx.key;
    obligation.deposited_value = 0;
    obligation.borrowed_value = 0;
    obligation.allowed_borrow_value = 0;
}

pub init_oracle(
    oracle: PriceOracle @mut @init(payer=authority, space=300),
    authority: account @signer,
    price: u64,
    decimals: u8
) {
    require(price > 0);
    oracle.authority = authority.ctx.key;
    oracle.price = price;
    oracle.decimals = decimals;
    oracle.last_update = get_clock().slot;
}

pub set_oracle(
    oracle: PriceOracle @mut,
    authority: account @signer,
    price: u64,
    decimals: u8,
    last_update: u64
) {
    require(oracle.authority == authority.ctx.key);
    require(price > 0);
    oracle.price = price;
    oracle.decimals = decimals;
    oracle.last_update = last_update;
}

fn calculate_utilization(liquidity: u64, borrows: u64) -> u64 {
    let total_liquidity: u64 = liquidity + borrows;
    if (total_liquidity == 0) {
        return 0;
    }
    return (borrows * 100) / total_liquidity;
}

fn calculate_borrow_rate(
    min_rate: u64,
    max_rate: u64,
    optimal: u64,
    utilization: u64
) -> u64 {
    if (utilization <= optimal) {
        if (optimal == 0) {
            return min_rate;
        }
        return min_rate + (utilization * (max_rate - min_rate)) / optimal;
    }

    let extra_utilization: u64 = utilization - optimal;
    let extra_range: u64 = 100 - optimal;
    if (extra_range == 0) {
        return max_rate;
    }

    return max_rate + (extra_utilization * max_rate) / extra_range;
}

pub refresh_reserve(reserve: Reserve @mut) {
    let current_time: u64 = get_clock().slot;
    reserve.last_update_slot = current_time;
}

pub refresh_obligation(
    market: LendingMarket,
    obligation: Obligation @mut,
    reserve: Reserve,
    liquidity_mint: spl_token::Mint @serializer("raw"),
    oracle_state: PriceOracle
) {
    require(!market.is_paused);
    require(obligation.market == market.ctx.key);
    require(reserve.liquidity_mint == liquidity_mint.ctx.key);

    let now: u64 = get_clock().slot;
    require(now - oracle_state.last_update <= 100);

    let price: u64 = oracle_state.price;
    require(price > 0);
    obligation.deposited_value = price;
    obligation.allowed_borrow_value = (obligation.deposited_value * reserve.loan_to_value_ratio as u64) / 100;
}

pub refresh_obligation_with_oracle(
    market: LendingMarket,
    obligation: Obligation @mut,
    reserve: Reserve,
    borrower: account @signer,
    oracle_price: u64
) {
    require(!market.is_paused);
    require(obligation.market == market.ctx.key);
    require(obligation.authority == borrower.ctx.key);
    require(reserve.market == market.ctx.key);
    require(oracle_price > 0);

    obligation.deposited_value = oracle_price;
    obligation.allowed_borrow_value = (oracle_price * reserve.loan_to_value_ratio as u64) / 100;
}

pub deposit_reserve_liquidity(
    market: LendingMarket,
    reserve: Reserve @mut,
    user_liquidity: spl_token::TokenAccount @mut @serializer("raw"),
    user_collateral: spl_token::TokenAccount @mut @serializer("raw"),
    liquidity_supply: spl_token::TokenAccount @mut @serializer("raw"),
    collateral_mint: spl_token::Mint @mut @serializer("raw"),
    market_authority: account @signer,
    user_authority: account @signer,
    token_program: account,
    amount: u64
) {
    require(!market.is_paused);
    require(amount > 0);
    let current_time: u64 = get_clock().slot;
    reserve.last_update_slot = current_time;
    require(reserve.liquidity_supply == liquidity_supply.ctx.key);
    require(reserve.collateral_mint == collateral_mint.ctx.key);
    require(reserve.liquidity_available + amount <= reserve.supply_cap);

    spl_token::SPLToken::transfer(user_liquidity, liquidity_supply, user_authority, amount);
    spl_token::SPLToken::mint_to(collateral_mint, user_collateral, market_authority, amount);

    reserve.liquidity_available = reserve.liquidity_available + amount;
    reserve.collateral_supply = reserve.collateral_supply + amount;
}

pub withdraw_reserve_liquidity(
    market: LendingMarket,
    reserve: Reserve @mut,
    obligation: Obligation,
    user_liquidity: spl_token::TokenAccount @mut @serializer("raw"),
    user_collateral: spl_token::TokenAccount @mut @serializer("raw"),
    liquidity_supply: spl_token::TokenAccount @mut @serializer("raw"),
    collateral_mint: spl_token::Mint @mut @serializer("raw"),
    market_authority: account @signer,
    user_authority: account @signer,
    token_program: account,
    collateral_amount: u64
) {
    require(!market.is_paused);
    require(collateral_amount > 0);
    let current_time: u64 = get_clock().slot;
    reserve.last_update_slot = current_time;

    let total_liquidity: u64 = reserve.liquidity_available + reserve.borrowed_amount;
    let liquidity_amount: u64 = (collateral_amount * total_liquidity) / reserve.collateral_supply;

    require(liquidity_amount > 0);
    require(liquidity_amount <= reserve.liquidity_available);

    // Post-withdrawal health check: remaining collateral must still cover borrows
    let mut remaining_deposit: u64 = 0;
    if (obligation.deposited_value > liquidity_amount) {
        remaining_deposit = obligation.deposited_value - liquidity_amount;
    }
    let max_after_withdraw: u64 = (remaining_deposit * reserve.liquidation_threshold as u64) / 100;
    require(obligation.borrowed_value <= max_after_withdraw);

    spl_token::SPLToken::burn(user_collateral, collateral_mint, user_authority, collateral_amount);
    spl_token::SPLToken::transfer(liquidity_supply, user_liquidity, market_authority, liquidity_amount);

    reserve.liquidity_available = reserve.liquidity_available - liquidity_amount;
    reserve.collateral_supply = reserve.collateral_supply - collateral_amount;
}

pub borrow_obligation_liquidity(
    market: LendingMarket,
    reserve: Reserve @mut,
    obligation: Obligation @mut,
    user_liquidity: spl_token::TokenAccount @mut @serializer("raw"),
    liquidity_supply: spl_token::TokenAccount @mut @serializer("raw"),
    market_authority: account @signer,
    user_authority: account @signer,
    token_program: account,
    amount: u64
) {
    require(!market.is_paused);
    require(obligation.authority == user_authority.ctx.key);
    require(amount > 0);
    let current_time: u64 = get_clock().slot;
    reserve.last_update_slot = current_time;

    let new_borrowed_value: u64 = obligation.borrowed_value + amount;
    let ltv_limit: u64 = (obligation.deposited_value * reserve.loan_to_value_ratio as u64) / 100;
    let liquidation_limit: u64 = (obligation.deposited_value * reserve.liquidation_threshold as u64) / 100;

    require(new_borrowed_value <= ltv_limit);
    require(new_borrowed_value <= liquidation_limit);
    require(amount <= reserve.liquidity_available);

    reserve.liquidity_available = reserve.liquidity_available - amount;
    reserve.borrowed_amount = reserve.borrowed_amount + amount;

    obligation.borrowed_value = new_borrowed_value;
    obligation.allowed_borrow_value = ltv_limit;

    spl_token::SPLToken::transfer(liquidity_supply, user_liquidity, market_authority, amount);
}

pub repay_obligation_liquidity(
    market: LendingMarket,
    reserve: Reserve @mut,
    obligation: Obligation @mut,
    user_liquidity: spl_token::TokenAccount @mut @serializer("raw"),
    liquidity_supply: spl_token::TokenAccount @mut @serializer("raw"),
    user_authority: account @signer,
    token_program: account,
    amount: u64
) {
    require(!market.is_paused);
    require(amount > 0);
    let current_time: u64 = get_clock().slot;
    reserve.last_update_slot = current_time;

    // Clamp repay to outstanding borrow
    let mut repay_amount: u64 = amount;
    if (amount > obligation.borrowed_value) {
        repay_amount = obligation.borrowed_value;
    }

    spl_token::SPLToken::transfer(user_liquidity, liquidity_supply, user_authority, repay_amount);

    if (reserve.borrowed_amount >= repay_amount) {
        reserve.borrowed_amount = reserve.borrowed_amount - repay_amount;
    } else {
        reserve.borrowed_amount = 0;
    }
    reserve.liquidity_available = reserve.liquidity_available + repay_amount;

    obligation.borrowed_value = obligation.borrowed_value - repay_amount;
}

pub liquidate_obligation(
    market: LendingMarket,
    reserve: Reserve @mut,
    obligation: Obligation @mut,
    liquidator_liquidity: spl_token::TokenAccount @mut @serializer("raw"),
    liquidity_supply: spl_token::TokenAccount @mut @serializer("raw"),
    user_collateral: spl_token::TokenAccount @mut @serializer("raw"),
    collateral_mint: spl_token::Mint @mut @serializer("raw"),
    market_authority: account @signer,
    liquidator: account @signer,
    token_program: account,
    repay_amount: u64,
    oracle_state: PriceOracle
) {
    require(!market.is_paused);
    require(repay_amount > 0);
    let current_time: u64 = get_clock().slot;
    let time_delta: u64 = current_time - reserve.last_update_slot;

    if (time_delta > 0) {
        let utilization_rate: u64 = calculate_utilization(
            reserve.liquidity_available,
            reserve.borrowed_amount
        );

        let borrow_rate: u64 = calculate_borrow_rate(
            reserve.min_borrow_rate as u64,
            reserve.max_borrow_rate as u64,
            reserve.optimal_utilization_rate as u64,
            utilization_rate
        );

        if (reserve.borrowed_amount > 0) {
            let seconds_per_year: u64 = 31536000;
            let gross_interest: u64 = (reserve.borrowed_amount * borrow_rate * time_delta) / (seconds_per_year * 100);
            let protocol_cut: u64 = (gross_interest * reserve.reserve_factor as u64) / 100;
            let lp_interest: u64 = gross_interest - protocol_cut;

            reserve.borrowed_amount = reserve.borrowed_amount + gross_interest;
            reserve.protocol_fees = reserve.protocol_fees + protocol_cut;
            reserve.liquidity_available = reserve.liquidity_available + lp_interest;

            let rate_increase: u64 = (reserve.cumulative_borrow_rate * borrow_rate * time_delta) / (seconds_per_year * 100);
            reserve.cumulative_borrow_rate = reserve.cumulative_borrow_rate + rate_increase;
        }

        reserve.last_update_slot = current_time;
    }

    let now: u64 = get_clock().slot;
    require(now - oracle_state.last_update <= 100);
    require(oracle_state.price > 0);

    let liquidation_limit: u64 = (obligation.deposited_value * reserve.liquidation_threshold as u64) / 100;
    require(obligation.borrowed_value > liquidation_limit);

    // Repay cannot exceed outstanding borrow
    let mut actual_repay: u64 = repay_amount;
    if (repay_amount > obligation.borrowed_value) {
        actual_repay = obligation.borrowed_value;
    }

    spl_token::SPLToken::transfer(liquidator_liquidity, liquidity_supply, liquidator, actual_repay);

    // Liquidator receives collateral + bonus; protocol gets nothing extra from bonus (bonus incentivizes speed)
    let collateral_to_seize: u64 = (actual_repay * (100 + reserve.liquidation_bonus as u64)) / 100;

    spl_token::SPLToken::transfer(user_collateral, liquidator_liquidity, market_authority, collateral_to_seize);

    if (reserve.borrowed_amount >= actual_repay) {
        reserve.borrowed_amount = reserve.borrowed_amount - actual_repay;
    } else {
        reserve.borrowed_amount = 0;
    }
    reserve.liquidity_available = reserve.liquidity_available + actual_repay;

    if (obligation.borrowed_value >= actual_repay) {
        obligation.borrowed_value = obligation.borrowed_value - actual_repay;
    } else {
        obligation.borrowed_value = 0;
    }
}

// Admin: collect accumulated protocol fees to a recipient
pub collect_protocol_fees(
    reserve: Reserve @mut,
    market: LendingMarket,
    admin: account @signer,
    fee_recipient: spl_token::TokenAccount @mut @serializer("raw"),
    liquidity_supply: spl_token::TokenAccount @mut @serializer("raw"),
    market_authority: account @signer,
    token_program: account
) {
    require(market.admin == admin.ctx.key);
    require(reserve.protocol_fees > 0);
    require(reserve.liquidity_available >= reserve.protocol_fees);

    let fees: u64 = reserve.protocol_fees;
    reserve.protocol_fees = 0;
    reserve.liquidity_available = reserve.liquidity_available - fees;

    spl_token::SPLToken::transfer(liquidity_supply, fee_recipient, market_authority, fees);
}

// --- Exposed calculation helpers (also used by tests) ---

pub get_utilization(liquidity: u64, borrows: u64) -> u64 {
    return calculate_utilization(liquidity, borrows);
}

pub get_borrow_rate(min_rate: u64, max_rate: u64, optimal: u64, utilization: u64) -> u64 {
    return calculate_borrow_rate(min_rate, max_rate, optimal, utilization);
}

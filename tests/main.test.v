// Lending Protocol Unit Tests
// Validates utilization, borrow rate curve, interest accrual, health checks.

// Utilization: (borrows * 100) / (liquidity + borrows)
// @test-params 1000 500 33
pub test_utilization_normal(liquidity: u64, borrows: u64) -> u64 {
    let total: u64 = liquidity + borrows;
    return (borrows * 100) / total;
}

// Zero total liquidity -> 0
// @test-params 0 0 0
pub test_utilization_zero(liquidity: u64, borrows: u64) -> u64 {
    if (liquidity + borrows == 0) {
        return 0;
    }
    return (borrows * 100) / (liquidity + borrows);
}

// 100% utilization: all liquidity borrowed
// @test-params 0 1000 100
pub test_utilization_100pct(liquidity: u64, borrows: u64) -> u64 {
    let total: u64 = liquidity + borrows;
    if (total == 0) {
        return 0;
    }
    return (borrows * 100) / total;
}

// Borrow rate below kink: linear interpolation from min to max
// min=2, max=20, optimal=80, util=40 -> rate = 2 + (40*(20-2))/80 = 2 + 9 = 11
// @test-params 2 20 80 40 11
pub test_borrow_rate_below_kink(min_rate: u64, max_rate: u64, optimal: u64, utilization: u64) -> u64 {
    return min_rate + (utilization * (max_rate - min_rate)) / optimal;
}

// Borrow rate above kink: max + extra slope
// util=90, optimal=80: extra=(90-80)=10, range=(100-80)=20, rate=20 + (10*20)/20 = 30
// @test-params 20 80 90 30
pub test_borrow_rate_above_kink(max_rate: u64, optimal: u64, utilization: u64) -> u64 {
    let extra_utilization: u64 = utilization - optimal;
    let extra_range: u64 = 100 - optimal;
    return max_rate + (extra_utilization * max_rate) / extra_range;
}

// LTV boundary: max_borrow = (collateral * ltv) / 100
// @test-params 10000 75 7500
pub test_ltv_max_borrow(collateral: u64, ltv: u64) -> u64 {
    return (collateral * ltv) / 100;
}

// Liquidation threshold: position is underwater
// deposited=10000, threshold=80, borrowed=8100 -> 10000*80/100=8000 < 8100 -> liquidatable
// @test-params 10000 80 8100 true
pub test_liquidation_triggered(deposited: u64, threshold: u64, borrowed: u64) -> bool {
    let limit: u64 = (deposited * threshold) / 100;
    return borrowed > limit;
}

// @test-params 10000 80 7900 false
pub test_liquidation_not_triggered(deposited: u64, threshold: u64, borrowed: u64) -> bool {
    let limit: u64 = (deposited * threshold) / 100;
    return borrowed > limit;
}

// Interest accrual: gross_interest = (borrowed * rate * delta) / (seconds_per_year * 100)
// borrowed=1000000, rate=10, delta=3153600 (0.1yr) -> (1e6 * 10 * 3153600)/(31536000*100) = 10000
// @test-params 1000000 10 3153600 10000
pub test_interest_accrual(borrowed: u64, rate: u64, time_delta: u64) -> u64 {
    let seconds_per_year: u64 = 31536000;
    return (borrowed * rate * time_delta) / (seconds_per_year * 100);
}

// Reserve factor: protocol_cut = (gross_interest * reserve_factor) / 100
// gross=10000, factor=20 -> protocol_cut=2000, lp_interest=8000
// @test-params 10000 20 2000
pub test_reserve_factor_cut(gross_interest: u64, reserve_factor: u64) -> u64 {
    return (gross_interest * reserve_factor) / 100;
}

// LP interest = gross - protocol_cut
// @test-params 10000 20 8000
pub test_lp_interest(gross_interest: u64, reserve_factor: u64) -> u64 {
    let cut: u64 = (gross_interest * reserve_factor) / 100;
    return gross_interest - cut;
}

// Supply cap check
// @test-params 900000 1000000 50000 true
pub test_supply_cap_allows_deposit(current_total: u64, cap: u64, deposit: u64) -> bool {
    return current_total + deposit <= cap;
}

// @test-params 990000 1000000 50000 false
pub test_supply_cap_rejects_deposit(current_total: u64, cap: u64, deposit: u64) -> bool {
    return current_total + deposit <= cap;
}

// Collateral mint exchange rate: mint_amount = (deposit * collateral_supply) / total_liquidity
// @test-params 1000 5000 10000 500
pub test_collateral_mint_amount(deposit: u64, collateral_supply: u64, total_liquidity: u64) -> u64 {
    return (deposit * collateral_supply) / total_liquidity;
}

// Post-withdrawal health check: remaining collateral must cover borrows
// remaining = deposited - withdrawn, max_borrow = remaining * threshold / 100
// deposited=10000, withdrawn=3000, threshold=80, borrowed=5000
// remaining=7000, max=5600 -> 5000 <= 5600 -> ok
// @test-params 10000 3000 80 5000 true
pub test_post_withdraw_health(deposited: u64, withdrawn: u64, threshold: u64, borrowed: u64) -> bool {
    let mut remaining: u64 = 0;
    if (deposited > withdrawn) {
        remaining = deposited - withdrawn;
    }
    let max_borrow: u64 = (remaining * threshold) / 100;
    return borrowed <= max_borrow;
}

// Oracle staleness: slot diff must be <= 100
// @test-params 1000 1050 true
pub test_oracle_fresh(last_update: u64, now: u64) -> bool {
    return now - last_update <= 100;
}

// @test-params 1000 1200 false
pub test_oracle_stale(last_update: u64, now: u64) -> bool {
    return now - last_update <= 100;
}

// Reserve factor bound checks used by init/set config
// @test-params 50 true
pub test_reserve_factor_accepts_upper_bound(value: u64) -> bool {
    return value <= 50;
}

// @test-params 51 false
pub test_reserve_factor_rejects_above_upper_bound(value: u64) -> bool {
    return value <= 50;
}

// LTV config guards: must be (0, 100)
// @test-params 1 true
pub test_ltv_accepts_min_nonzero(value: u64) -> bool {
    return value > 0 && value < 100;
}

// @test-params 0 false
pub test_ltv_rejects_zero(value: u64) -> bool {
    return value > 0 && value < 100;
}

// @test-params 100 false
pub test_ltv_rejects_100(value: u64) -> bool {
    return value > 0 && value < 100;
}

// Borrow gate: amount must fit LTV limit
// @test-params 10000 75 7000 400 true
pub test_borrow_ltv_gate_ok(deposited: u64, ltv: u64, borrowed: u64, amount: u64) -> bool {
    let ltv_limit: u64 = (deposited * ltv) / 100;
    let next_borrow: u64 = borrowed + amount;
    return next_borrow <= ltv_limit;
}

// @test-params 10000 75 7000 600 false
pub test_borrow_ltv_gate_fails(deposited: u64, ltv: u64, borrowed: u64, amount: u64) -> bool {
    let ltv_limit: u64 = (deposited * ltv) / 100;
    let next_borrow: u64 = borrowed + amount;
    return next_borrow <= ltv_limit;
}

// Borrow gate: amount must fit liquidation threshold too
// @test-params 10000 80 7600 300 true
pub test_borrow_liquidation_gate_ok(deposited: u64, threshold: u64, borrowed: u64, amount: u64) -> bool {
    let liquidation_limit: u64 = (deposited * threshold) / 100;
    let next_borrow: u64 = borrowed + amount;
    return next_borrow <= liquidation_limit;
}

// @test-params 10000 80 7900 200 false
pub test_borrow_liquidation_gate_fails(deposited: u64, threshold: u64, borrowed: u64, amount: u64) -> bool {
    let liquidation_limit: u64 = (deposited * threshold) / 100;
    let next_borrow: u64 = borrowed + amount;
    return next_borrow <= liquidation_limit;
}

// Borrow gate: reserve liquidity must be sufficient
// @test-params 1000 750 true
pub test_borrow_liquidity_gate_ok(available: u64, amount: u64) -> bool {
    return amount <= available;
}

// @test-params 1000 1001 false
pub test_borrow_liquidity_gate_fails(available: u64, amount: u64) -> bool {
    return amount <= available;
}

// Repay clamp: repay cannot exceed outstanding borrow
// @test-params 500 200 200
pub test_repay_clamps_to_outstanding(borrowed: u64, amount: u64) -> u64 {
    if (amount > borrowed) {
        return borrowed;
    }
    return amount;
}

// @test-params 500 300 300
pub test_repay_partial_keeps_amount(borrowed: u64, amount: u64) -> u64 {
    if (amount > borrowed) {
        return borrowed;
    }
    return amount;
}

// Withdraw conversion from collateral -> liquidity amount
// liquidity_available=800000 borrowed=200000 total=1000000
// collateral_amount=250000 collateral_supply=1000000 -> 250000
// @test-params 800000 200000 250000 1000000 250000
pub test_withdraw_liquidity_conversion(
    liquidity_available: u64,
    borrowed_amount: u64,
    collateral_amount: u64,
    collateral_supply: u64
) -> u64 {
    let total_liquidity: u64 = liquidity_available + borrowed_amount;
    return (collateral_amount * total_liquidity) / collateral_supply;
}

// Withdraw post-health fail example
// deposited=10000 withdrawn=7000 threshold=80 borrowed=3000
// remaining=3000 max=2400 -> borrowed > max, must fail
// @test-params 10000 7000 80 3000 false
pub test_post_withdraw_health_fails(deposited: u64, withdrawn: u64, threshold: u64, borrowed: u64) -> bool {
    let mut remaining: u64 = 0;
    if (deposited > withdrawn) {
        remaining = deposited - withdrawn;
    }
    let max_borrow: u64 = (remaining * threshold) / 100;
    return borrowed <= max_borrow;
}

// Oracle-based allowed borrow refresh
// price=2_000_000, ltv=75 => 1_500_000
// @test-params 2000000 75 1500000
pub test_refresh_allowed_borrow(price: u64, ltv: u64) -> u64 {
    return (price * ltv) / 100;
}

// Liquidation seize math with bonus
// repay=50000 bonus=5% => 52500 collateral seized
// @test-params 50000 5 52500
pub test_liquidation_collateral_seize(repay_amount: u64, liquidation_bonus: u64) -> u64 {
    return (repay_amount * (100 + liquidation_bonus)) / 100;
}

// Liquidation repay clamp
// @test-params 120000 200000 120000
pub test_liquidation_repay_clamp(borrowed: u64, requested_repay: u64) -> u64 {
    if (requested_repay > borrowed) {
        return borrowed;
    }
    return requested_repay;
}

// Cumulative borrow rate update step used by liquidation accrual path
// rate=10, delta=3153600, cumulative=1_000_000_000 => +10_000_000 => 1_010_000_000
// @test-params 1000000000 10 3153600 1010000000
pub test_cumulative_borrow_rate_step(cumulative: u64, rate: u64, time_delta: u64) -> u64 {
    let seconds_per_year: u64 = 31536000;
    let increase: u64 = (cumulative * rate * time_delta) / (seconds_per_year * 100);
    return cumulative + increase;
}

// Protocol fee collection effects on reserve liquidity
// available=500000 fees=12000 -> remaining=488000
// @test-params 500000 12000 488000
pub test_collect_fees_liquidity_delta(liquidity_available: u64, fees: u64) -> u64 {
    return liquidity_available - fees;
}

// Borrow rate edge: optimal=0 must return min rate (guard branch in contract helper)
// @test-params 3 25 0 40 3
pub test_borrow_rate_optimal_zero_returns_min(
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

// Borrow rate edge: optimal=100 and utilization>100 hits extra_range==0 branch
// @test-params 2 20 100 110 20
pub test_borrow_rate_extra_range_zero_returns_max(
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

// Pause gate used across state-mutating instructions
// @test-params false true
pub test_market_pause_gate_allows_when_unpaused(is_paused: bool) -> bool {
    return !is_paused;
}

// @test-params true false
pub test_market_pause_gate_rejects_when_paused(is_paused: bool) -> bool {
    return !is_paused;
}

// Admin auth gate for market-level administrative instructions
// @test-params 1 1 true
pub test_market_admin_auth_accepts_matching_keys(admin: u64, caller: u64) -> bool {
    return admin == caller;
}

// @test-params 1 2 false
pub test_market_admin_auth_rejects_mismatched_keys(admin: u64, caller: u64) -> bool {
    return admin == caller;
}

// Oracle authority + price guard for set_oracle/init_oracle
// @test-params 9 9 1 true
pub test_oracle_update_guard_allows_valid(authority: u64, caller: u64, price: u64) -> bool {
    return authority == caller && price > 0;
}

// @test-params 9 8 1 false
pub test_oracle_update_guard_rejects_wrong_authority(authority: u64, caller: u64, price: u64) -> bool {
    return authority == caller && price > 0;
}

// @test-params 9 9 0 false
pub test_oracle_update_guard_rejects_zero_price(authority: u64, caller: u64, price: u64) -> bool {
    return authority == caller && price > 0;
}

// Withdraw gate: computed liquidity amount must fit available liquidity
// total=1200, collateral=200, supply=1000 => liquidity_amount=240 <= 500 -> true
// @test-params 500 700 200 1000 true
pub test_withdraw_liquidity_gate_ok(
    liquidity_available: u64,
    borrowed_amount: u64,
    collateral_amount: u64,
    collateral_supply: u64
) -> bool {
    let total_liquidity: u64 = liquidity_available + borrowed_amount;
    let liquidity_amount: u64 = (collateral_amount * total_liquidity) / collateral_supply;
    return liquidity_amount > 0 && liquidity_amount <= liquidity_available;
}

// total=1200, collateral=800, supply=1000 => liquidity_amount=960 > 500 -> false
// @test-params 500 700 800 1000 false
pub test_withdraw_liquidity_gate_rejects_insufficient_available(
    liquidity_available: u64,
    borrowed_amount: u64,
    collateral_amount: u64,
    collateral_supply: u64
) -> bool {
    let total_liquidity: u64 = liquidity_available + borrowed_amount;
    let liquidity_amount: u64 = (collateral_amount * total_liquidity) / collateral_supply;
    return liquidity_amount > 0 && liquidity_amount <= liquidity_available;
}

// total=1, collateral=1, supply=2 => liquidity_amount=0 (integer floor) -> false
// @test-params 1 0 1 2 false
pub test_withdraw_liquidity_gate_rejects_zero_liquidity_amount(
    liquidity_available: u64,
    borrowed_amount: u64,
    collateral_amount: u64,
    collateral_supply: u64
) -> bool {
    let total_liquidity: u64 = liquidity_available + borrowed_amount;
    let liquidity_amount: u64 = (collateral_amount * total_liquidity) / collateral_supply;
    return liquidity_amount > 0 && liquidity_amount <= liquidity_available;
}

// Fee collection guard: requires positive fees and enough available liquidity
// @test-params 12000 40000 true
pub test_collect_fees_guard_accepts_valid(fees: u64, liquidity_available: u64) -> bool {
    return fees > 0 && liquidity_available >= fees;
}

// @test-params 0 40000 false
pub test_collect_fees_guard_rejects_zero_fees(fees: u64, liquidity_available: u64) -> bool {
    return fees > 0 && liquidity_available >= fees;
}

// @test-params 12000 10000 false
pub test_collect_fees_guard_rejects_insufficient_liquidity(fees: u64, liquidity_available: u64) -> bool {
    return fees > 0 && liquidity_available >= fees;
}

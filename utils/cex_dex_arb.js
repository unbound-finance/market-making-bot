/* POC functions */
/*
// Maximum amount we can buy on v3 while remaining within the same tick
function compute_xb(sqrtP, L) {
    var ic = Math.floor(((2 * Math.log(sqrtP) / Math.log(1.0001)) - OFFSET) / SPACING);
    return L * (1 / sqrtP - 1.0001 ** (-(OFFSET + SPACING * (ic + 1)) / 2.0));
    // var ic = Math.floor(new bn(Math.log(sqrtP)).dividedBy(Math.log(1.0001)).multipliedBy(2).minus(OFFSET).dividedBy(SPACING).toFixed());
    // let ans = new bn(L)
    //     .multipliedBy(new bn(1).dividedBy(sqrtP).minus(new bn(1.0001).pow((new bn(OFFSET).plus(new bn(SPACING).multipliedBy(new bn(ic).plus(1)))).dividedBy(2).negated())))
    // return ans.toFixed(12);
}

// Maximum amount we can sell on v3 while remaining within the same tick
function compute_xs(sqrtP, L) {
    var ic = Math.floor(((2 * Math.log(sqrtP) / Math.log(1.0001)) - OFFSET) / SPACING);
    return L * (1.0001 ** (-(OFFSET + SPACING * ic) / 2) - 1 / sqrtP);
    // var ic = Math.floor(new bn(Math.log(sqrtP)).dividedBy(Math.log(1.0001)).multipliedBy(2).minus(OFFSET).dividedBy(SPACING).toFixed());
    // let ans = new bn(L)
    //     .multipliedBy(new bn(1.0001).pow((new bn(OFFSET).plus(new bn(SPACING).multipliedBy(ic))).dividedBy(2).negated()).minus(new bn(1).dividedBy(sqrtP)))
    // return ans.toFixed(12);
}

// Algorithm to compute the maximum profit and the amount corresponding to it (on the bid side)
function bid_side_profit(bids, xb, pool_info, fc, fd) {
    var s = 0;
    var v = 0;
    var x = xb;

    function PnL(x, s, v, b) {
        return (v + b * x) * (1 - fc) - (s + x) * pool_info.sqrtP * pool_info.sqrtP * pool_info.L / (pool_info.L - (s + x) * pool_info.sqrtP) / (1 - fd);
    }

    for (i = 0; i < bids.length; i++) {
        // Current bid, amt
        var b = bids[i][0];
        var q = bids[i][1];

        // argmax of PnL at the current bid (i.e., the function PnL above)
        var z = pool_info.L * (1 / pool_info.sqrtP - 1 / Math.sqrt(b * (1 - fc) * (1 - fd))) - s;
        // var z = new bn(pool_info.L)
        //             .multipliedBy(new bn(1).dividedBy(pool_info.sqrtP).minus(new bn(1).dividedBy(new bn(b).multipliedBy(1-fc).multipliedBy(1-fd).squareRoot())))
        //             .minus(s).toFixed()
        // console.log({z})
        // If argmax <= 0, PnL can only decrease from here... return best PnL so far
        if (z <= 0) {
            return {
                amount: Math.floor(s),
                profit: PnL(0, s, v, b),
                side: "Bid"
            };
        } else if (z <= q || x <= q) {
            // If argmax <= current amount, then found the maximum at s+z, return it
            // If x <= current amount, then at s+x, v3 hits the next tick. So return s+x...
            return {
                amount: Math.floor(s + Math.min(z, x)),
                profit: PnL(Math.min(z, x), s, v, b),
                side: "Bid"
            };
        }

        // Update s, v, x
        s += q;
        v += b * q;
        x -= q;
    }

    // If all the bids are exhausted, return the best PnL so far
    return {
        amount: Math.floor(s),
        profit: PnL(q, s, v, b),
        side: "Bid"
    };
}

function ask_side_profit(asks, xs, pool_info, fc, fd) {
    var s = 0;
    var v = 0;
    var x = Number(xs) / (1 - fd);

    function PnL(x, s, v, a) {
        return (s + x) * (1 - fd) * pool_info.sqrtP * pool_info.sqrtP * pool_info.L / (pool_info.L + (s + x) * pool_info.sqrtP * (1 - fd)) - (v + a * x) / (1 - fc);
    }

    for (i = 0; i < asks.length; i++) {
        // Current ask, amt
        var a = Number(asks[i][0]);
        var q = Number(asks[i][1]);

        // argmax of PnL at the current ask (i.e., the function PnL above)
        var z = pool_info.L * (Math.sqrt((1 - fc) / a) - 1 / pool_info.sqrtP / Math.sqrt(1 - fd)) / Math.sqrt(1 - fd) - s;

        // var z = new bn(pool_info.L)
        //             .multipliedBy(new bn(1-fc).dividedBy(a).squareRoot().minus(new bn(1).dividedBy(pool_info.sqrtP).dividedBy(new bn(1-fd).squareRoot())))
        //             .dividedBy(new bn(1-fd).squareRoot().minus(s)).toFixed()
        console.log({ z });
        // If argmax <= 0, PnL can only decrease from here... return best PnL so far
        if (z <= 0) {
            return {
                amount: Math.floor(s),
                profit: PnL(0, s, v, a),
                side: "Ask"
            };
        } else if (z <= q || x <= q) {
            // If argmax <= current amount, then found the maximum at s+z, return it
            // If x <= current amount, then at s+x, v3 hits the next tick. So return s+x...
            return {
                amount: Math.floor(s + Math.min(z, x)),
                profit: PnL(Math.min(z, x), s, v, a),
                side: "Ask"
            };
        }
        // Update s, v, x
        s += q;
        v += a * q;
        x -= q;

    }

    // If all the asks are exhausted, return the best PnL so far
    return {
        amount: Math.floor(s),
        profit: PnL(q, s, v, a),
        side: "Ask"
    };

}

function walk_the_book(bids, asks, pool_info, fc, fd) {

    // let pDex = new bn(pool_info['sqrtP']).multipliedBy(pool_info['sqrtP']);
    let pCex = bids[0][0] * (1 - fc) * (1 - fd);

    // Condition for arb on the bid side - buy on dex, sell on cex
    // if (pDex.isLessThan(pCex)){
    if (pool_info['sqrtP'] * pool_info['sqrtP'] < bids[0][0] * (1 - fc) * (1 - fd)) {
        // Maximum amt we can buy on dex
        var xb = compute_xb(pool_info.sqrtP, pool_info.L);
        return bid_side_profit(bids, xb, pool_info, fc, fd);
    }

    // Condition for arb on the ask side - cex buy, dex sell
    // if(new bn(pool_info['sqrtP']).multipliedBy(pool_info['sqrtP']).multipliedBy(1-fc).multipliedBy(1-fd).isGreaterThan(asks[0][0])){
    if (pool_info['sqrtP'] * pool_info['sqrtP'] * (1 - fc) * (1 - fd) > asks[0][0]) {
        // Maximum amt we can buy on dex
        var xs = compute_xs(pool_info['sqrtP'], pool_info['L']);
        return ask_side_profit(asks, xs, pool_info, fc, fd);
    }

    return "None";
}
*/

exports.TickHandler = class {
    constructor(delta_decimal = 0, spacing = 1) {
        this.delta_decimal = delta_decimal;
        this.O = delta_decimal / Math.log10(1.0001);
        this.S = spacing;
        this._current_tick = null;
        this.base_sqrt = 1.0001 ** (this.S / 2.0);
    }

    _get_tick_from_sqrt_price(sqrt_price) {
        return Math.floor((2 * Math.log(sqrt_price) / Math.log(1.0001) - this.O) / this.S);
    }

    set_current_tick_and_sqrt_price(sqrt_price) {
        this._current_tick = this._get_tick_from_sqrt_price(sqrt_price);
        this._sqrt_price = sqrt_price;
    }

    get_liquidity_and_subt_at_tick(tick_idx, L, sqrt_price = null) {
        if (this._current_tick == null) {
            this.set_current_tick_and_sqrt_price(sqrt_price);
        }

        var base = 1.0001 ** ((this.O + this.S * tick_idx) / 2.0);
        let base_inv = 1.0 / base;

        if (tick_idx == this._current_tick) {
            let sqrt_price_inv = 1.0 / sqrt_price;
            return {
                liq: [
                    L * (sqrt_price_inv - base_inv / this.base_sqrt), //xb
                    L * (base_inv - sqrt_price_inv), //xs
                    L * (sqrt_price - base), //yb
                    L * (base * this.base_sqrt - sqrt_price) //ys
                ], sqrtP_subt: base
            };
        } else {
            let L_delta = L * (this.base_sqrt - 1.0);
            var x = L_delta * base_inv / this.base_sqrt, y = L_delta * base;
            return { liq: [x, x, y, y], sqrtP_subt: base };
        }
    }

    sqrtP_subt(tick_idx) {
        return 1.0001 ** ((this.O + this.S * tick_idx) / 2.0);
    }

    sqrtP_supt(tick_idx) {
        return 1.0001 ** ((this.O + this.S * (tick_idx + 1)) / 2.0);
    }
};


// Uni v3 functions: if x is gov token and y is base token
function pnl_bid_x(x, sc, vc, sd, vd, fc, fd, bk, sqrtP, L) {
    let pos = sc - sd + x;
    return (vc + bk * x) * (1 - fc) - vd / (1 - fd) - pos * sqrtP * sqrtP * L / (L - pos * sqrtP) / (1 - fd);
}

// Algorithm to compute the maximum profit and the amount 
// corresponding to it (on the bid side & if y is base token)
function bid_side_profit_x(bids, pool_info, fc, fd, th) {
    let K = bids.length;
    if (K == 0) { return { amount: 0.0, profit: 0.0, side: "Bid", cexamtout: 0.0 }; }

    // trade-size and volume
    var sc = 0.0, vc = 0.0, sd = 0.0, vd = 0.0;

    // cex index
    var k = 0, b = bids[0][0], q = bids[0][1];

    // dex index and stuff
    var sqrtP = pool_info.sqrtP;
    t = th._current_tick;
    L = pool_info.liquidity[t];
    liq = th.get_liquidity_and_subt_at_tick(t, L, sqrtP);
    let xb = liq.liq[0], ys = liq.liq[3];
    x = xb;

    function PnL(delx) {
        return pnl_bid_x(delx, sc, vc, sd, vd, fc, fd, b, sqrtP, L);
    }

    while (k < K) {
        z = L * (1 / sqrtP - 1 / Math.sqrt(b * (1 - fc) * (1 - fd))) - sc + sd;
        if (z <= 0) { return { amount: sc, profit: PnL(0), side: "Bid", cexamtout: vc * (1 - fc) }; }
        if (x < q) {
            if (z <= x) { return { amount: sc + z, profit: PnL(z), side: "Bid", cexamtout: (vc + z * b) * (1 - fc) }; }
            else if (pool_info.liquidity[t + 1] == 0) {
                return { amount: sc, profit: PnL(0), side: "Bid", cexamtout: vc * (1 - fc), force: "dex" }; //delta_d = x
            }
            else {
                sc += x;
                vc += b * x;
                sd += xb;
                vd += ys;
                q -= x;
                t += 1;
                L = pool_info.liquidity[t];
                liq = th.get_liquidity_and_subt_at_tick(t, L, sqrtP);
                sqrtP = liq.sqrtP_subt;
                xb = liq.liq[0];
                ys = liq.liq[3];
                x = xb;
                continue;
            }
        } else if (z <= q) {
            return { amount: sc + z, profit: PnL(z), side: "Bid", cexamtout: (vc + b * z) * (1 - fc) };
        }
        sc += q;
        vc += q * b;
        x -= q;
        k += 1;
        if (k < K) {
            b = bids[k][0];
            q = bids[k][1];
        }
    }
    return {
        amount: sc - q,  // delta_c = q
        profit: pnl_bid_x(0),
        side: "Bid",
        cexamtout: (vc - q * b) * (1 - fc),
        force: "cex"
    };
}

function pnl_ask_x(x, sc, vc, sd, vd, fc, fd, ak, sqrtP, L) {
    pos = (sc - sd / (1 - fd) + x);
    return vd + pos * (1 - fd) * sqrtP * sqrtP * L / (L + pos * sqrtP * (1 - fd)) - (vc + ak * x) / (1 - fc);
}

// Algorithm to compute the maximum profit and the amount 
// corresponding to it (on the ask side & if y is base token)
function ask_side_profit_x(asks, pool_info, fc, fd, th) {
    let K = asks.length;
    if (K == 0) { return { amount: 0.0, profit: 0.0, side: "Ask", cexamtin: 0.0 }; }

    // trade-size and volume
    var sc = 0.0, vc = 0.0, sd = 0.0, vd = 0.0;

    //cex index
    var k = 0, a = asks[0][0], q = asks[0][1];

    //dex stuff
    var sqrtP = pool_info.sqrtP;
    t = th._current_tick;
    L = pool_info.liquidity[t];
    liq = th.get_liquidity_and_subt_at_tick(t, L, sqrtP);
    let xs = liq.liq[1], yb = liq.liq[2];
    x = xs / (1 - fd);

    function PnL(delx) {
        return pnl_ask_x(delx, sc, vc, sd, vd, fc, fd, a, sqrtP, L);
    }

    while (k < K) {
        z = L * (Math.sqrt((1 - fc) / a) - 1 / sqrtP / Math.sqrt(1 - fd)) / Math.sqrt(1 - fd) - sc + sd / (1 - fd);
        if (z <= 0) { return { amount: sc, profit: PnL(0), side: "Ask", cexamtin: vc / (1 - fc) }; }
        if (x < q) {
            if (z <= x) { return { amount: sc + z, profit: PnL(z), side: "Ask", cexamtin: (vc + z * a) / (1 - fd) }; }
            else if (pool_info.liquidity[t - 1] == 0) {
                return { amount: sc, profit: PnL(0), side: "Ask", force: "dex", cexamtin: vc / (1 - fd) }; //delta_d = x
            }
            else {
                sc += x;
                vc += x * a;
                sd += xs;
                vd += yb;
                q -= x;
                t -= 1;
                L = pool_info.liquidity[t];
                sqrtP = liq.sqrtP_subt;
                liq = th.get_liquidity_and_subt_at_tick(t, L, sqrtP);
                xs = liq.liq[1];
                yb = liq.liq[2];
                x = xs / (1 - fd);
                continue;
            }
        } else if (z <= q) {
            return { amount: sc + z, profit: PnL(z), side: "Ask", cexamtin: (vc + z * a) / (1 - fd) };
        }

        sc += q;
        vc += q * a;
        x -= q;
        k += 1;
        if (k < K) {
            a = asks[k][0];
            q = asks[k][1];
        }
    }
    return { amount: sc - q, profit: PnL(0), side: "Ask", force: "cex", cexamtin: (sc - q * a) / (1 - fd) }; //delta_c = q
}

exports.walk_the_book_x = (bids, asks, pool_info, fc, fd, th) => {
    sqrtP = pool_info.sqrtP;

    // Condition for arb on the bid side - buy on dex, sell on cex
    if (sqrtP * sqrtP < bids[0][0] * (1 - fc) * (1 - fd)) {
        return bid_side_profit_x(bids, pool_info, fc, fd, th);
    }

    // Condition for arb on the ask side - cex buy, dex sell
    if (sqrtP * sqrtP * (1 - fc) * (1 - fd) > asks[0][0]) {
        return ask_side_profit_x(asks, pool_info, fc, fd, th);
    }

    return null;
};

// Uni v3 functions: if y is gov token and x is base token
function pnl_bid_y(y, sc, vc, sd, vd, fc, fd, bk, sqrtP, L) {
    let pos = sc - sd + y;
    return (vc + bk * y) * (1 - fc) - vd / (1 - fd) - pos * L / (L * sqrtP - pos) / sqrtP / (1 - fd);
}

// Algorithm to compute the maximum profit and the amount 
// corresponding to it (on the bid side & if x is base token)
function bid_side_profit_y(bids, pool_info, fc, fd, th) {
    let K = bids.length;
    if (K == 0) { return { amount: 0.0, profit: 0.0, side: "Bid", cexamtout: 0.0 }; }

    // trade-size and volume
    var sc = 0.0, vc = 0.0, sd = 0.0, vd = 0.0;

    // cex index
    var k = 0, b = bids[0][0], q = bids[0][1];

    // dex index and stuff
    var sqrtP = pool_info.sqrtP;
    t = th._current_tick;
    L = pool_info.liquidity[t];
    liq = th.get_liquidity_and_subt_at_tick(t, L, sqrtP);
    let yb = liq.liq[2], xs = liq.liq[1];
    y = yb;

    function PnL(dely) {
        return pnl_bid_y(dely, sc, vc, sd, vd, fc, fd, b, sqrtP, L);
    }

    while (k < K) {
        z = L * (sqrtP - 1 / Math.sqrt(b * (1 - fc) * (1 - fd))) - sc + sd;
        if (z <= 0) { return { amount: sc, profit: PnL(0), side: "Bid", cexamtout: vc * (1 - fc) }; }
        if (y < q) {
            if (z <= y) { return { amount: sc + z, profit: PnL(z), side: "Bid", cexamtout: (vc + z * b) * (1 - fc) }; }
            else if (pool_info.liquidity[t - 1] == 0) {
                return { amount: sc, profit: PnL(0), side: "Bid", cexamtout: vc * (1 - fc), force: "dex" }; //delta_d = y
            }
            else {
                sc += y;
                vc += b * y;
                sd += yb;
                vd += xs;
                q -= y;
                t -= 1;
                L = pool_info.liquidity[t];
                sqrtP = liq.sqrtP_subt;
                liq = th.get_liquidity_and_subt_at_tick(t, L, sqrtP);
                yb = liq.liq[2];
                xs = liq.liq[1];
                y = yb;
                continue;
            }
        } else if (z <= q) {
            return { amount: sc + z, profit: PnL(z), side: "Bid", cexamtout: (vc + b * z) * (1 - fc) };
        }
        sc += q;
        vc += q * b;
        y -= q;
        k += 1;
        if (k < K) {
            b = bids[k][0];
            q = bids[k][1];
        }
    }
    return {
        amount: sc - q,  // delta_c = q
        profit: pnl_bid_x(0),
        side: "Bid",
        cexamtout: (vc - q * b) * (1 - fc),
        force: "cex"
    };
}

function pnl_ask_y(y, sc, vc, sd, vd, fc, fd, ak, sqrtP, L) {
    pos = (sc - sd / (1 - fd) + y);
    return vd + pos * (1 - fd) * L / (L * sqrtP * sqrtP + pos * sqrtP * (1 - fd)) - (vc + ak * y) / (1 - fc);
}

// Algorithm to compute the maximum profit and the amount 
// corresponding to it (on the ask side & if x is base token)
function ask_side_profit_y(asks, pool_info, fc, fd, th) {
    let K = asks.length;
    if (K == 0) { return { amount: 0.0, profit: 0.0, side: "Ask", cexamtin: 0.0 }; }

    // trade-size and volume
    var sc = 0.0, vc = 0.0, sd = 0.0, vd = 0.0;

    //cex index
    var k = 0, a = asks[0][0], q = asks[0][1];

    //dex stuff
    var sqrtP = pool_info.sqrtP;
    t = th._current_tick;
    L = pool_info.liquidity[t];
    liq = th.get_liquidity_and_subt_at_tick(t, L, sqrtP);
    let ys = liq.liq[3], xb = liq.liq[0];
    y = ys / (1 - fd);

    function PnL(dely) {
        return pnl_ask_y(dely, sc, vc, sd, vd, fc, fd, a, sqrtP, L);
    }

    while (k < K) {
        z = L * (Math.sqrt((1 - fc) / a) - sqrtP / Math.sqrt(1 - fd)) / Math.sqrt(1 - fd) - sc + sd / (1 - fd);
        if (z <= 0) { return { amount: sc, profit: PnL(0), side: "Ask", cexamtin: vc / (1 - fc) }; }
        if (y < q) {
            if (z <= y) { return { amount: sc + z, profit: PnL(z), side: "Ask", cexamtin: (vc + z * a) / (1 - fd) }; }
            else if (pool_info.liquidity[t + 1] == 0) {
                return { amount: sc, profit: PnL(0), side: "Ask", force: "dex", cexamtin: vc / (1 - fd) }; //delta_d = x
            }
            else {
                sc += y;
                vc += y * a;
                sd += ys;
                vd += xb;
                q -= y;
                t += 1;
                L = pool_info.liquidity[t];
                liq = th.get_liquidity_and_subt_at_tick(t, L, sqrtP);
                sqrtP = liq.sqrtP_subt;
                ys = liq.liq[3];
                xb = liq.liq[0];
                y = ys / (1 - fd);
                continue;
            }
        } else if (z <= q) {
            return { amount: sc + z, profit: PnL(z), side: "Ask", cexamtin: (vc + z * a) / (1 - fd) };
        }

        sc += q;
        vc += q * a;
        y -= q;
        k += 1;
        if (k < K) {
            a = asks[k][0];
            q = asks[k][1];
        }
    }
    return { amount: sc - q, profit: PnL(0), side: "Ask", force: "cex", cexamtin: (sc - q * a) / (1 - fd) }; //delta_c = q
}

exports.walk_the_book_y = (bids, asks, pool_info, fc, fd, th) => {
    sqrtP = pool_info.sqrtP;

    // Condition for arb on the bid side - buy on dex, sell on cex
    if (sqrtP * sqrtP * bids[0][0] * (1 - fc) * (1 - fd) > 1.0) {
        return bid_side_profit_x(bids, pool_info, fc, fd, th);
    }

    // Condition for arb on the ask side - cex buy, dex sell
    if (sqrtP * sqrtP * asks[0][0] < (1 - fc) * (1 - fd)) {
        return ask_side_profit_x(asks, pool_info, fc, fd, th);
    }

    return null;
};
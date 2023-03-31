var ccxt = require('ccxt');
var fs = require('fs');
var Web3 = require('web3');
require('dotenv').config();
var { tickToPrice } = require("@uniswap/v3-sdk");
var { Token } = require('@uniswap/sdk-core');
var JSBI = require("jsbi");
var bn = require('bignumber.js');
const { toFixed } = require('@thanpolas/crypto-utils');
const exchange = require('./utils/exchangeLib');
const web3Lib = require('./utils/web3');

var { TickHandler, walk_the_book_x } = require('./utils/cex_dex_arb');

const univ3 = require('./utils/uniswapV3Lib');
const CONFIG = require("./config/config");

const MIN_PROFIT = 0; // setiing minimum profit to 0% right now
const MIN_AMT = 100; // minimum amount to trade
var kucoin, huobi;
const NEIGHBOUR_DEPTH = 2; //how many neighbouring ticks to query
const AMT_PRECISION = 10 ** 0; //how many decimals for base token
const CEX_SYMBOL = "UNB/USDT";
const RESERVES_MULT = 0.95; //reduce the reserves by this much when fed into algo

var web3 = new Web3(new Web3.providers.HttpProvider(CONFIG.NETWORK_RPC_ARBITRUM));

const TOKEN0 = {
    address: "0xD5eBD23D5eb968c2efbA2B03F27Ee61718609A71",
    decimals: 18,
    name: "Unbound",
    symbol: "UNB"
};

const TOKEN1 = {
    address: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
    decimals: 6,
    name: "USD Coin (PoS)",
    symbol: "USDC"
};


const baseToken = new Token(CONFIG.CHAIN_ID_ARBITRUM, TOKEN0.address, TOKEN0.decimals, TOKEN0.symbol, TOKEN0.name);
const quoteToken = new Token(CONFIG.CHAIN_ID_ARBITRUM, TOKEN1.address, TOKEN1.decimals, TOKEN1.symbol, TOKEN1.name);

const undUsdcPool = new web3.eth.Contract(CONFIG.UNIV3_POOL_ABI, CONFIG.UNI_V3_POOL_ARBITRUM);
const uniswapV3Router = new web3.eth.Contract(CONFIG.UNIV3_ROUTER_ABI, CONFIG.UNIV3_ROUTER_ADDRESS);

const token0Contract = new web3.eth.Contract(CONFIG.ERC20_ABI, TOKEN0.address);
const token1Contract = new web3.eth.Contract(CONFIG.ERC20_ABI, TOKEN1.address);

async function get_dex_reserves() {
    var reserves0 = await token0Contract.methods.balanceOf(process.env.ADDRESS).call();
    var reserves1 = await token1Contract.methods.balanceOf(process.env.ADDRESS).call();
    return {
        reserves0: parseFloat(reserves0) / (10 ** TOKEN0.decimals) * RESERVES_MULT,
        reserves1: parseFloat(reserves1) / (10 ** TOKEN1.decimals) * RESERVES_MULT
    };
}

// Convert pool info into actual values
function convert_price(price) {
    return price / (2 ** 96) * 1e6;
}
function convert_liquidity(pool_info) {
    for (tick in pool_info.liquidity) {
        pool_info.liquidity[tick] = pool_info.liquidity[tick] * 1e-12;
    }
    return pool_info;
}

function _initAndTestConnections() {
    kucoin = new ccxt.kucoin({ enableRateLimit: true });
    huobi = new ccxt.huobi();

    kucoin.apiKey = process.env.KUCOIN_APIKEY;
    kucoin.secret = process.env.KUCOIN_SECRET;
    kucoin.password = process.env.KUCOIN_PASSWORD;

    huobi.apiKey = process.env.HUOBI_APIKEY;
    huobi.secret = process.env.HUOBI_SECRET;

    // test connection with exchange
    kucoin.checkRequiredCredentials();
    huobi.checkRequiredCredentials();

    return [{
        exchange: kucoin,
        minamt: 1.1 //required minimum size of trade in quote token
    },
    {
        exchange: huobi,
        minamt: 10.1 //required minimum size of trade in quote token
    }];
}

async function populate_neighbouring_liquidity(pool, pool_info, th) {
    var current_tick = th._current_tick;
    let liq = parseFloat(pool_info.liquidity);
    let spacing = pool_info.tickSpacing;
    var liquidity = {};
    liquidity[current_tick] = liq;
    for (t = current_tick + 1; t <= current_tick + NEIGHBOUR_DEPTH; t++) {
        net_liq = await univ3.getPoolLiquidityNet(pool, t * spacing);
        liq += parseFloat(net_liq);
        liquidity[t] = liq;
    }

    liq = parseFloat(pool_info.liquidity);
    for (t = current_tick - 1; t >= current_tick - NEIGHBOUR_DEPTH; t--) {
        net_liq = await univ3.getPoolLiquidityNet(pool, (t + 1) * spacing);
        liq -= parseFloat(net_liq);
        liquidity[t] = liq;
    }

    liquidity[current_tick - NEIGHBOUR_DEPTH - 1] = 0;
    liquidity[current_tick + NEIGHBOUR_DEPTH + 1] = 0;

    pool_info.liquidity = liquidity;
    return pool_info;
}

async function make_cex_dex_trade(trade) {
    // precision handling
    trade.amount = Math.floor(trade.amount * AMT_PRECISION) / AMT_PRECISION;

    var cex_order, dex_order, dex_side, cex_amt, success = true;
    // buy on dex, sell on cex
    if (trade.side == "Bid" && trade.amount >= MIN_AMT && trade.profit >= MIN_PROFIT) {

        // execute buy transaction on uniswapv3 first?
        await web3Lib.swapExactOutputSingle(
            web3,
            uniswapV3Router,
            CONFIG.CHAIN_ID_ARBITRUM,
            TOKEN1.address, // USDC
            TOKEN0.address, // UND
            trade.dex_fee_standard,
            new bn(trade.amount).multipliedBy(10 ** baseToken.decimals).toFixed(), // amountOut
            new bn(trade.cexamtout - MIN_PROFIT).multipliedBy(10 ** quoteToken.decimals).toFixed(0), //amountInMaximum
            0,
            trade.profit / trade.eth_price //allowedCost
        ).then(async (tx) => {
            cex_order = await trade.exchange_var.createOrder(CEX_SYMBOL, "market", "sell", trade.amount, trade.exchange_price);
            dex_order = tx;
        }).catch(err => {
            console.log(err);
            success = false;
        });
        if (!success) { return false; }

        console.log("cex_order:", cex_order.id);
        console.log("dex_order:", dex_order);
        dex_side = "buy";
        cex_amt = trade.cexamtout;
    }
    // sell on dex, buy on cex
    else if (trade.side = "Ask" && trade.amount >= MIN_AMT && trade.profit >= MIN_PROFIT) {

        // execute sell transaction on uniswapv3 first?
        dex_order = await web3Lib.swapExactInputSingle(
            web3,
            uniswapV3Router,
            CONFIG.CHAIN_ID_ARBITRUM,
            TOKEN0.address, // UND
            TOKEN1.address, // USDC
            trade.dex_fee_standard,
            new bn(trade.amount).multipliedBy(10 ** baseToken.decimals).toFixed(), // amountIn
            new bn(trade.cexamtin + MIN_PROFIT).multipliedBy(10 ** quoteToken.decimals).toFixed(0), // amountOutMinimum
            0,
            trade.profit / trade.eth_price
        ).then(async (tx) => {
            cex_order = await trade.exchange_var.createOrder(CEX_SYMBOL, "market", "buy", trade.amount, trade.exchange_price);
            dex_order = tx;
        }).catch(err => {
            console.log(err);
            success = false;
        });
        if (!success) { return false; }

        console.log("cex_order:", cex_order.id);
        console.log("dex_order:", dex_order);
        dex_side = "sell";
        cex_amt = trade.cexamtin;
    } else {
        return false;
    }

    let log = {
        "cex_order": {
            id: cex_order.id,
            price: cex_order.price,
            cost: cex_order.cost,
            average: cex_order.average,
            side: cex_order.side,
            amount: cex_order.amount
        },
        "dex_order": {
            id: dex_order,
            side: dex_side
        },
        "expected_profit": trade.profit,
        "amount": trade.amount,
        "side": trade.side,
        "cexamt": cex_amt
    };
    console.log(log);
    fs.appendFile('./logs/dextrades.txt', JSON.stringify(log) + ",\n", (err) => { });
    return true;
}

// // run every 5 seconds
// setInterval(run, 5000);
run();
async function run() {

    try {
        // get dex reserves
        let dex_reserves = await get_dex_reserves();

        // initialize connection with exchanges
        let _exchanges = _initAndTestConnections();

        // fetch current trading fees from all exchanges
        var exchange_vars = [];
        _exchanges.forEach(async function (item, index) {
            let balance = await item.exchange.fetchBalance();
            exchange_vars.push({
                exchange_var: item.exchange,
                fee: await exchange.fetchTradingFee(item.exchange, CEX_SYMBOL),
                reserves0: balance[TOKEN0['symbol']]['free'] * RESERVES_MULT,
                reserves1: balance[TOKEN1['symbol']]['free'] * RESERVES_MULT,
                minamt: item.minamt,
                eth: await item.exchange.fetchTicker('ETH/USDC')
            });
        });

        // get pool_info
        var poolInfo = await univ3.getPoolInfo(undUsdcPool, baseToken, quoteToken);
        // init tickhandler
        var tickHandler = new TickHandler(TOKEN0.decimals - TOKEN1.decimals, poolInfo.tickSpacing);
        // convert price
        poolInfo['sqrtP'] = convert_price(poolInfo['sqrtPriceX96']);
        //validate current tick
        if (tickHandler._get_pool_tick_from_sqrt_price(poolInfo.sqrtP) != poolInfo.tick) {
            throw "could not validate current tick";
        }
        // set current tick on tickhandler
        tickHandler.set_current_tick_and_sqrt_price(poolInfo['sqrtP']);
        // populate liquidity in neighbouring ticks (see param NEIGHBOUR_DEPTH)
        poolInfo = await populate_neighbouring_liquidity(undUsdcPool, poolInfo, tickHandler);
        // convert liquidity to actual value
        poolInfo = convert_liquidity(poolInfo);

        var orderbook, result;
        // loop over exchanges to check for arb
        for (let _exchange of exchange_vars) {
            // query cex orderbook
            orderbook = await exchange.fetchOrderBook(_exchange.exchange_var, CEX_SYMBOL);

            // reserves
            reserves = {
                cex0: _exchange.reserves0,
                cex1: _exchange.reserves1,
                dex0: dex_reserves.reserves0,
                dex1: dex_reserves.reserves1
            };

            console.log("reserves:", reserves);

            // call algo
            result = walk_the_book_x(orderbook.bids, orderbook.asks, poolInfo, _exchange.fee['taker'], poolInfo.fee / 1e6, tickHandler, reserves = reserves);

            // if result is not null, arb found: break and trade
            if (result != null) {
                if (result.side == 'Bid') {
                    result['exchange_price'] = orderbook['bids'][0][0];
                } else {
                    result['exchange_price'] = orderbook['asks'][0][0];
                }
                console.log(result);
                
                // check minimum trade requirements
                if (result.amount * result.exchange_price < _exchange.minamt) continue;

                result.eth_price = (_exchange.eth['bid'] + _exchange.eth['ask']) / 2.0;
                result.dex_fee_standard = poolInfo.fee;
                result['exchange_var'] = _exchange.exchange_var;

                //arb found, make trade
                // make_cex_dex_trade(result);
                return;
            }
        }

    } catch (e) {
        console.log("error while initialization", e.toString());
        fs.appendFile('./logs/dexerrors.txt', Date.now() + " - error while initialization: " + e.toString() + ",\n", (err) => { });
    }

}

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
var kucoin, huobi, fees;
const SPACING = 200;
const NEIGHBOUR_DEPTH = 2;
const DELTA_DECIMAL = 12;
const AMT_PRECISION = 1;

var web3 = new Web3(new Web3.providers.HttpProvider(CONFIG.NETWORK_RPC_ARBITRUM));

const DEX_FEE = 0.01; // 1%
const DEX_FEE_STANDARD = 10000;

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
    symbol: "USDC "
};


const baseToken = new Token(CONFIG.CHAIN_ID_ARBITRUM, TOKEN0.address, TOKEN0.decimals, TOKEN0.symbol, TOKEN0.name);
const quoteToken = new Token(CONFIG.CHAIN_ID_ARBITRUM, TOKEN1.address, TOKEN1.decimals, TOKEN1.symbol, TOKEN1.name);

const undUsdcPool = new web3.eth.Contract(CONFIG.UNIV3_POOL_ABI, CONFIG.UNI_V3_POOL_ARBITRUM);
const uniswapV3Router = new web3.eth.Contract(CONFIG.UNIV3_ROUTER_ABI, CONFIG.UNIV3_ROUTER_ADDRESS);

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
    // huobi = new ccxt.huobi();

    kucoin.apiKey = process.env.KUCOIN_APIKEY;
    kucoin.secret = process.env.KUCOIN_SECRET;
    kucoin.password = process.env.KUCOIN_PASSWORD;

    // huobi.apiKey = process.env.HUOBI_APIKEY;
    // huobi.secret = process.env.HUOBI_SECRET;

    // test connection with exchange
    kucoin.checkRequiredCredentials();
    // huobi.checkRequiredCredentials();

    return [kucoin];
    // return [kucoin, huobi];
}

async function populate_neighbouring_liquidity(pool, pool_info, th) {
    var current_tick = th._current_tick;
    let liq = parseFloat(pool_info.liquidity);
    var liquidity = {};
    liquidity[current_tick] = liq;
    for (t = current_tick + 1; t <= current_tick + NEIGHBOUR_DEPTH; t++) {
        net_liq = await univ3.getPoolLiquidityNet(pool, t * SPACING);
        liq += parseFloat(net_liq);
        liquidity[t] = liq;
    }

    liq = parseFloat(pool_info.liquidity);
    for (t = current_tick - 1; t >= current_tick - NEIGHBOUR_DEPTH; t--) {
        net_liq = await univ3.getPoolLiquidityNet(pool, (t + 1) * SPACING);
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

    var cex_order, dex_order, dex_side, cex_amt;
    // buy on dex, sell on cex
    if (trade.side == "Bid" && trade.amount >= MIN_AMT && trade.profit >= MIN_PROFIT) {

        // execute sell transaction on cex first
        cex_order = await trade.exchange_var.createOrder('UNB/USDT', "market", "sell", trade.amount, trade.exchange_price);

        // execute buy transaction on uniswapv3
        dex_order = await web3Lib.swapExactOutputSingle(
            web3,
            uniswapV3Router,
            CONFIG.CHAIN_ID_ARBITRUM,
            TOKEN1.address, // USDC
            TOKEN0.address, // UND
            DEX_FEE_STANDARD,
            new bn(trade.amount).multipliedBy(1e18).toFixed(), // amountOut
            new bn(trade.cexamtout - MIN_PROFIT).multipliedBy(1e6).toFixed(0), //amountInMaximum -- FIX THIS??
            0
        );

        console.log("dex_order:", dex_order)

        dex_side = "buy";
        cex_amt = trade.cexamtout;
    }
    // sell on dex, buy on cex
    else if (trade.side = "Ask" && trade.amount >= MIN_AMT && trade.profit >= MIN_PROFIT) {

        // execute buy transaction on cex first
        cex_order = await trade.exchange_var.createOrder('UNB/USDT', "market", "buy", trade.amount, trade.exchange_price);

        // execute sell transaction on uniswapv3
        dex_order = await web3Lib.swapExactInputSingle(
            web3,
            uniswapV3Router,
            CONFIG.CHAIN_ID_ARBITRUM,
            TOKEN0.address, // UND
            TOKEN1.address, // USDC
            DEX_FEE_STANDARD,
            new bn(trade.amount).multipliedBy(1e18).toFixed(), // amountIn
            new bn(trade.cexamtin + MIN_PROFIT).multipliedBy(1e6).toFixed(0), // amountOutMinimum
            0
        );

        console.log("dex_order:", dex_order)

        dex_side = "sell";
        cex_amt = trade.cexamtin;
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
}

// // run every 5 seconds
// setInterval(run, 5000);
run();
async function run() {

    try {

        // initialize connection with exchanges
        let _exchanges = _initAndTestConnections();

        // fetch current trading fees from all exchanges
        var exchange_vars = [];
        _exchanges.forEach(async function (item, index) {
            exchange_vars.push({
                exchange_var: item,
                fee: await exchange.fetchTradingFee(item, 'UNB/USDT')
            });
        });

        // fees = {};
        // fees['kucoin'] = await exchange.fetchTradingFee(kucoin, 'UNB/USDT');
        // fees['huobi'] = await exchange.fetchTradingFee(huobi, 'UNB/USDT');

        // init tickhandler
        var tickHandler = new TickHandler(DELTA_DECIMAL, SPACING);
        // get pool_info
        var poolInfo = await univ3.getPoolInfo(undUsdcPool, baseToken, quoteToken);
        // convert price
        poolInfo['sqrtP'] = convert_price(poolInfo['sqrtPriceX96']);
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
            orderbook = await exchange.fetchOrderBook(_exchange.exchange_var, 'UNB/USDT');
            // call algo
            result = walk_the_book_x(orderbook.bids, orderbook.asks, poolInfo, _exchange.fee['taker'], DEX_FEE, tickHandler);

            // if result is not null, arb found: break and trade
            if (result != null) {
                if (result.side == 'Bid') {
                    result['exchange_price'] = orderbook['bids'][0][0];
                } else {
                    result['exchange_price'] = orderbook['asks'][0][0];
                }
                console.log(result);
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

var ccxt = require('ccxt')
var fs = require('fs');
var Web3 = require('web3');
require('dotenv').config();
var { tickToPrice } = require("@uniswap/v3-sdk")
var { Token } = require('@uniswap/sdk-core')
var JSBI = require("jsbi");
var bn = require('bignumber.js')
const { toFixed } = require('@thanpolas/crypto-utils');
const exchange = require('./utils/exchangeLib');
const web3Lib = require('./utils/web3');

const univ3 = require('./utils/uniswapV3Lib');
const CONFIG = require("./config/config")

const MIN_PROFIT = 0; // setiing minimum profit to 0% right now
var kucoin, huobi, fees;
const OFFSET = -124
const SPACING = 200
var web3 = new Web3(new Web3.providers.HttpProvider(CONFIG.NETWORK_RPC_ARBITRUM));

const DEX_FEE = 0.01; // 1%

const TOKEN0 = {
    address: "0xD5eBD23D5eb968c2efbA2B03F27Ee61718609A71",
    decimals: 18,
    name: "Unbound",
    symbol: "UNB"
}

const TOKEN1 = {
    address: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
    decimals: 6,
    name: "USD Coin (PoS)",
    symbol: "USDC "
}


const baseToken = new Token(CONFIG.CHAIN_ID_ARBITRUM, TOKEN0.address, TOKEN0.decimals, TOKEN0.symbol, TOKEN0.name)
const quoteToken = new Token(CONFIG.CHAIN_ID_ARBITRUM, TOKEN1.address, TOKEN1.decimals, TOKEN1.symbol, TOKEN1.name);

const undUsdcPool = new web3.eth.Contract(CONFIG.UNIV3_POOL_ABI, CONFIG.UNI_V3_POOL_ARBITRUM)
const uniswapV3Router = new web3.eth.Contract(CONFIG.UNIV3_ROUTER_ABI, CONFIG.UNIV3_ROUTER_ADDRESS)

// // run every 5 seconds
// setInterval(run, 5000);
run()
async function run() {

    try {

        // initialize connection with kucoin and huobi
        _initAndTestConnections();

        // fetch current trading fees from both exchanges
        fees = {};
        // fees['kucoin'] = await exchange.fetchTradingFee(kucoin, 'UNB/USDT');
        fees['huobi'] = await exchange.fetchTradingFee(huobi, 'UNB/USDT');


        let poolInfo = await univ3.getPoolInfo(undUsdcPool, baseToken, quoteToken);

        poolInfo = convert_pool_info(poolInfo)
        console.log(poolInfo)

        let huobiOrderBook = await exchange.fetchOrderBook(huobi, 'UNB/USDT')
        // console.log(kucoinOrderBook)

        let result = walk_the_book(huobiOrderBook.bids, huobiOrderBook.asks, poolInfo, fees['huobi']['taker'], DEX_FEE);
        console.log(result)

        result.amount = 5000;
        if(result == "None"){
            return;
        } else if(result.side == "Bid" && result.amount > 0){
            // buy on dex and sell on cex

            // execute sell transaction cex first -- needs to be tested
            let marketSell = await huobi.createOrder("UNB/USDT", "market", "sell", result.amount, huobiOrderBook['bids'][0][0]);

            // execute buy transaction on uniswapv3
            let buyTx = await web3Lib.swapExactOutputSingle(
                web3,
                uniswapV3Router,
                CONFIG.CHAIN_ID_ARBITRUM,
                TOKEN1.address, // USDC
                TOKEN0.address, // UND
                10000,
                new bn(result.amount).multipliedBy(1e18).toFixed(), // amountOut
                "9999999999999999999999999999999999999999", // TODO; slippage calcultaion to be added // amountInMaximum
                0
            )
            console.log({buyTx})


            let log = {
                makerExchange: "uniswapv3",
                takerExchange: "huobi",
                buyAmount: result.amount,
                marketSellPrice: huobiOrderBook['bids'][0][0],
                buyOrderId: buyTx,
                sellOrderId: marketSell.id,
                timestamp: Date.now(),
                finalProfit: result.profit
            }
            console.log(log)
            fs.appendFile('./logs/dextrades.txt', JSON.stringify(log) + ",\n", (err) => {});


        } else if(result.side == "Ask" && result.amount > 0){
            // buy on cex and sell on dex

            // execute buy transaction cex first -- needs to be tested
            let marketBuy = await huobi.createOrder("UNB/USDT", "market", "buy", result.amount, huobiOrderBook['asks'][0][0]);

            // execute sell transaction on uniswapv3
            let sellTx = await web3Lib.swapExactInputSingle(
                web3,
                uniswapV3Router,
                CONFIG.CHAIN_ID_ARBITRUM,
                TOKEN0.address, // UND
                TOKEN1.address, // USDC
                10000,
                new bn(result.amount).multipliedBy(1e18).toFixed(), // amountIn
                0, // amountOutMinimum - TODO; slippage calcultaion to be added
                0
            )
            console.log({sellTx})

            let log = {
                makerExchange: "huobi",
                takerExchange: "uniswapv3",
                buyAmount: result.amount,
                marketSellPrice: huobiOrderBook['asks'][0][0],
                buyOrderId: marketBuy.id,
                sellOrderId: sellTx,
                timestamp: Date.now(),
                finalProfit: result.profit
            }
            console.log(log)
            fs.appendFile('./logs/dextrades.txt', JSON.stringify(log) + ",\n", (err) => {});

        } else {
            return "None"
        }

    } catch (e) {
        console.log("error while initialization", e.toString());
        fs.appendFile('./logs/dexerrors.txt', Date.now() + " - error while initialization: " + e.toString() + ",\n", (err) => { })
    }

}

// Convert pool info into actual values
function convert_pool_info(pool_info) {
    pool_info['sqrtP'] = pool_info['sqrtPriceX96'] / (2 ** 96) * 1e6
    // pool_info['sqrtP'] = (pool_info['sqrtPriceX96'] >> 96) * 1e6 // This also works and is faster
    pool_info['L'] = pool_info['liquidity'] * 1e-12
    return pool_info
}

// Maximum amount we can buy on v3 while remaining within the same tick
function compute_xb(sqrtP, L) {
    var ic = Math.floor(((2 * Math.log(sqrtP) / Math.log(1.0001)) - OFFSET) / SPACING)
    return L * (1/sqrtP - 1.0001 ** (-(OFFSET + SPACING * (ic + 1)) / 2.0))
    // var ic = Math.floor(new bn(Math.log(sqrtP)).dividedBy(Math.log(1.0001)).multipliedBy(2).minus(OFFSET).dividedBy(SPACING).toFixed());
    // let ans = new bn(L)
    //     .multipliedBy(new bn(1).dividedBy(sqrtP).minus(new bn(1.0001).pow((new bn(OFFSET).plus(new bn(SPACING).multipliedBy(new bn(ic).plus(1)))).dividedBy(2).negated())))
    // return ans.toFixed(12);
}

// Maximum amount we can sell on v3 while remaining within the same tick
function compute_xs(sqrtP, L) {
    var ic = Math.floor(((2 * Math.log(sqrtP) / Math.log(1.0001)) - OFFSET) / SPACING)
    return L * (1.0001 ** (-(OFFSET + SPACING * ic)/2) - 1/sqrtP)
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

    function PnL(x, s, v, b){
        return (v + b * x) * (1-fc) - (s + x) * pool_info.sqrtP * pool_info.sqrtP * pool_info.L / (pool_info.L - (s+x) * pool_info.sqrtP) / (1-fd)
    }

    for(i=0; i<bids.length; i++){
        // Current bid, amt
        var b = bids[i][0]
        var q = bids[i][1]

        // argmax of PnL at the current bid (i.e., the function PnL above)
        var z = pool_info.L * (1/pool_info.sqrtP - 1/Math.sqrt(b * (1-fc) * (1-fd))) - s
        // var z = new bn(pool_info.L)
        //             .multipliedBy(new bn(1).dividedBy(pool_info.sqrtP).minus(new bn(1).dividedBy(new bn(b).multipliedBy(1-fc).multipliedBy(1-fd).squareRoot())))
        //             .minus(s).toFixed()
        // console.log({z})
        // If argmax <= 0, PnL can only decrease from here... return best PnL so far
        if (z <= 0){
            return {
                amount: Math.floor(s),
                profit: PnL(0, s, v, b),
                side: "Bid"
            }  
        } else if(z <= q || x <= q){
        // If argmax <= current amount, then found the maximum at s+z, return it
        // If x <= current amount, then at s+x, v3 hits the next tick. So return s+x...
            return {
                amount: Math.floor(s + Math.min(z, x)),
                profit: PnL(Math.min(z, x), s, v, b),
                side: "Bid"
            }  
        }

        // Update s, v, x
        s += q
        v += b * q
        x -= q
    }

    // If all the bids are exhausted, return the best PnL so far
    return {
        amount: Math.floor(s),
        profit: PnL(q, s, v, b),
        side: "Bid"
    } 
}

function ask_side_profit(asks, xs, pool_info, fc, fd) {
    var s = 0
    var v = 0 
    var x = Number(xs) / (1-fd)

    function PnL(x, s, v, a){
        return (s+x) * (1-fd) * pool_info.sqrtP * pool_info.sqrtP * pool_info.L / (pool_info.L + (s+x) * pool_info.sqrtP * (1-fd)) - (v + a*x)/(1-fc);
    }

    for(i=0; i<asks.length; i++){
        // Current ask, amt
        var a = Number(asks[i][0]);
        var q = Number(asks[i][1]);

        // argmax of PnL at the current ask (i.e., the function PnL above)
        var z = pool_info.L * (Math.sqrt((1-fc)/a) - 1 / pool_info.sqrtP / Math.sqrt(1-fd)) / Math.sqrt(1-fd) - s

        // var z = new bn(pool_info.L)
        //             .multipliedBy(new bn(1-fc).dividedBy(a).squareRoot().minus(new bn(1).dividedBy(pool_info.sqrtP).dividedBy(new bn(1-fd).squareRoot())))
        //             .dividedBy(new bn(1-fd).squareRoot().minus(s)).toFixed()
        console.log({z})
        // If argmax <= 0, PnL can only decrease from here... return best PnL so far
        if (z <= 0) {
            return {
                amount: Math.floor(s), 
                profit: PnL(0, s, v, a),
                side: "Ask"
            }
        } else if(z <= q || x <= q){
            // If argmax <= current amount, then found the maximum at s+z, return it
            // If x <= current amount, then at s+x, v3 hits the next tick. So return s+x...
            return {
                amount: Math.floor(s + Math.min(z, x)), 
                profit: PnL(Math.min(z, x), s, v, a),
                side: "Ask"
            }
        }
        // Update s, v, x
        s += q
        v += a * q
        x -= q
    
    }

    // If all the asks are exhausted, return the best PnL so far
    return {
        amount: Math.floor(s), 
        profit: PnL(q, s, v, a),
        side: "Ask"
    }

}

function walk_the_book(bids, asks, pool_info, fc, fd) {

    // let pDex = new bn(pool_info['sqrtP']).multipliedBy(pool_info['sqrtP']);
    let pCex = bids[0][0] * (1 - fc) * (1 - fd);
    
    // Condition for arb on the bid side - buy on dex, sell on cex
    // if (pDex.isLessThan(pCex)){
    if (pool_info['sqrtP'] * pool_info['sqrtP'] < bids[0][0] * (1 - fc) * (1 - fd)){
        // Maximum amt we can buy on dex
        var xb = compute_xb(pool_info.sqrtP, pool_info.L);
        return bid_side_profit(bids, xb, pool_info, fc, fd);
    }

    // Condition for arb on the ask side - cex buy, dex sell
    // if(new bn(pool_info['sqrtP']).multipliedBy(pool_info['sqrtP']).multipliedBy(1-fc).multipliedBy(1-fd).isGreaterThan(asks[0][0])){
    if(pool_info['sqrtP'] * pool_info['sqrtP'] * (1-fc) * (1-fd) > asks[0][0]){
        // Maximum amt we can buy on dex
        var xs = compute_xs(pool_info['sqrtP'], pool_info['L']);
        return ask_side_profit(asks, xs, pool_info, fc, fd)
    }

    return "None"
}

function _initAndTestConnections() {
    // kucoin = new ccxt.kucoin({ enableRateLimit: true });
    huobi = new ccxt.huobi();

    // kucoin.apiKey = process.env.KUCOIN_APIKEY
    // kucoin.secret = process.env.KUCOIN_SECRET
    // kucoin.password = process.env.KUCOIN_PASSWORD

    huobi.apiKey = process.env.HUOBI_APIKEY
    huobi.secret = process.env.HUOBI_SECRET

    // test connection with exchange
    // kucoin.checkRequiredCredentials();
    huobi.checkRequiredCredentials();
}
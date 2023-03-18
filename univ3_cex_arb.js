var ccxt = require('ccxt')
var fs = require('fs');
var Web3 = require('web3');
require('dotenv').config();
var { tickToPrice } = require("@uniswap/v3-sdk")
var { Token } = require('@uniswap/sdk-core')
var JSBI = require("jsbi");
// var bn = require('bignumber.js')
const { toFixed } = require('@thanpolas/crypto-utils');
const exchange = require('./utils/exchangeLib');

const univ3 = require('./utils/uniswapV3Lib');
const CONFIG = require("./config/config")

const MIN_PROFIT = 0; // setiing minimum profit to 0% right now
var kucoin, huobi, fees;
const OFFSET = -124
const SPACING = 200
var web3 = new Web3(new Web3.providers.HttpProvider(CONFIG.NETWORK_RPC_POLYGON));

const DEX_FEE = 0.003; // 0.3%

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


const baseToken = new Token(CONFIG.CHAIN_ID, TOKEN0.address, TOKEN0.decimals, TOKEN0.symbol, TOKEN0.name)
const quoteToken = new Token(CONFIG.CHAIN_ID, TOKEN1.address, TOKEN1.decimals, TOKEN1.symbol, TOKEN1.name);

const undUsdcPool = new web3.eth.Contract(CONFIG.UNIV3_POOL_ABI, CONFIG.UNI_V3_POOL_POLYGON)

// currentPrice.then(console.log)
async function run() {

    try {

        // initialize connection with kucoin and huobi
        _initAndTestConnections();

        // fetch current trading fees from both exchanges
        fees = {};
        fees['kucoin'] = await exchange.fetchTradingFee(kucoin, 'UNB/USDT');
        fees['huobi'] = await exchange.fetchTradingFee(huobi, 'UNB/USDT');


        let poolInfo = await univ3.getPoolInfo(undUsdcPool, baseToken, quoteToken);
        console.log(poolInfo)

        poolInfo = convert_pool_info(poolInfo)
        console.log(poolInfo)

        let kucoinOrderBook = await exchange.fetchOrderBook(kucoin, 'UNB/USDT')
        // console.log(kucoinOrderBook)

        walk_the_book(kucoinOrderBook.bids, kucoinOrderBook.asks, poolInfo, fees['kucoin']['taker'], DEX_FEE)
    } catch (e) {
        console.log("error while initialization", e.toString());
        fs.appendFile('./logs/errors.txt', Date.now() + " - error while initialization: " + e.toString() + ",\n", (err) => { })
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
                amount: s,
                profit: PnL(0, s, v, b),
                side: "Bid"
            }  
        } else if(z <= q || x <= q){
        // If argmax <= current amount, then found the maximum at s+z, return it
        // If x <= current amount, then at s+x, v3 hits the next tick. So return s+x...
            return {
                amount: s + Math.min(z, x),
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
        amount: s,
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
                amount: s, 
                profit: PnL(0, s, v, a),
                side: "Ask"
            }
        } else if(z <= q || x <= q){
            // If argmax <= current amount, then found the maximum at s+z, return it
            // If x <= current amount, then at s+x, v3 hits the next tick. So return s+x...
            return {
                amount: s + Math.min(z, x), 
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
        amount: s, 
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
// run()




let pool_info = {
    "liquidity": "46074077337994494",
    "sqrtPriceX96": "3669657940090553741802"
}

let cp = convert_pool_info(pool_info)

var bids = [['0.0019361', '6675.2261'], ['0.001936', '20300'], ['0.001935', '528283.6373'], ['0.0019348', '182.3188'], ['0.001934', '280742.6457'], ['0.0019336', '1606.7216'], ['0.0019328', '175.1456'], ['0.001931', '54200'], ['0.00193', '273213.7307'], ['0.0019282', '9660.858'], ['0.001928', '12981.8407'], ['0.0019276', '996.2641'], ['0.001926', '46900'], ['0.0019256', '339.0959'], ['0.001925', '52640.9628'], ['0.0019242', '587.2925'], ['0.001923', '237.6678'], ['0.001922', '125600'], ['0.0019216', '60.1759'], ['0.0019213', '193949.1082'], ['0.0019212', '194736.5951'], ['0.0019211', '250000'], ['0.001921', '11809.2747'], ['0.0019206', '770.4871'], ['0.00192', '292521.6383'], ['0.001919', '683.187'], ['0.0019187', '184.9107'], ['0.0019174', '389.1376'], ['0.001916', '277.4742'], ['0.0019157', '200.9877'], ['0.001915', '53184.3485'], ['0.0019139', '21951.0838'], ['0.0019136', '203.0238'], ['0.0019135', '101.4372'], ['0.0019134', '175.1456'], ['0.001911', '16400'], ['0.00191', '416297.4325'], ['0.0019096', '27726.6896'], ['0.0019095', '78.5545'], ['0.001909', '182.3188'], ['0.0019082', '671.5556'], ['0.001907', '10200'], ['0.0019061', '189391.9521'], ['0.001906', '259032.9081'], ['0.0019056', '210.8143'], ['0.0019054', '93.4592'], ['0.001905', '251927.7553'], ['0.001904', '257.7697'], ['0.001903', '415.0823'], ['0.0019025', '1010.6298'], ['0.0019021', '587.2925'], ['0.001902', '368.183'], ['0.0019001', '2058204.5093'], ['0.0019', '551990.0362'], ['0.0018998', '44227.7133'], ['0.0018981', '770.4871'], ['0.001897', '173.6779'], ['0.001896', '75.7857'], ['0.0018955', '9613.0701'], ['0.001894', '175.1456'], ['0.001891', '309.2747'], ['0.00189', '105666.8965'], ['0.0018889', '4311.7079'], ['0.001888', '202.4117'], ['0.0018872', '3862.1395'], ['0.0018865', '203.0238'], ['0.0018848', '184.9107'], ['0.0018845', '265.3224'], ['0.0018832', '182.3188'], ['0.001883', '448.4821'], ['0.0018817', '350.2425'], ['0.0018813', '2763288.6457'], ['0.0018812', '389.1376'], ['0.00188', '587.2925'], ['0.0018797', '671.5556'], ['0.001879', '101.4372'], ['0.0018777', '1025.087'], ['0.0018764', '1606.7216'], ['0.001876', '309.2747'], ['0.0018756', '770.4871'], ['0.0018746', '175.1456'], ['0.001874', '257.7697'], ['0.0018731', '610'], ['0.0018723', '8545.639'], ['0.001872', '536274.53'], ['0.001871', '337.5255'], ['0.001866', '181.9551'], ['0.001863', '920.8548'], ['0.001861', '309.2747'], ['0.0018604', '210.8143'], ['0.0018594', '203.0238'], ['0.0018592', '80.6776'], ['0.001859', '200.9877'], ['0.001858', '87.8932'], ['0.0018574', '182.3188'], ['0.0018552', '175.1456'], ['0.001855', '277.4742'], ['0.0018532', '1039.627'], ['0.0018531', '770.4871'], ['0.0018512', '671.5556']]
var asks = [['0.001951', '251.8376'], ['0.001963', '60.9724'], ['0.0019651', '66161.5552'], ['0.0019652', '671.5556'], ['0.0019656', '770.4871'], ['0.001966', '309.2747'], ['0.0019678', '203.0238'], ['0.0019684', '587.2925'], ['0.0019716', '175.1456'], ['0.0019734', '210.8143'], ['0.0019762', '80280'], ['0.0019788', '985.7698'], ['0.001981', '309.2747'], ['0.0019825', '101.4372'], ['0.001983', '237.6678'], ['0.001984', '2086.4959'], ['0.0019848', '60.1759'], ['0.0019864', '182.3188'], ['0.0019865', '184.9107'], ['0.0019881', '11349.1406'], ['0.0019898', '389.1376'], ['0.00199', '68.2873'], ['0.0019905', '587.2925'], ['0.0019908', '1606.7216'], ['0.001991', '175.1456'], ['0.001993', '3766.3444'], ['0.0019937', '671.5556'], ['0.001994', '507.2333'], ['0.0019949', '203.0238'], ['0.001996', '520.089'], ['0.002', '66250.9245'], ['0.002003', '237.6678'], ['0.0020032', '256628.0136'], ['0.0020033', '9367.4555'], ['0.0020049', '971.4173'], ['0.0020104', '175.1456'], ['0.0020106', '770.4871'], ['0.002011', '309.2747'], ['0.002012', '2167.0493'], ['0.0020122', '182.3188'], ['0.0020126', '587.2925'], ['0.0020164', '60.1759'], ['0.002017', '101.4372'], ['0.0020186', '210.8143'], ['0.0020194', '1606.7216'], ['0.0020204', '184.9107'], ['0.002022', '203.0238'], ['0.0020222', '671.5556'], ['0.0020225', '685.3659'], ['0.002023', '237.6678'], ['0.002024', '257.7697'], ['0.002026', '980.7135'], ['0.0020282', '337.1464'], ['0.0020291', '200.9877'], ['0.0020298', '175.1456'], ['0.002031', '683.187'], ['0.0020314', '960.766'], ['0.0020326', '93.4592'], ['0.0020331', '770.4871'], ['0.002034', '1928.4636'], ['0.0020347', '587.2925'], ['0.002035', '68.2873'], ['0.0020353', '1500.1471'], ['0.002038', '459.793'], ['0.002039', '177.4145'], ['0.00204', '2086.4959'], ['0.0020402', '9198.1698'], ['0.002041', '309.2747'], ['0.0020412', '210.8143'], ['0.0020425', '173.6779'], ['0.002043', '313.4535'], ['0.0020437', '3672.9639'], ['0.002044', '1175.679'], ['0.002047', '337.5255'], ['0.002048', '1666.8975'], ['0.0020491', '203.0238'], ['0.0020492', '175.1456'], ['0.0020507', '671.5556'], ['0.0020515', '101.4372'], ['0.002054', '257.7697'], ['0.0020543', '184.9107'], ['0.0020556', '770.4871'], ['0.0020559', '9127.6734'], ['0.002056', '309.2747'], ['0.0020568', '587.2925'], ['0.0020582', '946.4806'], ['0.00206', '1330.7186'], ['0.0020622', '389.1376'], ['0.002063', '237.6678'], ['0.0020638', '393.1331'], ['0.0020655', '685.3659'], ['0.0020672', '143.8038'], ['0.002068', '2167.0493'], ['0.0020686', '175.1456'], ['0.0020706', '1500.1471'], ['0.002071', '309.2747'], ['0.002075', '321.0337'], ['0.0020762', '203.0238'], ['0.0020766', '1606.7216'], ['0.0020781', '770.4871']]

console.log(walk_the_book(bids, asks, cp,  0.0002, 0.01))


function _initAndTestConnections() {
    kucoin = new ccxt.kucoin({ enableRateLimit: true });
    huobi = new ccxt.huobi();

    kucoin.apiKey = process.env.KUCOIN_APIKEY
    kucoin.secret = process.env.KUCOIN_SECRET
    kucoin.password = process.env.KUCOIN_PASSWORD

    huobi.apiKey = process.env.HUOBI_APIKEY
    huobi.secret = process.env.HUOBI_SECRET

    // test connection with exchange
    kucoin.checkRequiredCredentials();
    huobi.checkRequiredCredentials();
}
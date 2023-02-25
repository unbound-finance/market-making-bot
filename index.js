var ccxt = require ('ccxt')
var fs = require('fs');
const exchange = require('./utils/exchangeLib');
require('dotenv').config()

const MIN_PROFIT = 0; // setiing minimum profit to 0% right now
var kucoin, huobi, fees;

async function run(){
    try {
        // initialize connection with kucoin and huobi
        _initAndTestConnections();

        // fetch current trading fees from both exchanges
        fees = {};
        fees['kucoin'] = await exchange.fetchTradingFee(kucoin, 'UNB/USDT');
        fees['huobi'] = await exchange.fetchTradingFee(huobi, 'UNB/USDT');

        // query orderbook and execute arb if available every 5 seconds
        // watchForArbAndExecute()
        setInterval(watchForArbAndExecute, 6000);

    } catch(e){
        console.log("error while initialization", e.toString());
        fs.appendFile('./logs/errors.txt', Date.now() + " - error while initialization: "+ e.toString()+ ",\n", (err) => {})

    }
}

async function watchForArbAndExecute(){

    try {

        // console.time('totalExecutionTime')
        // console.time('kucoinQueryTime')
        
        let kucoinOrderBook = await exchange.fetchOrderBook(kucoin, 'UNB/USDT')

        // console.timeEnd('kucoinQueryTime')
        // console.time('huobiQueryTime')

        let huobiOrderBook = await exchange.fetchOrderBook(huobi, 'UNB/USDT')
        // console.timeEnd('huobiQueryTime')

        var difference = getDifference(kucoinOrderBook, huobiOrderBook);

        // console.log("=======================")
        // console.log(huobiOrderBook['asks'][0])
        // console.log(kucoinOrderBook['bids'])
        
        // console.log(kucoinOrderBook['asks'][0])
        // console.log(huobiOrderBook['bids'])   
        console.log(difference)

        if(difference.diff_BtoA > 0 && difference.diff_AtoB > 0){
            console.log("=====> No arb available");
            return;
        }

        if (difference.diff_BtoA < 0){
            // Buy from Exchange A(huobi), Sell to Exchange B(kucoin)
            console.log("Huobi to Kucoin");

            // let maxBuyAmount = Math.min(huobiOrderBook['asks'][0][1], kucoinOrderBook['bids'][0][1]);
            let maxBuyAmount = getOptiomalMaxBuyAmount(kucoinOrderBook['bids'], huobiOrderBook['asks'][0][1], huobiOrderBook['asks'][0][0]);

            let fee = (fees['huobi']['taker'] * maxBuyAmount * huobiOrderBook['asks'][0][0]) + (fees['kucoin']['taker'] * maxBuyAmount * kucoinOrderBook['bids'][0][0]);

            let profit = Math.abs(difference.diff_BtoA * maxBuyAmount);

            console.log({profit})
            console.log({fee})
            console.log({maxBuyAmount})

            if(profit - fee > MIN_PROFIT){
                console.log("final profit: ", profit - fee );

                // buy from huobi
                let marketBuy = await huobi.createOrder("UNB/USDT", "market", "buy", maxBuyAmount, huobiOrderBook['asks'][0][0]);

                // sell to kucoin
                let marketSell = await kucoin.createOrder("UNB/USDT", "market", "sell", maxBuyAmount);

                let log = {
                    makerExchange: "huobi",
                    takerExchange: "kucoin",
                    buyAmount: maxBuyAmount,
                    marketBuyPrice: huobiOrderBook['asks'][0][0],
                    marketSellPrice: kucoinOrderBook['bids'][0][0],
                    buyOrderId: marketBuy.id,
                    sellOrderId: marketSell.id,
                    timestamp: Date.now(),
                    finalProfit: profit - fee
                }
                console.log(log)
                fs.appendFile('./logs/trades.txt', JSON.stringify(log) + ",\n", (err) => {});

            } else {
                console.log("====> No profit after deducting fee");
            }
        } else if(difference.diff_AtoB < 0){
            // Buy from Exchange B(kucoin), Sell to Exchange A(huobi)
            console.log("Kucoin to Huobi");

            // let maxBuyAmount = Math.min(kucoinOrderBook['asks'][0][1], huobiOrderBook['bids'][0][1]);
            let maxBuyAmount = getOptiomalMaxBuyAmount(huobiOrderBook['bids'], kucoinOrderBook['asks'][0][1], kucoinOrderBook['asks'][0][0])

            let fee = (fees['kucoin']['taker'] * maxBuyAmount * kucoinOrderBook['asks'][0][0]) + (fees['huobi']['taker'] * maxBuyAmount * huobiOrderBook['bids'][0][0]);

            let profit = Math.abs(difference.diff_AtoB * maxBuyAmount);

            console.log({profit})
            console.log({fee})
            console.log({maxBuyAmount})

            if(profit - fee > MIN_PROFIT){
                console.log("final profit: ", profit - fee )

                // buy from kucoin
                let marketBuy = await kucoin.createOrder("UNB/USDT", "market", "buy", maxBuyAmount);

                // sell to huobi
                let marketSell = await huobi.createOrder("UNB/USDT", "market", "sell", maxBuyAmount, huobiOrderBook['bids'][0][0]);

                let log = {
                    makerExchange: "kucoin",
                    takerExchange: "huobi",
                    buyAmount: maxBuyAmount,
                    marketBuyPrice: kucoinOrderBook['asks'][0][0],
                    marketSellPrice: huobiOrderBook['bids'][0][0],
                    buyOrderId: marketBuy.id,
                    sellOrderId: marketSell.id,
                    timestamp: Date.now(),
                    finalProfit: profit - fee
                }
                console.log(log)
                fs.appendFile('./logs/trades.txt', JSON.stringify(log)+ ",\n", (err) => {});
            } else {
                console.log("====> No profit after deducting fee");
            }
        }

        // console.timeEnd('totalExecutionTime');

    } catch(e){
        console.log("arb error", e.toString())
        fs.appendFile('./logs/errors.txt', Date.now() + " - arb error: "+ e.toString()+ ",\n", (err) => {})
    }
}

function _initAndTestConnections(){
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

function getDifference(exchangeA, exchangeB){
    let diff_BtoA = exchangeB['asks'][0][0] - exchangeA['bids'][0][0];
    let diff_AtoB = exchangeA['asks'][0][0] - exchangeB['bids'][0][0];

    return{
        diff_BtoA,
        diff_AtoB
    }
}

run();

// calculate max buy amount based on taker exchange bid orders
function getOptiomalMaxBuyAmount(takerExchangebidOrders, targetMaxAmount, minSellPrice){

    let totalAmount = 0;

    for(i = 0; i <= takerExchangebidOrders.length; i++){

        // if bid order sell price is less then min sell price then return previous total amount
        if(takerExchangebidOrders[i][0] < minSellPrice){
            return totalAmount;
        }

        // if totalAmount and current order amount is greater then target maximum amount
        if(totalAmount + takerExchangebidOrders[i][1] > targetMaxAmount){

            // if order price is greater then min sell price then return maximum amount else return previous total amount
            if(takerExchangebidOrders[i][0] >= minSellPrice){
                return targetMaxAmount;
            } else {
                return totalAmount;
            }
        }

        totalAmount = totalAmount + takerExchangebidOrders[i][1];
    }
}
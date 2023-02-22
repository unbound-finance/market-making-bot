var ccxt = require ('ccxt')
const bn = require('bignumber.js');
require('dotenv').config()

const MIN_PROFIT = 0; // setiing minimum profit to 0% right now

async function run(){
    var kucoin = new ccxt.kucoin();
    var huobi = new ccxt.huobi();

    kucoin.apiKey = process.env.KUCOIN_APIKEY
    kucoin.secret = process.env.KUCOIN_SECRET
    kucoin.password = process.env.KUCOIN_PASSWORD

    huobi.apiKey = process.env.HUOBI_APIKEY
    huobi.secret = process.env.HUOBI_SECRET

    // test connection with exchange
    kucoin.checkRequiredCredentials();
    huobi.checkRequiredCredentials();

    var fees = {};
    fees['kucoin'] = await kucoin.fetchTradingFee('UNB/USDT')
    fees['huobi'] = await huobi.fetchTradingFee('UNB/USDT')
    
    console.time('totalExecutionTime')
    console.time('kucoinQueryTime')
    
    let kucoinOrderBook = await kucoin.fetchOrderBook ('UNB/USDT')

    console.timeEnd('kucoinQueryTime')
    console.time('huobiQueryTime')

    let huobiOrderBook = await huobi.fetchOrderBook ('UNB/USDT')

    console.timeEnd('huobiQueryTime')

    let kucoinBid = kucoinOrderBook['bids']
    let kucoinAsk = kucoinOrderBook['asks']

    let huobiBid = huobiOrderBook['bids']
    let huobiAsk = huobiOrderBook['asks']

    let diff_A = huobiAsk[0][0] - kucoinBid[0][0];
    let diff_B = kucoinAsk[0][0] - huobiBid[0][0];

    console.log("=======================")
    console.log(huobiAsk[0])
    console.log(kucoinBid[0])
    console.log({diff_A})
    
    console.log(kucoinAsk[0])
    console.log(huobiBid[0])   
    console.log({diff_B})
    if(diff_A > 0 && diff_B > 0){
        console.log("=====> No arb available");
        return;
    }

    if (diff_A < 0){
        // Buy from Exchange A(huobi), Sell to Exchange B(kucoin)
        console.log("Huobi to Kucoin");

        let maxBuyAmount = Math.min(huobiAsk[0][1], kucoinBid[0][1]);

        let fee = (fees['huobi']['taker'] * maxBuyAmount * huobiAsk[0][0]) + (fees['kucoin']['taker'] * maxBuyAmount * kucoinBid[0][0]);

        let profit = Math.abs(diff_A * maxBuyAmount);

        console.log({profit})
        console.log({fee})
        console.log({maxBuyAmount})

        if(profit - fee > MIN_PROFIT){
            console.log("final profit: ", profit - fee );

            // buy from huobi
            let marketBuy = await huobi.createOrder("UNB/USDT", "market", "buy", maxBuyAmount, huobiAsk[0][0]);
            console.log(marketBuy.id);

            // sell to kucoin
            let marketSell = await kucoin.createOrder("UNB/USDT", "market", "sell", maxBuyAmount);
            console.log(marketSell);
        }
    } else if(diff_B < 0){
        // Buy from Exchange B(kucoin), Sell to Exchange A(huobi)
        console.log("Kucoin to Huobi");

        let maxBuyAmount = Math.min(kucoinAsk[0][1], huobiBid[0][1]);

        let fee = (fees['kucoin']['taker'] * maxBuyAmount * kucoinAsk[0][0]) + (fees['huobi']['taker'] * maxBuyAmount * huobiBid[0][0]);

        let profit = Math.abs(diff_B * maxBuyAmount);

        console.log({profit})
        console.log({fee})
        console.log({maxBuyAmount})

        if(profit - fee > MIN_PROFIT){
            console.log("final profit: ", profit - fee )

            // // buy from kucoin
            let marketBuy = await kucoin.createOrder("UNB/USDT", "market", "buy", maxBuyAmount);
            console.log(`Bought ${maxBuyAmount} at market price`);

            // sell to huobi
            let marketSell = await huobi.createOrder("UNB/USDT", "market", "sell", maxBuyAmount, huobiBid[0][0]);
            console.log(`Sold ${maxBuyAmount} at price ${huobiBid[0][0]}`);
            
        }
    }

    console.timeEnd('totalExecutionTime')

}
run()
// setInterval(run, 5000);

exports.fetchTradingFee = async(exchange, symbol) => {
    let fees =  await exchange.fetchTradingFee(symbol);
    return fees;
}

exports.fetchOrderBook = async(exchange, symbol) => {
    let orderbook =  await exchange.fetchOrderBook(symbol);
    return orderbook;
}
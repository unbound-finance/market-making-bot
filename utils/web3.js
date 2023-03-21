var bn = require('bignumber.js')
const Tx = require('ethereumjs-tx')

var account = process.env.ADDRESS; // account address accociated with privateKey
var privateKey = Buffer.from(process.env.PRIVATE_KEY, 'hex') // without 0x

exports.swapExactInputSingle = async(web3, routerContractInstance, chainId, tokenIn, tokenOut, fee, amountIn, amountOutMinimum, sqrtPriceLimitX96) => {
    

    return new Promise(function(resolve, reject){
        const contractFunction = routerContractInstance.methods.exactInputSingle({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            recipient: account,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: sqrtPriceLimitX96,
        }).encodeABI();
        console.log(contractFunction)
        web3.eth.getGasPrice(function(err, gasPrice) {
            console.log({account})
            web3.eth.estimateGas({ from: account, to: routerContractInstance._address, data: contractFunction }, async function(err, gasAmount) {
                // console.log("estimate err: ", err.toString())
    
                if (err) {
                    console.log(err)
                    reject(err)
                    console.log("Something went wrong! <b>Gas required exceeds allowance or always failing transaction.</b>")
                } else {
    
                    gasPrice = Number(gasPrice) + (Number(gasPrice) / 10)
                    gasPrice = parseFloat(gasPrice).toFixed(0)
                    // console.log("GAS estimation: " + gasAmount)
                    // console.log("GAS PRICE: " + gasPrice)
                    // let cost = (new bn(gasPrice)).multipliedBy(gasAmount).toFixed()
                    // console.log("TX COST in wei: " + cost)
                    // console.log("TX COST in eth: " + web3.utils.fromWei(cost))
    
                    web3.eth.getTransactionCount(account, function(err2, _nonce) {
    
                        if (err2) {
                            reject(err2)
                        } else {
    
                            try {
                                _nonce = _nonce.toString(16);
    
                                const txParams = {
                                    gasPrice: web3.utils.toHex(gasPrice),
                                    gasLimit: web3.utils.toHex(gasAmount),
                                    to: routerContractInstance._address,
                                    data: contractFunction,
                                    from: account,
                                    nonce: '0x' + _nonce,
                                    chainId: chainId
                                };
    
                                // console.log(txParams)
                                const tx = new Tx(txParams);
                                tx.sign(privateKey); // Transaction Signing here
    
                                const serializedTx = tx.serialize();

                                web3.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'), async function(err3, txHash) {
                                    if (err3) {
                                        console.log(err3)
                                    } else {
                                        resolve(txHash)
                                    }
                                })
    
                            } catch (e) {
    
                                console.log(e);
                                reject(e)

                            }
    
                        }
                    })
    
                }
    
            })
    
        })


    })
}


exports.swapExactOutputSingle = async(web3, routerContractInstance, chainId, tokenIn, tokenOut, fee, amountOut, amountInMaximum, sqrtPriceLimitX96) => {
    

    return new Promise(function(resolve, reject){
        const contractFunction = routerContractInstance.methods.exactOutputSingle({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            recipient: account,
            amountOut: amountOut,
            amountInMaximum: amountInMaximum,
            sqrtPriceLimitX96: sqrtPriceLimitX96,
        }).encodeABI();
        console.log(contractFunction)
        web3.eth.getGasPrice(function(err, gasPrice) {
            console.log({account})
            web3.eth.estimateGas({ from: account, to: routerContractInstance._address, data: contractFunction }, async function(err, gasAmount) {
                // console.log("estimate err: ", err.toString())
    
                if (err) {
                    console.log(err)
                    reject(err)
                    console.log("Something went wrong! <b>Gas required exceeds allowance or always failing transaction.</b>")
                } else {
    
                    gasPrice = Number(gasPrice) + (Number(gasPrice) / 10)
                    gasPrice = parseFloat(gasPrice).toFixed(0)
                    // console.log("GAS estimation: " + gasAmount)
                    // console.log("GAS PRICE: " + gasPrice)
                    // let cost = (new bn(gasPrice)).multipliedBy(gasAmount).toFixed()
                    // console.log("TX COST in wei: " + cost)
                    // console.log("TX COST in eth: " + web3.utils.fromWei(cost))
    
                    web3.eth.getTransactionCount(account, function(err2, _nonce) {
    
                        if (err2) {
                            reject(err2)
                        } else {
    
                            try {
                                _nonce = _nonce.toString(16);
    
                                const txParams = {
                                    gasPrice: web3.utils.toHex(gasPrice),
                                    gasLimit: web3.utils.toHex(gasAmount),
                                    to: routerContractInstance._address,
                                    data: contractFunction,
                                    from: account,
                                    nonce: '0x' + _nonce,
                                    chainId: chainId
                                };
    
                                console.log(txParams)
                                const tx = new Tx(txParams);
                                tx.sign(privateKey); // Transaction Signing here
    
                                const serializedTx = tx.serialize();

                                web3.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'), async function(err3, txHash) {
                                    if (err3) {
                                        console.log(err3)
                                    } else {
                                        resolve(txHash)
                                    }
                                })
    
                            } catch (e) {
    
                                console.log(e);
                                reject(e)

                            }
    
                        }
                    })
    
                }
    
            })
    
        })


    })
}

exports.waitForConfirmation = async (web3, txHash) => {
    return new Promise(function(resolve, reject){
        let txCheck = setInterval(()=>{
            console.log('txcheck====')
            web3.eth.getTransactionReceipt(txHash, function(err, response){
                if(!err){
                    console.log(response ? "true" : "false")
                    if(response != null){
                        if(response.status == '0x0'){
                            clearInterval(txCheck)
                            resolve(false)
                        } else if(response.status == '0x1'){
                            clearInterval(txCheck)
                            resolve(true)
                        }
                    }
                }
            })
        }, 2000)
    })
}
const UNI_V3_POOL_POLYGON = "0xA42aB8b66655c5E9699EfFa7bE8bBA904Eeea61D";

const UNIV3_POOL_ABI = [{
    "inputs":[],
    "name":"slot0",
    "outputs":[{
        "internalType":"uint160",
        "name":"sqrtPriceX96",
        "type":"uint160"
      },
      {
        "internalType":"int24",
        "name":"tick",
        "type":"int24"
      },
      {
        "internalType":"uint16",
        "name":"observationIndex",
        "type":"uint16"
      },
      {
        "internalType":"uint16",
        "name":"observationCardinality",
        "type":"uint16"
      },
      {
        "internalType":"uint16",
        "name":"observationCardinalityNext",
        "type":"uint16"
      },
      {
        "internalType":"uint8",
        "name":"feeProtocol",
        "type":"uint8"
      },
      {
        "internalType":"bool",
        "name":"unlocked",
        "type":"bool"
      }],
    "stateMutability":"view",
    "type":"function"
    },
    {
      "inputs":[],
      "name":"tickSpacing",
      "outputs":[{
        "internalType":"int24",
        "name":"",
        "type":"int24"
      }],
      "stateMutability":"view",
      "type":"function"
    },
    {
      "inputs":[],
      "name":"fee",
      "outputs":[{
        "internalType":"uint24",
        "name":"",
        "type":"uint24"
      }],
      "stateMutability":"view",
      "type":"function"
      },
      {
        "inputs": [],
        "name": "liquidity",
        "outputs": [
          {
            "internalType": "uint128",
            "name": "",
            "type": "uint128"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      }]

const NETWORK_RPC_POLYGON = "https://polygon-rpc.com"
const CHAIN_ID = 137;

module.exports = {
    UNI_V3_POOL_POLYGON,
    UNIV3_POOL_ABI,
    NETWORK_RPC_POLYGON,
    CHAIN_ID
}
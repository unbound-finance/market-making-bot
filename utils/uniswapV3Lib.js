var JSBI = require("jsbi")
const invariant = require('invariant');
var { tickToPrice } = require("@uniswap/v3-sdk")
var { Price } = require('@uniswap/sdk-core')


// constants
const MIN_TICK = -887272;
const MAX_TICK = -MIN_TICK;

const ZERO = JSBI.BigInt(0);
const ONE = JSBI.BigInt(1);
const Q32 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(32));
const Q96 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(96));
const Q192 = JSBI.exponentiate(Q96, JSBI.BigInt(2));

const MaxUint256 = JSBI.BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
const RESOLUTION = JSBI.BigInt(96);


exports.getPoolLiquidityAndSqrt = async (pool, baseToken, quoteToken) => {

  var { sqrtPriceX96 } = await pool.methods.slot0().call();
  sqrtPriceX96 = sqrtPriceX96.toString()
  const liquidity = (await pool.methods.liquidity().call()).toString();

  return { liquidity, sqrtPriceX96 }
}

exports.getPoolInfo = async (pool, baseToken, quoteToken) => {

  const { tick, sqrtPriceX96 } = await pool.methods.slot0().call();
  const tickSpacing = await pool.methods.tickSpacing().call();
  const fee = await pool.methods.fee().call();
  const liquidity = await pool.methods.liquidity().call();

  var currentPrice = Number(tickToPrice(baseToken, quoteToken, Number(tick)).toSignificant(6)); // price of token0 in terms of token1

  const sqrtRatioX96 = JSBI.BigInt(sqrtPriceX96);

  currentPrice = (
    new Price(
      baseToken,
      quoteToken,
      Q192,
      JSBI.multiply(sqrtRatioX96, sqrtRatioX96)
    ).toSignificant(6)
  )
  return { currentPrice, fee, liquidity, tick, tickSpacing, sqrtPriceX96 }
}

/**
 * Calculates the amount of token0 and token1 given current sqrt price and a range.
 *
 * @param {JSBI|string} sqrtRatioX96 Current SQRT Price.
 * @param {JSBI|string} sqrtRatioAX96 A sqrt price representing the first tick boundary.
 * @param {JSBI|string} sqrtRatioBX96 A sqrt price representing the second tick boundary.
 * @param {JSBI|string} liquidityStr The liquidity being valued.
 * @return {Array<string>} A tuple with the reserves of token0 and token1.
 */
exports.getAmountsForLiquidityRange = (
    sqrtRatioX96,
    sqrtRatioAX96,
    sqrtRatioBX96,
    liquidityStr,
  ) => {
    const sqrtRatio = biConv(sqrtRatioX96);
    let sqrtRatioA = biConv(sqrtRatioAX96);
    let sqrtRatioB = biConv(sqrtRatioBX96);
    const liquidity = biConv(liquidityStr);
  
    if (JSBI.greaterThan(sqrtRatioA, sqrtRatioB)) {
      sqrtRatioA = sqrtRatioB;
      sqrtRatioB = sqrtRatioA;
    }
  
    let amount0 = 0;
    let amount1 = 0;
  
    if (JSBI.lessThanOrEqual(sqrtRatio, sqrtRatioA)) {
      amount0 = getAmount0ForLiquidity(sqrtRatioA, sqrtRatioB, liquidity);
    } else if (JSBI.lessThan(sqrtRatio, sqrtRatioB)) {
      amount0 = getAmount0ForLiquidity(sqrtRatio, sqrtRatioB, liquidity);
      amount1 = getAmount1ForLiquidity(sqrtRatioA, sqrtRatio, liquidity);
    } else {
      amount1 = getAmount1ForLiquidity(sqrtRatioA, sqrtRatioB, liquidity);
    }
  
    return [amount0, amount1];
};

/**
 * Calculates the tick local range (bottom and top) values given the tick and
 * spacing.
 *
 * @param {string} tickStr The tick value.
 * @param {string} tickSpacingStr The tick spacing value.
 * @param {number=} tickStep How many tick steps wide to capture liquidity.
 * @return {Array<number>} a tuple of the lower and highest tick local range.
 */
exports.tickRange = (tickStr, tickSpacingStr, tickStep = 0) => {
    const tick = Number(tickStr);
    const tickSpacing = Number(tickSpacingStr);
    
    const tickSpacingStepped = tickSpacing * tickStep;
    
    const tickLow =
        Math.floor(tick / tickSpacing) * tickSpacing - tickSpacingStepped;
    const tickHigh = tickLow + tickSpacing + tickSpacingStepped * 2;
    
    return [tickLow, tickHigh];
}

/**
 * Returns the sqrt ratio as a Q64.96 for the given tick. The sqrt ratio is
 * computed as sqrt(1.0001)^tick
 *
 * @param {string} tick the tick for which to compute the sqrt ratio.
 * @return {bigint} The SQRT value.
 */
exports.getSqrtRatioAtTick = (tick) => {
    invariant(
      tick >= MIN_TICK && tick <= MAX_TICK && Number.isInteger(tick),
      'TICK',
    );
    const absTick = tick < 0 ? tick * -1 : tick;
  
    let ratio =
      (absTick & 0x1) !== 0
        ? JSBI.BigInt('0xfffcb933bd6fad37aa2d162d1a594001')
        : JSBI.BigInt('0x100000000000000000000000000000000');
    if ((absTick & 0x2) !== 0) {
      ratio = mulShift(ratio, '0xfff97272373d413259a46990580e213a');
    }
    if ((absTick & 0x4) !== 0) {
      ratio = mulShift(ratio, '0xfff2e50f5f656932ef12357cf3c7fdcc');
    }
    if ((absTick & 0x8) !== 0) {
      ratio = mulShift(ratio, '0xffe5caca7e10e4e61c3624eaa0941cd0');
    }
    if ((absTick & 0x10) !== 0) {
      ratio = mulShift(ratio, '0xffcb9843d60f6159c9db58835c926644');
    }
    if ((absTick & 0x20) !== 0) {
      ratio = mulShift(ratio, '0xff973b41fa98c081472e6896dfb254c0');
    }
    if ((absTick & 0x40) !== 0) {
      ratio = mulShift(ratio, '0xff2ea16466c96a3843ec78b326b52861');
    }
    if ((absTick & 0x80) !== 0) {
      ratio = mulShift(ratio, '0xfe5dee046a99a2a811c461f1969c3053');
    }
    if ((absTick & 0x100) !== 0) {
      ratio = mulShift(ratio, '0xfcbe86c7900a88aedcffc83b479aa3a4');
    }
    if ((absTick & 0x200) !== 0) {
      ratio = mulShift(ratio, '0xf987a7253ac413176f2b074cf7815e54');
    }
    if ((absTick & 0x400) !== 0) {
      ratio = mulShift(ratio, '0xf3392b0822b70005940c7a398e4b70f3');
    }
    if ((absTick & 0x800) !== 0) {
      ratio = mulShift(ratio, '0xe7159475a2c29b7443b29c7fa6e889d9');
    }
    if ((absTick & 0x1000) !== 0) {
      ratio = mulShift(ratio, '0xd097f3bdfd2022b8845ad8f792aa5825');
    }
    if ((absTick & 0x2000) !== 0) {
      ratio = mulShift(ratio, '0xa9f746462d870fdf8a65dc1f90e061e5');
    }
    if ((absTick & 0x4000) !== 0) {
      ratio = mulShift(ratio, '0x70d869a156d2a1b890bb3df62baf32f7');
    }
    if ((absTick & 0x8000) !== 0) {
      ratio = mulShift(ratio, '0x31be135f97d08fd981231505542fcfa6');
    }
    if ((absTick & 0x10000) !== 0) {
      ratio = mulShift(ratio, '0x9aa508b5b7a84e1c677de54f3e99bc9');
    }
    if ((absTick & 0x20000) !== 0) {
      ratio = mulShift(ratio, '0x5d6af8dedb81196699c329225ee604');
    }
    if ((absTick & 0x40000) !== 0) {
      ratio = mulShift(ratio, '0x2216e584f5fa1ea926041bedfe98');
    }
    if ((absTick & 0x80000) !== 0) {
      ratio = mulShift(ratio, '0x48a170391f7dc42444e8fa2');
    }
  
    if (tick > 0) {
      ratio = JSBI.divide(MaxUint256, ratio);
    }
  
    // back to Q96
    const result = JSBI.greaterThan(JSBI.remainder(ratio, Q32), ZERO)
      ? JSBI.add(JSBI.divide(ratio, Q32), ONE)
      : JSBI.divide(ratio, Q32);
  
    return result;
};


/**
 * Computes the amount of token0 for a given amount of liquidity and a price range.
 *
 * @param {bigint} sqrtRatioAX96 A sqrt price representing the first tick boundary.
 * @param {bigint} sqrtRatioBX96 A sqrt price representing the second tick boundary.
 * @param {bigint} liquidity The liquidity being valued.
 * @return {number} The amount of token0.
 */
function getAmount0ForLiquidity (sqrtRatioAX96, sqrtRatioBX96, liquidity) {
    let sqrtRatioA = sqrtRatioAX96;
    let sqrtRatioB = sqrtRatioBX96;
  
    if (JSBI.greaterThan(sqrtRatioA, sqrtRatioB)) {
      sqrtRatioA = sqrtRatioB;
      sqrtRatioB = sqrtRatioA;
    }
  
    const leftShiftedLiquidity = JSBI.leftShift(liquidity, RESOLUTION);
    const sqrtDiff = JSBI.subtract(sqrtRatioB, sqrtRatioA);
    const multipliedRes = JSBI.multiply(leftShiftedLiquidity, sqrtDiff);
    const numerator = JSBI.divide(multipliedRes, sqrtRatioB);
  
    const amount0 = JSBI.divide(numerator, sqrtRatioA);
  
    return amount0;
  };
  
  /**
   * Computes the amount of token1 for a given amount of liquidity and a price range.
   *
   * @param {bigint} sqrtRatioAX96 A sqrt price representing the first tick boundary.
   * @param {bigint} sqrtRatioBX96 A sqrt price representing the second tick boundary.
   * @param {bigint} liquidity The liquidity being valued.
   * @return {number} The amount of token1.
   */
  function getAmount1ForLiquidity (sqrtRatioAX96, sqrtRatioBX96, liquidity) {
    let sqrtRatioA = sqrtRatioAX96;
    let sqrtRatioB = sqrtRatioBX96;
  
    if (JSBI.greaterThan(sqrtRatioA, sqrtRatioB)) {
      sqrtRatioA = sqrtRatioB;
      sqrtRatioB = sqrtRatioA;
    }
  
    const sqrtDiff = JSBI.subtract(sqrtRatioB, sqrtRatioA);
    const multipliedRes = JSBI.multiply(liquidity, sqrtDiff);
  
    const amount1 = JSBI.divide(multipliedRes, Q96);
  
    return amount1;
  };
  

/**
 * Multiplies and right shifts.
 *
 * @param {bigint} val The multiplier.
 * @param {string} mulBy Multiply by.
 * @return {bigint}
 */
function mulShift (val, mulBy) {
    return JSBI.signedRightShift(
      JSBI.multiply(val, JSBI.BigInt(mulBy)),
      JSBI.BigInt(128),
    );
}

/**
 * Converts a value to JSBI, if it's already a JSBI will just return it.
 *
 * @param {string|number|JSBI} numstr The value to convert.
 * @return {bigint} JSBI representation of the value.
 */
function biConv(numstr) {
    let bi = numstr;
    if (typeof sqrtRatio !== 'bigint') {
      bi = JSBI.BigInt(numstr);
    }
    return bi;
};
  
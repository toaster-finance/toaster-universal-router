import { ethers } from "hardhat";
import { TickMath } from "./TickMath";
import { SqrtPriceMath } from "./SqrtPriceMath";
import { LiquidityAmounts } from "./LiqudityAmounts";
interface IGetMakingAmount {
  tickLower: bigint;
  tickUpper: bigint;
  token0: string;
  token1: string;
  fee: bigint;
  factoryAddr: string;
  amount0Desired: bigint;
  amount1Desired: bigint;
}

export const getMakingAmount = async (params: IGetMakingAmount): Promise<{ isMakingZero: boolean, makingAmount: bigint, estimateTakingAmount: bigint }> => {
    const {
        tickLower,
        tickUpper,
        token0,
        token1,
        fee,
        factoryAddr,
        amount0Desired,
        amount1Desired,
    } = params;
    const factory = await ethers.getContractAt("IUniswapV3Factory", factoryAddr);
    const poolAddr = await factory.getPool(token0, token1, fee);
    const pool = await ethers.getContractAt("IUniswapV3PoolState",poolAddr);
    // const exchangeRate = token1Price / token0Price;
    const sqrtPriceCX96 = await pool.slot0().then((slot0) => slot0.sqrtPriceX96.toBigInt());
    if (token0 > token1) throw new Error("token0 must be less than token1");
    const sqrtPriceUX96 = TickMath.getSqrtRatioAtTick(tickUpper);
    const sqrtPriceLX96 = TickMath.getSqrtRatioAtTick(tickLower);
    const _liquidity0 = LiquidityAmounts.getLiquidityForAmount0(sqrtPriceCX96,sqrtPriceUX96,amount0Desired);
    const _liquidity1 = LiquidityAmounts.getLiquidityForAmount1(sqrtPriceLX96,sqrtPriceCX96,amount1Desired);
    const optimalAmount0 = SqrtPriceMath.getAmount0Delta(sqrtPriceCX96, sqrtPriceUX96, ethers.constants.MaxUint256.toBigInt(), true);
    const optimalAmount1 = SqrtPriceMath.getAmount1Delta(sqrtPriceLX96, sqrtPriceCX96, ethers.constants.MaxUint256.toBigInt(), true);

    // sqrtPriceCX96 = token1 amount / token0 amount = toke0 price / token1 price = (sqrtPriceCX96 ** 2n) / 2 ** 192n
    if (_liquidity0 > _liquidity1) {
        // taking amount / making amount = token1 price / token0 price 
        const isMakingZero = true;
        
        if((sqrtPriceCX96 ** 2n) >> 192n != 0n) {
            // exchangeRate = ( token1 amount ) / (token0 amount) = sqrtPriceCX96 ** 2n / 2 ** 192n
            const exchangeRate = ((sqrtPriceCX96 ** 2n) / (2n**96n))**2n;
            const makingAmount = (amount0Desired * optimalAmount1 - amount1Desired * optimalAmount0) / (optimalAmount1 + optimalAmount0 * exchangeRate);
            const estimateTakingAmount = makingAmount * exchangeRate;
            return { isMakingZero, makingAmount, estimateTakingAmount };
        } else {
            // exchangeRate = (token0 amount) / (token1 amount) = 2 ** 192n / sqrtPriceCX96 ** 2n
            const exchangeRate = ((2n**96n) / sqrtPriceCX96) ** 2n;
            const makingAmount = (amount0Desired * optimalAmount1 - amount1Desired * optimalAmount0) * exchangeRate / (optimalAmount0 + optimalAmount1 * exchangeRate);
            const estimateTakingAmount = makingAmount / exchangeRate;
            return { isMakingZero, makingAmount, estimateTakingAmount };
        }
    } else {
        const isMakingZero = false;
        if ((sqrtPriceCX96 ** 2n) >> 192n != 0n) {
          // exchangeRate = ( token1 amount ) / (token0 amount) = sqrtPriceCX96 ** 2n / 2 ** 192n
            const exchangeRate = (sqrtPriceCX96 ** 2n / 2n ** 96n) ** 2n;
            const makingAmount = (optimalAmount0 * amount1Desired - optimalAmount1 * amount0Desired) * exchangeRate / (optimalAmount1 + optimalAmount0 * exchangeRate);
            const estimateTakingAmount = makingAmount / exchangeRate;
          return { isMakingZero, makingAmount, estimateTakingAmount };
        } else {
          // exchangeRate = (token0 amount) / (token1 amount) = 2 ** 192n / sqrtPriceCX96 ** 2n
            const exchangeRate = (2n ** 96n / sqrtPriceCX96) ** 2n;
            const makingAmount = (amount1Desired * optimalAmount0 - amount0Desired * optimalAmount1) / (optimalAmount0 + optimalAmount1 * exchangeRate);
            const estimateTakingAmount = makingAmount * exchangeRate;
          
          return { isMakingZero, makingAmount, estimateTakingAmount };
        }
    }
  
}
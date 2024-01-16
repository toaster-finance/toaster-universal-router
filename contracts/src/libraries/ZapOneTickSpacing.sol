// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IUniswapV3PoolState} from "../../external/uniswapv3/IUniswapV3PoolState.sol";
import {IUniswapV3PoolImmutables} from "../../external/uniswapv3/IUniswapV3PoolImmutables.sol";
import {IUniswapV3PoolActions} from "../../external/uniswapv3/IUniswapV3PoolActions.sol";
import {IUniswapV3Factory} from "../../external/uniswapv3/IUniswapV3Factory.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "../../external/uniswapv3/libraries/TickMath.sol";
import {LiquidityAmounts} from "../../external/uniswapv3/libraries/LiquidityAmounts.sol";
import {IUniV3FusionToaster} from "../interfaces/IUniV3FusionToaster.sol";

library ZapOneTickSpacing {
    using SafeCast for uint256;
    uint256 constant Q96 = 1 << 96;
    uint256 internal constant MAX_FEE_PIPS = 1e6;
    error InvalidToken();
    error InvalidPool();
    function zapOnOneTickSpacing(IUniV3FusionToaster.ActualAmountCache memory cache,IUniswapV3Factory factory, address token0,address token1,uint24 feePips) internal {
        // L0 > L1, swap token0 to token1
        // swap to next tick(target price)
        (bool isZeroForOne,uint160 sqrtPriceX96Next,address pool) = nextOptimalPriceOnOneTickSpacing(factory,cache.amount0In,cache.amount1In,token0,token1,feePips);
        if(isZeroForOne) {
            (int256 amount0In, int256 amount1Out) = IUniswapV3PoolActions(pool).swap(
                address(this),
                true,
                SafeCast.toInt256(cache.amount0In),
                uint160(sqrtPriceX96Next),
                abi.encode(token0,token1,feePips)
            );
            cache.amount0In = cache.amount0In - uint256(-amount0In);
            cache.amount1In = cache.amount1In + uint256(amount1Out);
        } else {
        // L0 < L1, swap token1 to token0
        // swap to next tick(target price)
            (int256 amount0Out, int256 amount1In) = IUniswapV3PoolActions(pool).swap(
                address(this),
                false,
                SafeCast.toInt256(cache.amount1In),
                uint160(sqrtPriceX96Next),
                abi.encode(token1,token0,feePips)
            );
            cache.amount0In = cache.amount0In + uint256(amount0Out);
            cache.amount1In = cache.amount1In - uint256(-amount1In);
        }
       
    }
    struct Coefficients {
        uint256 t;
        uint256 t0;
        uint256 t1;
        uint256 a;
        uint256 b;
        uint256 c;

    }
    function nextOptimalPriceOnOneTickSpacing(IUniswapV3Factory factory, uint256 amount0In, uint256 amount1In, address token0,address token1,uint24 feePips) internal view returns(bool isZeroForOne,uint160 sqrtOptimalPriceX96, address pool) {
        if(token0 >= token1) revert InvalidToken();
        pool =factory.getPool(token0,token1,feePips);
        if(pool == address(0)) revert InvalidPool();
        uint160 sqrtPriceX96U;
        uint160 sqrtPriceX96L;
        uint160 sqrtPriceX96;
        uint128 liquidity;
        {
            int24 tick;
            (sqrtPriceX96,tick,,,,,) =IUniswapV3PoolState(pool).slot0();
            (liquidity)=IUniswapV3PoolState(pool).liquidity();
            {
                int24 tickSpacing = IUniswapV3PoolImmutables(pool).tickSpacing();
                int24 upperTick = tick + tickSpacing - (tick % tickSpacing);
                int24 lowerTick = upperTick - tickSpacing;
                sqrtPriceX96U= TickMath.getSqrtRatioAtTick(upperTick);
                sqrtPriceX96L= TickMath.getSqrtRatioAtTick(lowerTick);
            }
        }
        // find swap direction and next tick
        isZeroForOne = LiquidityAmounts.getLiquidityForAmount0(sqrtPriceX96, sqrtPriceX96U, amount0In) > LiquidityAmounts.getLiquidityForAmount1(sqrtPriceX96L, sqrtPriceX96, amount1In);

        Coefficients memory coefficients;
        if(isZeroForOne) {
            // t = L / (1-feePips)
            coefficients.t = 1e6 * liquidity / (1e6 - feePips);
            // t0 = A0 + t / sqrt(P) 
            coefficients.t0 = amount0In + Math.mulDiv(coefficients.t, Q96, sqrtPriceX96);
            // t1 = A1 + L * sqrt(P)
            coefficients.t1 = amount1In + Math.mulDiv(liquidity, sqrtPriceX96, Q96);
            // a = t0 - L / sqrt(Pu)
            coefficients.a = coefficients.t0 - Math.mulDiv(liquidity, Q96, sqrtPriceX96U);
            // c = t1 - (t * sqrt(Pl))
            coefficients.c = coefficients.t1 - Math.mulDiv(coefficients.t, Q96, sqrtPriceX96L);
            // b = sqrt(Pl) * t0 + feePips * t - t1/ sqrt(Pu)
            coefficients.b = Math.mulDiv(sqrtPriceX96L, coefficients.t0, Q96) + feePips * coefficients.t - Math.mulDiv(coefficients.t1, Q96, sqrtPriceX96U);

            unchecked {
                coefficients.a = coefficients.a << 1;
                coefficients.c = coefficients.c << 1;
                uint256 numerator = Math.sqrt(coefficients.b * coefficients.b + coefficients.a * coefficients.c) + coefficients.b;
                sqrtOptimalPriceX96 = Math.mulDiv(numerator,Q96,coefficients.a).toUint160(); 
            }
        } else {
            // t = L / (1-feePips)
            coefficients.t = 1e6 * liquidity / (1e6 - feePips);
            // t0 = A0 + L / sqrt(P)
            coefficients.t0 = amount0In + Math.mulDiv(liquidity, Q96, sqrtPriceX96);
            // t1 = A1 + t * sqrt(P)
            coefficients.t1 = amount1In + Math.mulDiv(coefficients.t, Q96, sqrtPriceX96);
            // a = t0 -  t / sqrt(Pu) 
            coefficients.a = coefficients.t0 - Math.mulDiv(coefficients.t, Q96, sqrtPriceX96U);
            // c = t1 - (L * sqrt(Pl))
            coefficients.c = coefficients.t1 - Math.mulDiv(liquidity, Q96, sqrtPriceX96L);
            // b = sqrt(Pl) * t0 - feePips * t - t1 / sqrt(Pu)
            coefficients.b = Math.mulDiv(sqrtPriceX96L, coefficients.t0, Q96) - feePips * coefficients.t - Math.mulDiv(coefficients.t1, Q96, sqrtPriceX96U);
            unchecked {
                coefficients.a = coefficients.a << 1;
                coefficients.c = coefficients.c << 1;
                uint256 numerator = Math.sqrt(coefficients.b * coefficients.b + coefficients.a * coefficients.c) + coefficients.b;
                sqrtOptimalPriceX96 = Math.mulDiv(numerator,Q96,coefficients.a).toUint160(); 
            }
        }

    }
}
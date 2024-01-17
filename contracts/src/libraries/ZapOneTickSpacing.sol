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
import "hardhat/console.sol";
library ZapOneTickSpacing {
    using Math for uint256;
    using SafeCast for uint256;
    using SafeCast for int24;
    using SafeCast for int24;
    uint256 constant Q96 = 1 << 96;
    uint256 internal constant MAX_FEE_PIPS = 1e6;
    error InvalidToken();
    error InvalidPool();
    function zapOnOneTickSpacing(IUniV3FusionToaster.ActualAmountCache memory cache,IUniswapV3Factory factory,uint24 feePips) internal {
        
        // L0 > L1, swap token0 to token1
        // L0 < L1, swap token1 to token0
        // swap to next tick(target price)
        (bool isZeroForOne,uint160 sqrtPriceX96Next,address pool) = nextOptimalPriceOnOneTickSpacing(factory,cache.amount0In,cache.amount1In,cache.token0,cache.token1,feePips);
        (int256 amount0Delta, int256 amount1Delta) = IUniswapV3PoolActions(pool).swap(
                address(this),
                isZeroForOne,
                SafeCast.toInt256(cache.amount0In),
                uint160(sqrtPriceX96Next),
                abi.encode(cache.token0,cache.token1,feePips)
        );
        unchecked {
            (cache.amount0In,cache.amount1In) = isZeroForOne ? 
                (cache.amount0In - uint256(-amount0Delta),cache.amount1In + uint256(amount1Delta)) 
                : (cache.amount0In + uint256(amount0Delta),cache.amount1In - uint256(-amount1Delta));
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
    struct SwapState {
        // liquidity in range after swap, accessible by `mload(state)`
        uint128 liquidity;
        // sqrt(price) after swap, accessible by `mload(add(state, 0x20))`
        uint256 sqrtPriceX96;
        // tick after swap, accessible by `mload(add(state, 0x40))`
        int24 tick;
        // The desired amount of token0 to add liquidity, `mload(add(state, 0x60))`
        uint256 amount0Desired;
        // The desired amount of token1 to add liquidity, `mload(add(state, 0x80))`
        uint256 amount1Desired;
        // sqrt(price) at the lower tick, `mload(add(state, 0xa0))`
        uint256 sqrtRatioLowerX96;
        // sqrt(price) at the upper tick, `mload(add(state, 0xc0))`
        uint256 sqrtRatioUpperX96;
        // the fee taken from the input amount, expressed in hundredths of a bip
        // accessible by `mload(add(state, 0xe0))`
        uint256 feePips;
        // the tick spacing of the pool, accessible by `mload(add(state, 0x100))`
        int24 tickSpacing;
    }
    function nextOptimalPriceOnOneTickSpacing(IUniswapV3Factory factory, uint256 amount0In, uint256 amount1In, address token0,address token1,uint24 feePips) private view returns(bool isZeroForOne,uint160 sqrtPriceOptimalX96, address pool) {
        
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
                int24 upperTick = tick > 0 ? (tick + tickSpacing - (tick % tickSpacing)) : (tick - (tick % tickSpacing));
                int24 lowerTick = upperTick - tickSpacing;
                sqrtPriceX96U= TickMath.getSqrtRatioAtTick(upperTick);
                sqrtPriceX96L= TickMath.getSqrtRatioAtTick(lowerTick);
            }
        }
        
        // // find swap direction and next tick
        isZeroForOne = LiquidityAmounts.getLiquidityForAmount0(sqrtPriceX96, sqrtPriceX96U, amount0In) > LiquidityAmounts.getLiquidityForAmount1(sqrtPriceX96L, sqrtPriceX96, amount1In);
        SwapState memory state = SwapState({
                liquidity: liquidity,
                sqrtPriceX96: sqrtPriceX96,
                tick: TickMath.getTickAtSqrtRatio(sqrtPriceX96),
                amount0Desired: amount0In,
                amount1Desired: amount1In,
                sqrtRatioLowerX96: sqrtPriceX96L,
                sqrtRatioUpperX96: sqrtPriceX96U,
                feePips: feePips,
                tickSpacing: IUniswapV3PoolImmutables(pool).tickSpacing()
        });
        sqrtPriceOptimalX96 = isZeroForOne ? solveOptimalZeroForOne(state) : solveOptimalOneForZero(state);
        
        // Coefficients memory coefficients;
        // if(isZeroForOne) {
        //     // t = L / (1-feePips)
        //     coefficients.t = 1e6 * liquidity / (1e6 - feePips);
        //     // t0 = A0 + t / sqrt(P) 
        //     coefficients.t0 = amount0In + Math.mulDiv(coefficients.t, Q96, sqrtPriceX96);
        //     // t1 = A1 + L * sqrt(P)
        //     coefficients.t1 = amount1In + Math.mulDiv(liquidity, sqrtPriceX96, Q96);
        //     // a = t0 - L / sqrt(Pu)
        //     coefficients.a = coefficients.t0 - Math.mulDiv(liquidity, Q96, sqrtPriceX96U);
        //     // c = t1 - (t * sqrt(Pl))
        //     coefficients.c = Math.mulDiv(coefficients.t, Q96, sqrtPriceX96L) - coefficients.t1;
        //     // b = sqrt(Pl) * t0 + feePips * t - t1/ sqrt(Pu)
        //     coefficients.b = Math.mulDiv(sqrtPriceX96L, coefficients.t0, Q96) + Math.mulDiv(feePips, coefficients.t, 1e6)- Math.mulDiv(coefficients.t1, Q96, sqrtPriceX96U);

        //     unchecked {
        //         uint256 numerator = Math.sqrt(coefficients.b * coefficients.b - 4 * coefficients.a * coefficients.c) - coefficients.b;
        //         sqrtPriceOptimalX96 = Math.mulDiv(numerator,Q96,coefficients.a).toUint160(); 
        //     }
        //     sqrtPriceOptimalX96 = (sqrtPriceOptimalX96 > sqrtPriceX96 ? (sqrtPriceOptimalX96 < sqrtPriceX96L ? sqrtPriceX96L : sqrtPriceOptimalX96 ): (sqrtPriceX96));
            
        // } else {
        //     // t = L / (1-feePips)
        //     coefficients.t = 1e6 * liquidity / (1e6 - feePips);
        //     // t0 = A0 + L / sqrt(P)
        //     coefficients.t0 = amount0In + Math.mulDiv(liquidity, Q96, sqrtPriceX96);
        //     // t1 = A1 + t * sqrt(P)
        //     coefficients.t1 = amount1In + Math.mulDiv(coefficients.t, Q96, sqrtPriceX96);
        //     // a = t0 -  t / sqrt(Pu) 
        //     coefficients.a = coefficients.t0 - Math.mulDiv(coefficients.t, Q96, sqrtPriceX96U);
        //     // c = (L * sqrt(Pl)) -  t1
        //     coefficients.c = Math.mulDiv(liquidity, Q96, sqrtPriceX96L) - coefficients.t1;
        //     // b = sqrt(Pl) * t0 - feePips * t - t1 / sqrt(Pu)
        //     coefficients.b = Math.mulDiv(sqrtPriceX96L, coefficients.t0, Q96) - Math.mulDiv(feePips, coefficients.t, 1e6)- Math.mulDiv(coefficients.t1, Q96, sqrtPriceX96U);
        //     unchecked {
        //         uint256 numerator = Math.sqrt(coefficients.b * coefficients.b - 4 * coefficients.a * coefficients.c) - coefficients.b;
        //         sqrtPriceOptimalX96 = Math.mulDiv(numerator,Q96,coefficients.a).toUint160(); 
        //     }
        //     sqrtPriceOptimalX96 = (sqrtPriceOptimalX96 > sqrtPriceX96 ? (sqrtPriceOptimalX96 > sqrtPriceX96U ? sqrtPriceX96U : sqrtPriceOptimalX96 ): (sqrtPriceX96));
        // }

    }
/// @dev Analytic solution for optimal swap between two nearest initialized ticks swapping token0 to token1
    /// @param state Pool state at the last tick of optimal swap
    /// @return sqrtPriceFinalX96 sqrt(price) after optimal swap
    function solveOptimalZeroForOne(SwapState memory state) private pure returns (uint160 sqrtPriceFinalX96) {
        /**
         * root = (sqrt(b^2 + 4ac) + b) / 2a
         * `a` is in the order of `amount0Desired`. `b` is in the order of `liquidity`.
         * `c` is in the order of `amount1Desired`.
         * `a`, `b`, `c` are signed integers in two's complement but typed as unsigned to avoid unnecessary casting.
         */
        uint256 a;
        uint256 b;
        uint256 c;
        uint256 sqrtPriceX96;
        unchecked {
            uint256 liquidity;
            uint256 sqrtRatioLowerX96;
            uint256 sqrtRatioUpperX96;
            uint256 feePips;
            uint256 FEE_COMPLEMENT;
            assembly ("memory-safe") {
                // liquidity = state.liquidity
                liquidity := mload(state)
                // sqrtPriceX96 = state.sqrtPriceX96
                sqrtPriceX96 := mload(add(state, 0x20))
                // sqrtRatioLowerX96 = state.sqrtRatioLowerX96
                sqrtRatioLowerX96 := mload(add(state, 0xa0))
                // sqrtRatioUpperX96 = state.sqrtRatioUpperX96
                sqrtRatioUpperX96 := mload(add(state, 0xc0))
                // feePips = state.feePips
                feePips := mload(add(state, 0xe0))
                // FEE_COMPLEMENT = MAX_FEE_PIPS - feePips
                FEE_COMPLEMENT := sub(MAX_FEE_PIPS, feePips)
            }
            {
                uint256 a0;
                assembly ("memory-safe") {
                    // amount0Desired = state.amount0Desired
                    let amount0Desired := mload(add(state, 0x60))
                    let liquidityX96 := shl(96, liquidity)
                    // a = amount0Desired + liquidity / ((1 - f) * sqrtPrice) - liquidity / sqrtRatioUpper
                    a0 := add(amount0Desired, div(mul(MAX_FEE_PIPS, liquidityX96), mul(FEE_COMPLEMENT, sqrtPriceX96)))
                    a := sub(a0, div(liquidityX96, sqrtRatioUpperX96))
                    // `a` is always positive and greater than `amount0Desired`.
                    if lt(a, amount0Desired) {
                        // revert Math_Overflow()
                        mstore(0, 0x20236808)
                        revert(0x1c, 0x04)
                    }
                }
                b = a0.mulDiv(sqrtRatioLowerX96,Q96);
                assembly {
                    b := add(div(mul(feePips, liquidity), FEE_COMPLEMENT), b)
                }
            }
            {
                // c = amount1Desired + liquidity * sqrtPrice - liquidity * sqrtRatioLower / (1 - f)
                uint256 c0 = liquidity.mulDiv(sqrtPriceX96,Q96);
                assembly ("memory-safe") {
                    // c0 = amount1Desired + liquidity * sqrtPrice
                    c0 := add(mload(add(state, 0x80)), c0)
                }
                c = c0 - liquidity.mulDiv((MAX_FEE_PIPS * sqrtRatioLowerX96) / FEE_COMPLEMENT,Q96);
                b -= c0.mulDiv(Q96, sqrtRatioUpperX96);
            }
            assembly {
                a := shl(1, a)
                c := shl(1, c)
            }
        }
        // Given a root exists, the following calculations cannot realistically overflow/underflow.
        unchecked {
            uint256 numerator = Math.sqrt(b * b + a * c) + b;
            assembly {
                // `numerator` and `a` must be positive so use `div`.
                sqrtPriceFinalX96 := div(shl(96, numerator), a)
            }
        }
        // The final price must be less than or equal to the price at the last tick.
        // However the calculated price may increase if the ratio is close to optimal.
        assembly {
            // sqrtPriceFinalX96 = min(sqrtPriceFinalX96, sqrtPriceX96)
            sqrtPriceFinalX96 := xor(
                sqrtPriceX96,
                mul(xor(sqrtPriceX96, sqrtPriceFinalX96), lt(sqrtPriceFinalX96, sqrtPriceX96))
            )
        }
    }

    /// @dev Analytic solution for optimal swap between two nearest initialized ticks swapping token1 to token0
    /// @param state Pool state at the last tick of optimal swap
    /// @return sqrtPriceFinalX96 sqrt(price) after optimal swap
    function solveOptimalOneForZero(SwapState memory state) private pure returns (uint160 sqrtPriceFinalX96) {
        /**
         * root = (sqrt(b^2 + 4ac) + b) / 2a
         * `a` is in the order of `amount0Desired`. `b` is in the order of `liquidity`.
         * `c` is in the order of `amount1Desired`.
         * `a`, `b`, `c` are signed integers in two's complement but typed as unsigned to avoid unnecessary casting.
         */
        uint256 a;
        uint256 b;
        uint256 c;
        uint256 sqrtPriceX96;
        unchecked {
            uint256 liquidity;
            uint256 sqrtRatioLowerX96;
            uint256 sqrtRatioUpperX96;
            uint256 feePips;
            uint256 FEE_COMPLEMENT;
            assembly ("memory-safe") {
                // liquidity = state.liquidity
                liquidity := mload(state)
                // sqrtPriceX96 = state.sqrtPriceX96
                sqrtPriceX96 := mload(add(state, 0x20))
                // sqrtRatioLowerX96 = state.sqrtRatioLowerX96
                sqrtRatioLowerX96 := mload(add(state, 0xa0))
                // sqrtRatioUpperX96 = state.sqrtRatioUpperX96
                sqrtRatioUpperX96 := mload(add(state, 0xc0))
                // feePips = state.feePips
                feePips := mload(add(state, 0xe0))
                // FEE_COMPLEMENT = MAX_FEE_PIPS - feePips
                FEE_COMPLEMENT := sub(MAX_FEE_PIPS, feePips)
            }
            {
                // a = state.amount0Desired + liquidity / sqrtPrice - liquidity / ((1 - f) * sqrtRatioUpper)
                uint256 a0;
                assembly ("memory-safe") {
                    let liquidityX96 := shl(96, liquidity)
                    // a0 = state.amount0Desired + liquidity / sqrtPrice
                    a0 := add(mload(add(state, 0x60)), div(liquidityX96, sqrtPriceX96))
                    a := sub(a0, div(mul(MAX_FEE_PIPS, liquidityX96), mul(FEE_COMPLEMENT, sqrtRatioUpperX96)))
                }
                b = a0.mulDiv(sqrtRatioLowerX96,Q96);
                assembly {
                    b := sub(b, div(mul(feePips, liquidity), FEE_COMPLEMENT))
                }
            }
            {
                // c = amount1Desired + liquidity * sqrtPrice / (1 - f) - liquidity * sqrtRatioLower
                uint256 c0 = liquidity.mulDiv((MAX_FEE_PIPS * sqrtPriceX96) / FEE_COMPLEMENT,Q96);
                uint256 amount1Desired;
                assembly ("memory-safe") {
                    // amount1Desired = state.amount1Desired
                    amount1Desired := mload(add(state, 0x80))
                    // c0 = amount1Desired + liquidity * sqrtPrice / (1 - f)
                    c0 := add(amount1Desired, c0)
                }
                c = c0 - liquidity.mulDiv(sqrtRatioLowerX96,Q96);
                assembly ("memory-safe") {
                    // `c` is always positive and greater than `amount1Desired`.
                    if lt(c, amount1Desired) {
                        // revert Math_Overflow()
                        mstore(0, 0x20236808)
                        revert(0x1c, 0x04)
                    }
                }
                b -= c0.mulDiv(Q96, state.sqrtRatioUpperX96);
            }
            assembly {
                a := shl(1, a)
                c := shl(1, c)
            }
        }
        // Given a root exists, the following calculations cannot realistically overflow/underflow.
        unchecked {
            uint256 numerator = Math.sqrt(b * b + a * c) + b;
            assembly {
                // `numerator` and `a` may be negative so use `sdiv`.
                sqrtPriceFinalX96 := sdiv(shl(96, numerator), a)
            }
        }
        // The final price must be greater than or equal to the price at the last tick.
        // However the calculated price may decrease if the ratio is close to optimal.
        assembly {
            // sqrtPriceFinalX96 = max(sqrtPriceFinalX96, sqrtPriceX96)
            sqrtPriceFinalX96 := xor(
                sqrtPriceX96,
                mul(xor(sqrtPriceX96, sqrtPriceFinalX96), gt(sqrtPriceFinalX96, sqrtPriceX96))
            )
        }
    }


}
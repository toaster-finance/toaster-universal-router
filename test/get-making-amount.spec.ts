import { reset, takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";
import { formatEther, formatUnits, parseEther, parseUnits } from "ethers/lib/utils";
import { getMakingAmount } from "../scripts/getMakingAmount";
import { ethers } from "hardhat";
const URL = "https://arbitrum.llamarpc.com";
const BLOCKNUMBER = 151396608;
const WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const FEE = 3000n;
const POOL = "0xc473e2aEE3441BF9240Be85eb122aBB059A3B57c";
const FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
describe("Test getMakingAmount", () => {
    before("Fork Arbitrum Mainnet", async () => {
        await reset(URL, BLOCKNUMBER);
    });
    it("Check Making Amount, if invest 1WETH 2000USDC", async () => {
        const snapshot = await takeSnapshot();
        const AMOUNT0 = parseUnits("2000", 6).toBigInt();
        const AMOUNT1 = parseEther("1").toBigInt();
        const [token0, token1] = USDC < WETH ? [USDC, WETH] : [WETH, USDC];
        const [_amount0Desired, _amount1Desired] = USDC < WETH ? [AMOUNT0, AMOUNT1] : [AMOUNT1, AMOUNT0];
        const tick = await (await ethers.getContractAt("IUniswapV3PoolState", POOL)).slot0().then((slot0) => slot0.tick);
        const tickSpacing = await (await ethers.getContractAt("IUniswapV3PoolImmutables",POOL)).tickSpacing();
        const currentTick = BigInt(Math.floor(Number(tick / tickSpacing))) * BigInt(tickSpacing);
        const _lowerTick = currentTick - BigInt(tickSpacing) * 6n;
        const _upperTick = currentTick + BigInt(tickSpacing) * 5n;
        await getMakingAmount({
            tickLower: _lowerTick,
            tickUpper: _upperTick,
            token0,
            token1,
            fee: FEE,
            factoryAddr: FACTORY,
            amount0Desired: _amount0Desired,
            amount1Desired: _amount1Desired
        }).then((r) => {
            const { isMakingZero, makingAmount, estimateTakingAmount } = r;
            console.log("isMakingZero", isMakingZero);
            console.log("makingAmount", formatEther(makingAmount));
            console.log("estimateTakingAmount", formatUnits(estimateTakingAmount, 6));
        });

    await snapshot.restore();
  });
 });

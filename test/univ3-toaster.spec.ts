import { base } from './../node_modules/acorn-walk/dist/walk.d';
import { deposit, depositAndTransferTo } from './../utils/weth';
import { expect } from 'chai';
import { ethers} from "hardhat";
import { IERC20, IUniswapV3PoolState, UniV3Toaster, WETH9 } from "../typechain-types";
import { getBalance, getTokenIn, getTokens } from "../utils/erc20";
import { impersonateAccount, reset, setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { formatUnits,parseEther,parseUnits,formatEther,AbiCoder,hexZeroPad } from 'ethers/lib/utils';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
const URL = "https://arbitrum.llamarpc.com";
const BLOCKNUMBER = 151396608;
const WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const FEE= 3000n;
const POOL = "0xc473e2aEE3441BF9240Be85eb122aBB059A3B57c";
const ROUTER = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const FUSION = "0x1111111254EEB25477B68fb85Ed929f73A960582";

describe("Univ3Toaster: Invest 5 WETH, 10000USDC", () => { 
    let toaster: UniV3Toaster;
    let pool: IUniswapV3PoolState;
    let weth: WETH9;
    let usdc: IERC20;

    let token0: string;
    let token1: string;
    let amount0Desired: bigint;
    let amount1Desired: bigint;
    let baseToken: string;
    let quoteToken: string;
    let baseAmountDesired: bigint;
    let quoteAmountDesired: bigint;

    let currentTick: bigint;
    let lowerTick: bigint;
    let upperTick: bigint;

    let makingAmount: bigint;
    let takingAmount: bigint;
    let isZeroForOne: boolean;
    let maker: HardhatEthersSigner;
    let taker: HardhatEthersSigner;
   
    before("Fork Arbitrum Mainnet & Deploy toaster", async () => {
        await reset(URL, BLOCKNUMBER);
        const toaster_f = await ethers.getContractFactory("UniV3Toaster");
        toaster = await toaster_f.deploy(MANAGER, FUSION).then((t) => t.deployed());
        await deposit(WETH, parseEther("30").toBigInt()); // 30 WETH
        await getTokens(
            WETH,
            USDC,
            parseUnits("10000",6).toBigInt(),
            ROUTER
        ); 
        expect(await getBalance(USDC)).to.equal(parseUnits("10000",6));
        pool = await ethers.getContractAt("IUniswapV3PoolState", POOL);
        weth = await ethers.getContractAt("WETH9", WETH);
        usdc = await ethers.getContractAt("IERC20", USDC);
    });
    it("Test get swap amount & set lowerTick, upperTick for add liquidity 5 WETH 10000 USDC", async () => { 
        const amount0 = parseUnits("10000",6).toBigInt();
        const amount1 = parseEther("5").toBigInt();
        const [token0, token1] = (USDC < WETH) ? [USDC, WETH] : [WETH, USDC];
        [amount0Desired, amount1Desired] = (USDC < WETH) ? [amount0, amount1] : [amount1, amount0];
        const _pool = await ethers.getContractAt("IUniswapV3PoolImmutables", POOL);
        const slot0 = await pool.slot0();
        const tickSpacing = await _pool.tickSpacing();
        const currentTick = BigInt(Math.floor(Number(slot0.tick / tickSpacing))) * BigInt(tickSpacing);
        lowerTick = currentTick - BigInt(tickSpacing) * 10n
        upperTick = currentTick + BigInt(tickSpacing) * 5n;
        
        const { isZeroForOne , makingAmount:_makingAmount } = await toaster.getMakingAmount(lowerTick, upperTick, token0, token1, FEE, amount0Desired, amount1Desired);
        makingAmount = _makingAmount.toBigInt();
        takingAmount = 10n**12n * makingAmount/1950n; // 1ETH = 1950USDC
        
        expect(isZeroForOne).to.equal(false);
        expect(formatUnits(makingAmount, 6)).to.equal("74.000492");


       [baseToken, quoteToken] = isZeroForOne
          ? [token0, token1]
          : [token1, token0];
        [baseAmountDesired, quoteAmountDesired] = isZeroForOne
          ? [amount0Desired, amount1Desired]
          : [amount1Desired, amount0Desired];
        
    });
    it("Set Taker 74.000492 USDC", async () => {
      [maker] = await ethers.getSigners();
      await impersonateAccount(FUSION);
        taker = await ethers.getSigner(FUSION);
        
      await getTokens(
        WETH,
        USDC,
        parseUnits("74.000494", 6).toBigInt(),
        ROUTER,
        taker.address
      );
      expect(await getBalance(USDC, taker.address)).eq(
        parseUnits("74.000495", 6)
      );
    });

    it("Test fill Order PostInteraction 1: fill 34.000492 USDC", async () => {
      const encoder = new AbiCoder();
      const interactionData = encoder.encode(
        [
          "address",
          "address",
          "uint256",
          "uint256",
          "uint24",
          "int24",
          "int24",
        ],
        [
          baseToken,
          quoteToken,
          baseAmountDesired,
          quoteAmountDesired,
          FEE,
          lowerTick,
          upperTick,
        ]
        );
        const mockOrderHash = hexZeroPad("0x", 32);

        //mock fill 
        console.log(
          USDC,
          WETH,
          parseUnits("34.000492", 6).toBigInt(),
          ROUTER,
          toaster.address
        );
        await getTokenIn(USDC, WETH, parseUnits("34.000492", 6).toBigInt(), ROUTER, toaster.address);
        expect(await getBalance(WETH, toaster.address)).eq(0n);
        const r2 = await toaster
        .connect(taker.address)
        .fillOrderPostInteraction(
          mockOrderHash,
          maker.address,
          taker.address,
          makingAmount,
          takingAmount,
          "0",
          interactionData
        )
            .then((t) => t.wait());
    
    });

    it("Test fill Order PostInteraction 2: fill 30 USDC", async () => { });
    it("Test fill Order PostInteraction 3: fill 10 USDC", async () => {});
});

import { deposit, depositAndTransferTo } from './../utils/weth';
import { expect } from 'chai';
import { ethers} from "hardhat";
import { IERC20__factory, IUniswapV3PoolState, UniV3Toaster} from "../typechain-types";
import { approveMax, getBalance, doExactInput, doExactOutput } from "../utils/erc20";
import { impersonateAccount, reset, setBalance, takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";
import { formatUnits,parseEther,parseUnits,formatEther,AbiCoder,hexZeroPad, splitSignature } from 'ethers/lib/utils';
import {  SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { splitHash } from '../utils/event';
import { getMakingAmount } from '../scripts/getMakingAmount';
const URL = "https://arbitrum.llamarpc.com";
const BLOCKNUMBER = 151396608;
const WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const FEE= 3000n;
const POOL = "0xc473e2aEE3441BF9240Be85eb122aBB059A3B57c";
const ROUTER = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const FUSION = "0x1111111254EEB25477B68fb85Ed929f73A960582";
const MINT_EVENT_SIGNATURE =
  "0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde";
const FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
describe("Univ3Toaster: Invest 5 WETH, 10000USDC", () => { 
    let toaster: UniV3Toaster;
    let pool: IUniswapV3PoolState;

    let amount0Desired: bigint;
    let amount1Desired: bigint;
    let makeToken: string;
    let takeToken: string;
    let baseAmountDesired: bigint;
    let quoteAmountDesired: bigint;

    let lowerTick: bigint;
    let upperTick: bigint;

    let makingAmount: bigint;
  
    let maker: SignerWithAddress;
    let taker: SignerWithAddress;
   
    before("Fork Arbitrum Mainnet & Deploy toaster", async () => {
      await reset(URL, BLOCKNUMBER);

      [maker] = await ethers.getSigners();
      const toaster_f = await ethers.getContractFactory("UniV3Toaster");
      toaster = await toaster_f
        .deploy(MANAGER, FUSION)
        .then((t) => t.deployed());
      // set maker have 10000 WETH & 10000 USDC
      await setBalance(maker.address, parseEther("1000000000"));
      await deposit(WETH, parseEther("10000").toBigInt()); // 10000 WETH
      expect(await getBalance(WETH)).to.equal(parseEther("10000"));
      await doExactOutput(WETH, USDC, parseUnits("10000", 6).toBigInt(), ROUTER); // 10000 USDC
      expect(await getBalance(USDC)).to.equal(parseUnits("10000", 6));

      pool = await ethers.getContractAt("IUniswapV3PoolState", POOL);

      // set taker have 100000 USDC & 100 WETH
      await impersonateAccount(FUSION);
      taker = await ethers.getSigner(FUSION);
      await setBalance(taker.address, parseEther("1")); // for gas cost
      await doExactOutput(
        WETH,
        USDC,
        parseUnits("100000", 6).toBigInt(),
        ROUTER,
        taker.address
      );
      await depositAndTransferTo(
        WETH,
        parseEther("100").toBigInt(),
        taker.address
      );
    });
  
  
  it("Test 1: Get Making Amount & Set lowerTick, upperTick for add liquidity 5 WETH 10000 USDC", async () => {
    const AMOUNT0 = parseUnits("10000", 6).toBigInt();
    const AMOUNT1 = parseEther("5").toBigInt();
    const [token0, token1] = USDC < WETH ? [USDC, WETH] : [WETH, USDC];
    [amount0Desired, amount1Desired] =
      USDC < WETH ? [AMOUNT0, AMOUNT1] : [AMOUNT1, AMOUNT0];
    const _pool = await ethers.getContractAt("IUniswapV3PoolImmutables", POOL);
    const slot0 = await pool.slot0();
    const tickSpacing = await _pool.tickSpacing();
    const currentTick =
      BigInt(Math.floor(Number(slot0.tick / tickSpacing))) *
      BigInt(tickSpacing);
    lowerTick = currentTick - BigInt(tickSpacing) * 10n;
    upperTick = currentTick + BigInt(tickSpacing) * 5n;

    const { isMakingZero, makingAmount } = await getMakingAmount(
      {
        tickLower: lowerTick,
        tickUpper: upperTick,
        factory: FACTORY,
        token0,
        token1,
        fee: FEE,
        amount0Desired,
        amount1Desired,
      }
    );

    expect(isMakingZero).to.equal(true);
    expect(formatEther(makingAmount)).to.equal("1.503936164075062197"); // 1.503936164075062197 WETH need to swap to USDC

    [makeToken, takeToken] = isMakingZero ? [token0, token1] : [token1, token0];
    [baseAmountDesired, quoteAmountDesired] = isMakingZero
      ? [amount0Desired, amount1Desired]
      : [amount1Desired, amount0Desired];

    expect(makeToken).to.equal(WETH);
    expect(takeToken).to.equal(USDC);
    expect(quoteAmountDesired).to.equal(parseUnits("10000", 6).toBigInt());
    expect(baseAmountDesired).to.equal(parseEther("5").toBigInt());

    await approveMax(WETH, toaster.address);
    await approveMax(USDC, toaster.address);
  });  

  it("Test 1 - 1 : Fill Order PostInteraction 1: fill 0.503936164075062197 WETH", async () => {
    const MAKING = parseEther("0.503936164075062197").toBigInt(); // 0.503936164075062197 WETH
    const TAKING = parseUnits("1110", 6).toBigInt(); // 1ETH = 2200USDC

    const encoder = new AbiCoder();

    const interactionData = encoder.encode(
      ["address", "address", "uint256", "uint256", "uint24", "int24", "int24"],
      [
        makeToken,
        takeToken,
        baseAmountDesired,
        quoteAmountDesired,
        FEE,
        lowerTick,
        upperTick,
      ]
    );
    const mockOrderHash = hexZeroPad("0x", 32);

    //mock fill
    await IERC20__factory.connect(USDC, taker).transfer(
      toaster.address,
      TAKING
    );

    await toaster
      .connect(taker)
      .fillOrderPostInteraction(
        mockOrderHash,
        maker.address,
        taker.address,
        MAKING,
        TAKING,
        parseEther("3"),
        interactionData
      )
      .then((t) => t.wait());

    // expect(await toaster.taking(mockOrderHash, USDC)).to.be.eq(MAKING);
    // expect(await toaster.making(mockOrderHash, WETH)).to.be.eq(TAKING);
  });

  it("Test 1 - 2: Fill Order PostInteraction 2: fill 0.5 WETH", async () => { const encoder = new AbiCoder();
    const MAKING = parseEther("0.5").toBigInt();  
    const TAKING = parseUnits("1100", 6).toBigInt();
    const interactionData = encoder.encode(
      ["address", "address", "uint256", "uint256", "uint24", "int24", "int24"],
      [
        makeToken,
        takeToken,
        baseAmountDesired,
        quoteAmountDesired,
        FEE,
        lowerTick,
        upperTick,
      ]
    );
    const mockOrderHash = hexZeroPad("0x", 32);

    //mock fill
    await IERC20__factory.connect(USDC, taker).transfer(toaster.address, TAKING);
    await toaster
    .connect(taker)
    .fillOrderPostInteraction(
      mockOrderHash,
      maker.address,
      taker.address,
      MAKING,
      TAKING,
      parseEther("1"),
      interactionData
    )
    .then((t) => t.wait());
    // expect(await toaster.taking(mockOrderHash, USDC)).to.be.eq(MAKING);
    // expect(await toaster.making(mockOrderHash, WETH)).to.be.eq(TAKING);
      
    });
  it("Test 1 - 3: Fill Order PostInteraction 3: fill 0.5 WETH", async () => {
    const MAKING = parseEther("0.5").toBigInt();
    const TAKING = parseUnits("1100", 6).toBigInt();
    const encoder = new AbiCoder();

    const interactionData = encoder.encode(
      ["address", "address", "uint256", "uint256", "uint24", "int24", "int24"],
      [
        makeToken,
        takeToken,
        baseAmountDesired,
        quoteAmountDesired,
        FEE,
        lowerTick,
        upperTick,
      ]
    );
    const mockOrderHash = hexZeroPad("0x", 32);
    //mock fill
    await IERC20__factory.connect(USDC, taker).transfer(
      toaster.address,
      TAKING
    );

    const [amount0Success, amount1Success] = await toaster
      .connect(taker)
      .fillOrderPostInteraction(
        mockOrderHash,
        maker.address,
        taker.address,
        MAKING,
        TAKING,
        "0",
        interactionData
    )
      .then((t) => t.wait())
      .then((r) => r.logs.filter((log) => log.topics[0] === MINT_EVENT_SIGNATURE)[0])
      .then((mintLog) => splitHash(mintLog.data))
      .then((data) => [data[2], data[3]]);
    
    
    console.log("amount0Success", formatEther(amount0Success));
    console.log("amount1Success", formatUnits(amount1Success,6));
    // expect(await getBalance(USDC, toaster.address)).to.be.eq(0);  // 3310.000000
    expect(await getBalance(WETH, toaster.address)).to.be.eq(0);  // 2.172447242951399416
    // expect(await toaster.taking(mockOrderHash, USDC)).to.be.eq(0);
    // expect(await toaster.making(mockOrderHash, WETH)).to.be.eq(0);
  });

  it("Test 2: Get Making Amount & Set lowerTick, upperTick for add liquidity 4 WETH 10000 USDC", async () => { });
});

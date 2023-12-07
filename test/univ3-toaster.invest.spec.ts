import { IERC20 } from './../typechain-types/@openzeppelin/contracts/token/ERC20/IERC20';
import { deposit, depositAndTransferTo } from './../utils/weth';
import { expect } from 'chai';
import { ethers} from "hardhat";
import { IERC20__factory, IUniswapV3PoolState, UniV3Toaster} from "../typechain-types";
import { approveMax, getBalance, doExactOutput, doExactInput } from "../utils/erc20";
import { SnapshotRestorer, impersonateAccount, reset, setBalance, takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";
import { formatUnits,parseEther,parseUnits,formatEther,AbiCoder,hexZeroPad, splitSignature, hexlify } from 'ethers/lib/utils';
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

    let USDC_WETH_RATIO: bigint;
  
    let maker1: SignerWithAddress;
    let maker2: SignerWithAddress;
    let taker: SignerWithAddress;
    let testSnapShot: SnapshotRestorer;
   
    before("Fork Arbitrum Mainnet & Deploy toaster", async () => {
      await reset(URL, BLOCKNUMBER);

      [maker1] = await ethers.getSigners();
      const toaster_f = await ethers.getContractFactory("UniV3Toaster");
      toaster = await toaster_f
        .deploy(MANAGER, FUSION)
        .then((t) => t.deployed());
      // set maker have 10000 WETH & 10000 USDC
      await setBalance(maker1.address, parseEther("1000000000"));
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

      const sqrtPriceX96 = await pool
        .slot0()
        .then((s) => s.sqrtPriceX96.toBigInt());
      USDC_WETH_RATIO = (sqrtPriceX96 ** 2n * 10n ** 18n) / 2n ** 192n;
      expect(formatUnits(USDC_WETH_RATIO, 6)).to.equal("1877.525429");
    });
  
  
  it("Test 1: Get Making Amount & Set lowerTick, upperTick for add liquidity 5 WETH 10000 USDC", async () => {
    testSnapShot = await takeSnapshot();
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

    const { isMakingZero, makingAmount } = await getMakingAmount({
      tickLower: lowerTick,
      tickUpper: upperTick,
      factoryAddr: FACTORY,
      token0,
      token1,
      fee: FEE,
      amount0Desired,
      amount1Desired,
    });

    expect(isMakingZero).to.equal(true);
    expect(formatEther(makingAmount)).to.equal("2.189068064621210236"); // 5303.527731 USDC need to swap to WETH

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

  it("Test 1 - 1 : Fill Order PostInteraction 1: fill 0.189068064621210236 WETH", async () => {
    
    const MAKING = parseEther("0.189068064621210236").toBigInt();
    const TAKING = (MAKING * USDC_WETH_RATIO) / 10n ** 18n;
    

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
        maker1.address,
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

  it("Test 1 - 2: Fill Order PostInteraction 2: fill 1 WETH", async () => { const encoder = new AbiCoder();
    const MAKING = parseEther("1").toBigInt();
    const TAKING = (MAKING * USDC_WETH_RATIO) / 10n ** 18n;
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
      maker1.address,
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
  it("Test 1 - 3: Fill Order PostInteraction 3: fill 1 WETH", async () => {
    const MAKING = parseEther("1").toBigInt();
    const TAKING = (MAKING * USDC_WETH_RATIO) / 10n ** 18n;
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
        maker1.address,
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
    
    expect(formatEther(amount0Success)).to.be.eq("2.810898311810595642");
    expect(formatUnits(amount1Success, 6)).to.be.eq("14110.030956");

    await testSnapShot.restore();
  
  });

    it("Test 2: Get Making Amount & Set lowerTick, upperTick for add liquidity 5 WETH 10000 USDC", async () => {
      testSnapShot = await takeSnapshot();
      const AMOUNT0 = parseUnits("10000", 6).toBigInt();
      const AMOUNT1 = parseEther("5").toBigInt();
      const [token0, token1] = USDC < WETH ? [USDC, WETH] : [WETH, USDC];
      [amount0Desired, amount1Desired] =
        USDC < WETH ? [AMOUNT0, AMOUNT1] : [AMOUNT1, AMOUNT0];
      const _pool = await ethers.getContractAt(
        "IUniswapV3PoolImmutables",
        POOL
      );
      const slot0 = await pool.slot0();
      const tickSpacing = await _pool.tickSpacing();
      const currentTick =
        BigInt(Math.floor(Number(slot0.tick / tickSpacing))) *
        BigInt(tickSpacing);
      lowerTick = currentTick - BigInt(tickSpacing) * 5n;
      upperTick = currentTick + BigInt(tickSpacing) * 10n;

      const { isMakingZero, makingAmount } = await getMakingAmount({
        tickLower: lowerTick,
        tickUpper: upperTick,
        factoryAddr: FACTORY,
        token0,
        token1,
        fee: FEE,
        amount0Desired,
        amount1Desired,
      });

      expect(isMakingZero).to.equal(false);
      expect(formatUnits(makingAmount, 6)).to.equal("2291.486407"); // 2291.486407 USDC need to swap to WETH

      [makeToken, takeToken] = isMakingZero
        ? [token0, token1]
        : [token1, token0];
      [baseAmountDesired, quoteAmountDesired] = isMakingZero
        ? [amount0Desired, amount1Desired]
        : [amount1Desired, amount0Desired];

      expect(makeToken).to.equal(USDC);
      expect(takeToken).to.equal(WETH);
      expect(baseAmountDesired).to.equal(parseUnits("10000", 6).toBigInt());
      expect(quoteAmountDesired).to.equal(parseEther("5").toBigInt());

      await approveMax(WETH, toaster.address);
      await approveMax(USDC, toaster.address);
    });  

  it("Test 2 - 1 : Fill Order PostInteraction 1: fill 291.486407 USDC", async () => {
    const MAKING = parseUnits("291.486407",6).toBigInt();
    const TAKING = MAKING * 10n ** 18n / USDC_WETH_RATIO;

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
    await IERC20__factory.connect(WETH, taker).transfer(
      toaster.address,
      TAKING
    );

    await toaster
      .connect(taker)
      .fillOrderPostInteraction(
        mockOrderHash,
        maker1.address,
        taker.address,
        MAKING,
        TAKING,
        parseEther("3"),
        interactionData
      )
      .then((t) => t.wait());
  });

  it("Test 2 - 2: Fill Order PostInteraction 2: fill 500 USDC", async () => { const encoder = new AbiCoder();
    const MAKING = parseUnits("500", 6).toBigInt();
    const TAKING = (MAKING * 10n ** 18n) / USDC_WETH_RATIO;
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
    await IERC20__factory.connect(WETH, taker).transfer(toaster.address, TAKING);
    await toaster
    .connect(taker)
    .fillOrderPostInteraction(
      mockOrderHash,
      maker1.address,
      taker.address,
      MAKING,
      TAKING,
      parseEther("1"),
      interactionData
    )
    .then((t) => t.wait());
      
    });
  it("Test 2 - 3: Fill Order PostInteraction 3: fill 1500 USDC", async () => {
    const MAKING = parseUnits("1500", 6).toBigInt();
    const TAKING = (MAKING * 10n ** 18n) / USDC_WETH_RATIO;
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
    await IERC20__factory.connect(WETH, taker).transfer(
      toaster.address,
      TAKING
    );

    const [amount0Success, amount1Success] = await toaster
      .connect(taker)
      .fillOrderPostInteraction(
        mockOrderHash,
        maker1.address,
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
    
    expect(formatEther(amount0Success)).to.be.eq("6.220482221573658624");
    expect(formatUnits(amount1Success, 6)).to.be.eq("7708.575699");

    await testSnapShot.restore();
  
  });
  let amount0DesiredMaker1: bigint;
  let amount1DesiredMaker1: bigint;
  let amount0DesiredMaker2: bigint;
  let amount1DesiredMaker2: bigint;
  let makingAmount1: bigint;
  let makingAmount2: bigint;
  let baseAmountDesired1: bigint;
  let quoteAmountDesired1: bigint;
  let baseAmountDesired2: bigint;
  let quoteAmountDesired2: bigint;
  it("Maker 2 get amount ", async () => {
    [maker1, maker2] = await ethers.getSigners();
    await setBalance(maker2.address, parseEther("1000000000"));
    await doExactOutput(WETH, USDC, parseUnits("10000", 6).toBigInt(), ROUTER, maker2.address);
    await depositAndTransferTo(WETH, parseEther("100").toBigInt(), maker2.address);
  });

  it("Test 3 : Process simultaneously two maker's order,[ 2 WETH + 5000 USDC(MAKER1), 3WETH + 5000USDC(MAKER2) ]", async () => {
    testSnapShot = await takeSnapshot();

    const [token0, token1] = USDC < WETH ? [USDC, WETH] : [WETH, USDC];
    const AMOUNT0_1 = parseUnits("5000", 6).toBigInt();
    const AMOUNT1_1 = parseEther("2").toBigInt();

    [amount0DesiredMaker1, amount1DesiredMaker1] =
      USDC < WETH ? [AMOUNT0_1, AMOUNT1_1] : [AMOUNT1_1, AMOUNT0_1];

    const AMOUNT0_2 = parseUnits("5000", 6).toBigInt();
    const AMOUNT1_2 = parseEther("3").toBigInt();
    [amount0DesiredMaker2, amount1DesiredMaker2] =
      USDC < WETH ? [AMOUNT0_2, AMOUNT1_2] : [AMOUNT1_2, AMOUNT0_2];
    const _pool = await ethers.getContractAt("IUniswapV3PoolImmutables", POOL);
    const slot0 = await pool.slot0();
    const tickSpacing = await _pool.tickSpacing();
    const currentTick =
      BigInt(Math.floor(Number(slot0.tick / tickSpacing))) *
      BigInt(tickSpacing);
    lowerTick = currentTick - BigInt(tickSpacing) * 5n;
    upperTick = currentTick + BigInt(tickSpacing) * 10n;

    const { isMakingZero: isMakingZero1, makingAmount: _makingAmount1 } =
      await getMakingAmount({
        tickLower: lowerTick,
        tickUpper: upperTick,
        factoryAddr: FACTORY,
        token0,
        token1,
        fee: FEE,
        amount0Desired: amount0DesiredMaker1,
        amount1Desired: amount1DesiredMaker1,
      });

    const { isMakingZero: isMakingZero2, makingAmount: _makingAmount2 } =
      await getMakingAmount({
        tickLower: lowerTick,
        tickUpper: upperTick,
        factoryAddr: FACTORY,
        token0,
        token1,
        fee: FEE,
        amount0Desired: amount0DesiredMaker2,
        amount1Desired: amount1DesiredMaker2,
      });
    makingAmount1 = _makingAmount1;
    makingAmount2 = _makingAmount2;

    expect(isMakingZero1).to.equal(false);
    expect(formatUnits(makingAmount1, 6)).to.equal("1858.104999"); // 1858.104999 USDC need to swap to WETH
    expect(isMakingZero2).to.equal(false);
    expect(formatUnits(makingAmount2, 6)).to.equal("1185.640521"); // 1185.640521 USDC need to swap to WETH

    [baseAmountDesired1, quoteAmountDesired1] = isMakingZero1
      ? [amount0DesiredMaker1, amount1DesiredMaker1]
      : [amount1DesiredMaker1, amount0DesiredMaker1];

    [baseAmountDesired2, quoteAmountDesired2] = isMakingZero2
      ? [amount0DesiredMaker2, amount1DesiredMaker2]
      : [amount1DesiredMaker2, amount0DesiredMaker2];
    [makeToken, takeToken] = isMakingZero1 // isMakingZero1 === isMakingZero2
      ? [token0, token1]
      : [token1, token0];
    expect(baseAmountDesired1).to.equal(parseUnits("5000", 6).toBigInt());
    expect(quoteAmountDesired1).to.equal(parseEther("2").toBigInt());
    expect(baseAmountDesired2).to.equal(parseUnits("5000", 6).toBigInt());
    expect(quoteAmountDesired2).to.equal(parseEther("3").toBigInt());

    await approveMax(WETH, toaster.address, maker1.address);
    await approveMax(USDC, toaster.address, maker1.address);
    await approveMax(WETH, toaster.address, maker2.address);
    await approveMax(USDC, toaster.address, maker2.address);
  });

  it("Test 3 - 1 : Process maker1's order [fill partial: + 858.104999 USDC ]", async () => {
    const MAKING = parseUnits("858.104999", 6).toBigInt();
    const TAKING = (MAKING * 10n ** 18n) / USDC_WETH_RATIO;

    const encoder = new AbiCoder();

    const interactionData = encoder.encode(
      ["address", "address", "uint256", "uint256", "uint24", "int24", "int24"],
      [
        makeToken,
        takeToken,
        baseAmountDesired1,
        quoteAmountDesired1,
        FEE,
        lowerTick,
        upperTick,
      ]
    );

    //mock fill
    const mockOrderHash = hexZeroPad("0x1", 32);
    await IERC20__factory.connect(WETH, taker).transfer(
      toaster.address,
      TAKING
    );

    await toaster
      .connect(taker)
      .fillOrderPostInteraction(
        mockOrderHash,
        maker1.address,
        taker.address,
        MAKING,
        TAKING,
        parseUnits("1000", 6),
        interactionData
      )
      .then((t) => t.wait());
  });
  it("Test 3 - 2 : Process maker2's order [fill partial + 185.640521 USDC]", async () => {
    const MAKING = parseUnits("185.640521", 6).toBigInt();
    const TAKING = (MAKING * 10n ** 18n) / USDC_WETH_RATIO;

    const encoder = new AbiCoder();

    const interactionData = encoder.encode(
      ["address", "address", "uint256", "uint256", "uint24", "int24", "int24"],
      [
        makeToken,
        takeToken,
        baseAmountDesired2,
        quoteAmountDesired2,
        FEE,
        lowerTick,
        upperTick,
      ]
    );

    //mock fill
    const mockOrderHash = hexZeroPad("0x2", 32);
    await IERC20__factory.connect(WETH, taker).transfer(
      toaster.address,
      TAKING
    );
    await toaster
      .connect(taker)
      .fillOrderPostInteraction(
        mockOrderHash,
        maker2.address,
        taker.address,
        MAKING,
        TAKING,
        parseUnits("1000", 6),
        interactionData
      )
      .then((t) => t.wait());
  });
  it("Test 3 - 3 : Process maker1's order [fill total + 1000USDC]", async () => {

    const MAKING = parseUnits("1000",6).toBigInt();
    const TAKING = (MAKING *  10n ** 18n) / USDC_WETH_RATIO;

    const encoder = new AbiCoder();

    const interactionData = encoder.encode(
      ["address", "address", "uint256", "uint256", "uint24", "int24", "int24"],
      [
        makeToken,
        takeToken,
        baseAmountDesired1,
        quoteAmountDesired1,
        FEE,
        lowerTick,
        upperTick,
      ]
    );

    //mock fill
    const mockOrderHash = hexZeroPad("0x1", 32);
    await IERC20__factory.connect(WETH, taker).transfer(
      toaster.address,
      TAKING
    );

    const [amount0Success, amount1Success] = await toaster
      .connect(taker)
      .fillOrderPostInteraction(
        mockOrderHash,
        maker1.address,
        taker.address,
        MAKING,
        TAKING,
        0n,
        interactionData
      )
      .then((t) => t.wait())
      .then(
        (r) => r.logs.filter((log) => log.topics[0] === MINT_EVENT_SIGNATURE)[0]
      )
      .then((mintLog) => splitHash(mintLog.data))
      .then((data) => [data[2], data[3]]);
    
    expect(formatUnits(amount0Success, 18)).to.be.eq("2.989656368858651094");
    expect(formatUnits(amount1Success, 6)).to.be.eq("3138.333431");
   });
  it("Test 3 - 4 : Process maker2's order [fill total + 1000USDC] ", async () => {
    const MAKING = parseUnits("1000", 6).toBigInt();
    const TAKING = (MAKING * 10n ** 18n) / USDC_WETH_RATIO;

    const encoder = new AbiCoder();

    const interactionData = encoder.encode(
      ["address", "address", "uint256", "uint256", "uint24", "int24", "int24"],
      [
        makeToken,
        takeToken,
        baseAmountDesired2,
        quoteAmountDesired2,
        FEE,
        lowerTick,
        upperTick,
      ]
    );

    //mock fill
    const mockOrderHash = hexZeroPad("0x2", 32);
    await IERC20__factory.connect(WETH, taker).transfer(
      toaster.address,
      TAKING
    );

    // const [amount0Success, amount1Success] =
    const[amount0Success, amount1Success]= await toaster
      .connect(taker)
      .fillOrderPostInteraction(
        mockOrderHash,
        maker2.address,
        taker.address,
        MAKING,
        TAKING,
        0n,
        interactionData
      )
      .then((t) => t.wait())
      .then(
        (r) => r.logs.filter((log) => log.topics[0] === MINT_EVENT_SIGNATURE)[0]
      )
      .then((mintLog) => splitHash(mintLog.data))
      .then((data) => [data[2], data[3]]);
      
    expect(formatUnits(amount0Success, 18)).to.be.eq("3.631491058264037122");
    expect(formatUnits(amount1Success, 6)).to.be.eq("3812.086871");
  });
});

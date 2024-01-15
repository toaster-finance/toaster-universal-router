import { reset, takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";
import { formatEther, formatUnits, parseEther, parseUnits } from "ethers/lib/utils";
import { getMakingAmount } from "../scripts/getMakingAmount";
import { ethers } from "hardhat";
import { expect } from "chai";
import { INonfungiblePositionManager } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { splitHash } from "../utils/event";
import { approveMax, doExactInput, doExactOutput, getBalance } from "../utils/erc20";
import { deposit } from "../utils/weth";
const ALKEMY_KEY = process.env.ALCHEMY_KEY;
const URL = `https://arb-mainnet.g.alchemy.com/v2/${ALKEMY_KEY}`;
const BLOCKNUMBER = 151396608;
const MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const FEE = 3000n;
const POOL = "0xc473e2aEE3441BF9240Be85eb122aBB059A3B57c";
const FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const ROUTER = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const MINT_EVENT_SIGNATURE =
  "0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde";
describe("Test getMakingAmount", () => {
    let manager: INonfungiblePositionManager;
    let signer: SignerWithAddress;
    before("Fork Arbitrum Mainnet", async () => {
        await reset(URL, BLOCKNUMBER);
        manager = await ethers.getContractAt("INonfungiblePositionManager", MANAGER);
        [signer] = await ethers.getSigners();

        await deposit(WETH, parseEther("3").toBigInt()); // 3 WETH
        await doExactOutput(WETH, USDC, parseUnits("3000", 6).toBigInt(),ROUTER);


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
        const {makingAmount,estimateTakingAmount,isMakingZero } = await getMakingAmount({
            tickLower: _lowerTick,
            tickUpper: _upperTick,
            token0,
            token1,
            fee: FEE,
            factoryAddr: FACTORY,
            amount0Desired: _amount0Desired,
            amount1Desired: _amount1Desired
        })
        expect(isMakingZero).to.equal(true);
        expect(formatEther(makingAmount)).to.equal("0.104817854390980436");
        expect(formatUnits(estimateTakingAmount, 6)).to.equal("203.057301");
        const [amount0Mint, amount1Mint] = [_amount0Desired - makingAmount, _amount1Desired + estimateTakingAmount];
        expect(formatEther(amount0Mint)).to.equal("0.895182145609019564");
        expect(formatUnits(amount1Mint, 6)).to.equal("2203.057301");
        await approveMax(token0, MANAGER);
        await approveMax(token1, MANAGER);
        
        const [amount0Success, amount1Success] = await manager
          .mint({
            token0,
            token1,
            fee: FEE,
            tickLower: _lowerTick,
            tickUpper: _upperTick,
            amount0Desired: amount0Mint,
            amount1Desired: amount1Mint,
            amount0Min: 0n,
            amount1Min: 0n,
            recipient: signer.address,
            deadline: ethers.constants.MaxUint256,
          })
          .then((tx) => tx.wait())
          .then(
            (r) =>
              r.logs.filter((log) => log.topics[0] === MINT_EVENT_SIGNATURE)[0]
          )
          .then((mintLog) => splitHash(mintLog.data))
          .then((data) => [data[2], data[3]]);
        expect(formatEther(amount0Success)).to.equal("0.895182145210347308");
        expect(formatUnits(amount1Success, 6)).to.equal("2203.057301");
        
    await snapshot.restore();
    });
    

    it("Check Making Amount, if invest 1WETH 2500USDC", async () => {
      const snapshot = await takeSnapshot();
      const AMOUNT0 = parseUnits("2500", 6).toBigInt();
      const AMOUNT1 = parseEther("1").toBigInt();
      const [token0, token1] = USDC < WETH ? [USDC, WETH] : [WETH, USDC];
      const [_amount0Desired, _amount1Desired] =
        USDC < WETH ? [AMOUNT0, AMOUNT1] : [AMOUNT1, AMOUNT0];
      const tick = await (
        await ethers.getContractAt("IUniswapV3PoolState", POOL)
      )
        .slot0()
        .then((slot0) => slot0.tick);
      const tickSpacing = await (
        await ethers.getContractAt("IUniswapV3PoolImmutables", POOL)
      ).tickSpacing();
      const currentTick =
        BigInt(Math.floor(Number(tick / tickSpacing))) * BigInt(tickSpacing);
      const _lowerTick = currentTick - BigInt(tickSpacing) * 6n;
      const _upperTick = currentTick + BigInt(tickSpacing) * 5n;
      const { makingAmount, estimateTakingAmount, isMakingZero } =
        await getMakingAmount({
          tickLower: _lowerTick,
          tickUpper: _upperTick,
          token0,
          token1,
          fee: FEE,
          factoryAddr: FACTORY,
          amount0Desired: _amount0Desired,
          amount1Desired: _amount1Desired,
        });
      expect(isMakingZero).to.equal(false);
      expect(formatUnits(makingAmount, 6)).to.equal("17.17089");
      expect(formatEther(estimateTakingAmount)).to.equal("0.008863585944576");
      const [amount0Mint, amount1Mint] = [
        _amount0Desired + estimateTakingAmount,
        _amount1Desired - makingAmount,
      ];
      expect(formatEther(amount0Mint)).to.equal("1.008863585944576");
      expect(formatUnits(amount1Mint, 6)).to.equal("2482.82911");
      await approveMax(token0, MANAGER);
      await approveMax(token1, MANAGER);

      const [amount0Success, amount1Success] = await manager
        .mint({
          token0,
          token1,
          fee: FEE,
          tickLower: _lowerTick,
          tickUpper: _upperTick,
          amount0Desired: amount0Mint,
          amount1Desired: amount1Mint,
          amount0Min: 0n,
          amount1Min: 0n,
          recipient: signer.address,
          deadline: ethers.constants.MaxUint256,
        })
        .then((tx) => tx.wait())
        .then(
          (r) =>
            r.logs.filter((log) => log.topics[0] === MINT_EVENT_SIGNATURE)[0]
        )
        .then((mintLog) => splitHash(mintLog.data))
        .then((data) => [data[2], data[3]]);
      expect(formatEther(amount0Success)).to.equal("1.008863585944575696");
      expect(formatUnits(amount1Success, 6)).to.equal("2482.82911");

      await snapshot.restore();
    });
    
  
  it("Check Making Amount, if invest 5 WETH 10000 USDC", async () => {
    const snapshot = await takeSnapshot();
    await deposit(WETH, parseEther("12").toBigInt()); // 3 WETH
    await doExactOutput(WETH, USDC, parseUnits("15000", 6).toBigInt(), ROUTER);
    const AMOUNT0 = parseUnits("10000", 6).toBigInt();
    const AMOUNT1 = parseEther("5").toBigInt();
    const [token0, token1] = USDC < WETH ? [USDC, WETH] : [WETH, USDC];
    const [_amount0Desired, _amount1Desired] =
      USDC < WETH ? [AMOUNT0, AMOUNT1] : [AMOUNT1, AMOUNT0];
    const tick = await (await ethers.getContractAt("IUniswapV3PoolState", POOL))
      .slot0()
      .then((slot0) => slot0.tick);
    const tickSpacing = await (
      await ethers.getContractAt("IUniswapV3PoolImmutables", POOL)
    ).tickSpacing();
    const currentTick =
      BigInt(Math.floor(Number(tick / tickSpacing))) * BigInt(tickSpacing);
    const _lowerTick = currentTick - BigInt(tickSpacing) * 10n;
    const _upperTick = currentTick + BigInt(tickSpacing) * 5n;
    const { makingAmount, estimateTakingAmount, isMakingZero } =
      await getMakingAmount({
        tickLower: _lowerTick,
        tickUpper: _upperTick,
        token0,
        token1,
        fee: FEE,
        factoryAddr: FACTORY,
        amount0Desired: _amount0Desired,
        amount1Desired: _amount1Desired,
      });
    expect(isMakingZero).to.equal(true);
    expect(formatEther(makingAmount)).to.equal("1.901902387369338306");
    expect(formatUnits(estimateTakingAmount, 6)).to.equal("3669.244133");
    const [amount0Mint, amount1Mint] = [
      _amount0Desired - makingAmount,
      _amount1Desired + estimateTakingAmount,
    ];
    expect(formatEther(amount0Mint)).to.equal("3.098097612630661694");
    expect(formatUnits(amount1Mint, 6)).to.equal("13669.244133");
    await approveMax(token0, MANAGER);
    await approveMax(token1, MANAGER);

    const [amount0Success, amount1Success] = await manager
      .mint({
        token0,
        token1,
        fee: FEE,
        tickLower: _lowerTick,
        tickUpper: _upperTick,
        amount0Desired: amount0Mint,
        amount1Desired: amount1Mint,
        amount0Min: 0n,
        amount1Min: 0n,
        recipient: signer.address,
        deadline: ethers.constants.MaxUint256,
      })
      .then((tx) => tx.wait())
      .then(
        (r) => r.logs.filter((log) => log.topics[0] === MINT_EVENT_SIGNATURE)[0]
      )
      .then((mintLog) => splitHash(mintLog.data))
      .then((data) => [data[2], data[3]]);
    expect(formatEther(amount0Success)).to.equal("3.098097612615315517");
    expect(formatUnits(amount1Success, 6)).to.equal("13669.244133");

    await snapshot.restore();
  });
  
 });

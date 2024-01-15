import { mine, reset, setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { INonfungiblePositionManager, UniV3FusionToaster } from "../typechain-types";
import { ethers } from "hardhat";
import { burn, deposit } from "../utils/weth";
import { parseEther, parseUnits } from "ethers/lib/utils";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { approveMax, doExactInput, doExactOutput, getBalance } from "../utils/erc20";


const MAX_UINT128 = 2n**128n - 1n;
const ALKEMY_KEY = process.env.ALCHEMY_KEY;
const URL =
  `https://arb-mainnet.g.alchemy.com/v2/${ALKEMY_KEY}`;
const BLOCKNUMBER = 151396608;
const WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const FEE = 3000n;
const POOL = "0xc473e2aEE3441BF9240Be85eb122aBB059A3B57c";
const ROUTER = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const FUSION = "0x1111111254EEB25477B68fb85Ed929f73A960582";
const MINT_EVENT_SIGNATURE =
    "0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde";
const INCREASE_LIQUIDITY_EVENT_SIGNATURE =
    "0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f";
const FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const MAX_TICK = 887272n;
const MIN_TICK = -887272n;
describe("Uniswap V3 Toaster Compound", () => {
    let toaster: UniV3FusionToaster;
    let maker: SignerWithAddress;
    let positionManager:INonfungiblePositionManager;
    before("Fork Arbitrum Mainnet & Deploy toaster & Tokens setup", async() => {
      // Fork Arbitrum Mainnet
      await reset(URL, BLOCKNUMBER);
      [maker] = await ethers.getSigners();

      // Deploy toaster
      toaster = await ethers
        .getContractFactory("UniV3FusionToaster")
        .then((factory) => factory.deploy(MANAGER, FUSION));
        
      positionManager = await ethers.getContractAt("INonfungiblePositionManager", MANAGER);
      // Get tokens
      await setBalance(maker.address, parseEther("1000000000"));
      await deposit(WETH, parseEther("10000").toBigInt()); // 10000 WETH
      expect(await getBalance(WETH)).to.equal(parseEther("10000"));
      await doExactOutput(
        WETH,
        USDC,
        parseUnits("10000", 6).toBigInt(),
        ROUTER
      ); // 10000 USDC
      expect(await getBalance(USDC)).to.equal(parseUnits("10000", 6));
      expect(await getBalance(WETH)).to.equal(9994819423499941138132n);
    });

    it("Mint Position & Mining Fee", async () => {
        const tokenId = await mint();
        await miningFee(10);
        expect(tokenId).to.equal(963380n);
    
        await mine(1);
        // Check Position
        const {amount0:fee0,amount1:fee1}  =await positionManager.callStatic.collect({
          tokenId: tokenId,
          recipient: maker.address,
          amount0Max: MAX_UINT128,
          amount1Max: MAX_UINT128,
        });
      
        await mine(1);
        expect(fee0).to.equal(165511423513165808854n);
        expect(fee1).to.equal(300383944n);

        // Check Balance
        expect(await getBalance(WETH)).to.equal(0n);
        expect(await getBalance(USDC)).to.equal(0n);
    });
    it("Make Order for Compounding Fee", () => {
      // Calculating Amount 
      
    });
    it("Fill Order(partial) by Taker", () => {});
    it("Fill Order(fully) by Taker", () => {});
    


    const mint = async () : Promise<string> => {
        const usdcBalance = await getBalance(USDC);
        const wethBalance = await getBalance(WETH);
        await approveMax(USDC, MANAGER);
        await approveMax(WETH, MANAGER);
        return positionManager
          .mint({
            token0: WETH,
            token1: USDC,
            fee: FEE,
            tickLower: 60n * (MIN_TICK / 60n),
            tickUpper: 60n * (MAX_TICK / 60n),
            amount0Desired: wethBalance,
            amount1Desired: usdcBalance,
            amount0Min: 0,
            amount1Min: 0,
            recipient: maker.address,
            deadline: ethers.constants.MaxUint256,
          })
          .then((tx) => tx.wait())
          .then((receipt) => {
            const event = receipt.events?.find(
              (event) => event.topics[0] === INCREASE_LIQUIDITY_EVENT_SIGNATURE
            );
              const tokenId = event?.topics[1];
            //   console.log(event!)
            if (!tokenId) return "0";
            return tokenId;
            // return "0"
          });
    };
    const miningFee = async (num:number) => {
      await deposit(WETH, parseEther("10").toBigInt());
      for (let i = 0; i < num; i++) {
        
        await doExactInput(
          WETH,
          USDC,
          (await getBalance(WETH)).toBigInt(),
          ROUTER
        );
        
        await doExactInput(
          USDC,
          WETH,
          (await getBalance(USDC)).toBigInt(),
          ROUTER
        );
      }
      await burn(WETH, (await getBalance(WETH)).toBigInt());
      
    };

});

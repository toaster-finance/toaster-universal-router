import { mine, reset, setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { INonfungiblePositionManager, UniV3FusionToaster } from "../typechain-types";
import { ethers } from "hardhat";
import { burn, deposit } from "../utils/weth";
import { parseEther, parseUnits } from "ethers/lib/utils";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { approveMax, doExactInput, doExactOutput, getBalance } from "../utils/erc20";
import { ADDRESS } from "./const/address.const";
import { RESET } from "./const/reset.const";
import { TICK } from "./const/tick.const";
import { EVENT_SIGNATURE } from "./const/signature.const";
import { getMakingAmount } from "../scripts/getMakingAmount";


const MAX_UINT128 = 2n**128n - 1n;
const {URL,BLOCKNUMBER} = RESET
const {MAX_TICK,MIN_TICK} = TICK
const {INCREASE_LIQUIDITY_EVENT_SIGNATURE} = EVENT_SIGNATURE
describe("Uniswap V3 Toaster Compound", () => {
    let toaster: UniV3FusionToaster;
    let maker: SignerWithAddress;
    let positionManager:INonfungiblePositionManager;
    let fee0:bigint;
    let fee1:bigint;
    const {MANAGER,FEE,FUSION,USDC,WETH,ROUTER,FACTORY} = ADDRESS;
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
        const {amount0,amount1}  = await positionManager.callStatic.collect({
          tokenId: tokenId,
          recipient: maker.address,
          amount0Max: MAX_UINT128,
          amount1Max: MAX_UINT128,
        });
        fee0 = amount0.toBigInt();
        fee1 = amount1.toBigInt();
    
        expect(fee0).to.equal(165511423513165808854n);
        expect(fee1).to.equal(300383944n);

        // Check Balance
        expect(await getBalance(WETH)).to.equal(0n);
        expect(await getBalance(USDC)).to.equal(0n);
    });
    it("Calculating Amount to Swap", () => {
      getMakingAmount({
        tickLower: 60n * (MIN_TICK / 60n),
        tickUpper: 60n * (MAX_TICK / 60n),
        token0: WETH,
        token1: USDC,
        fee: FEE,
        factoryAddr:FACTORY,
        amount0Desired: fee0,
        amount1Desired: fee1,
      })
    })
  // name: 'Uniswap V3 Positions NFT-V1', version: 'UNI-V3-POS', chainId: 42161, verifyingContract: MANAGER
    it("Make Order for Compounding Fee",async () => {
      // Calculating Amount 
      const [maker] = await ethers.getSigners();
      const nonce = await ethers.getContractAt("INonfungiblePositionManager", MANAGER).nonces(maker.address)
      const domain = {
        "name": "Uniswap V3 Positions NFT-V1",
        "version": "UNI-V3-POS",
        "chainId": 42161,
        "verifyingContract": MANAGER};

      const types = {
        "EIP712Domain": [
              {
                "name": "name",
                "type": "string"
              },
              {
                "name": "version",
                "type": "string"
              },
              {
                "name": "chainId",
                "type": "uint256"
              },
              {
                "name": "verifyingContract",
                "type": "address"
              }
            ],
        "Permit": [
            {   
              "name": "spender",
              "type": "address"
            },
            {
              "name": "tokenId",
              "type": "uint256"
            },
            {
              "name": "nonce",
              "type": "uint256"
            },
            {
              "name": "deadline",
              "type": "uint256"
            }
        ],
      };  
      const value = {
        "spender":toaster.address,
        "tokenId":963380,
        "nonce":0,
        "deadline":ethers.constants.MaxUint256
      };
      maker._signTypedData(domain, types, value)
      
      
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

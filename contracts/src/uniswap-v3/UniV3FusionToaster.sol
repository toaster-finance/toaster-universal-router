// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;
import {IPostInteractionNotificationReceiver} from "../../external/1inch/IPostInteractionNotificationReceiver.sol";
import {IPreInteractionNotificationReceiver} from "../../external/1inch/IPreInteractionNotificationReceiver.sol";
import {LiquidityAmounts} from "../../external/uniswapv3/libraries/LiquidityAmounts.sol";
import {INonfungiblePositionManager} from "../../external/uniswapv3/INonfungiblePositionManager.sol";
import {IUniswapV3Factory} from "../../external/uniswapv3/IUniswapV3Factory.sol";
import {IPeripheryImmutableState}from "../../external/uniswapv3/IPeripheryImmutableState.sol";
import {IUniswapV3PoolState} from "../../external/uniswapv3/IUniswapV3PoolState.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SqrtPriceMath,SafeCast} from "../../external/uniswapv3/libraries/SqrtPriceMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TickMath} from "../../external/uniswapv3/libraries/TickMath.sol";
import {WETH9} from "../../token/WETH9.sol";
import {IERC721Permit,IERC721} from "../../token/IERC721Permit.sol";

struct Order {
        uint256 salt;
        address makerAsset;
        address takerAsset;
        address maker;
        address receiver;
        address allowedSender;  // equals to Zero address on public orders
        uint256 makingAmount;
        uint256 takingAmount;
        uint256 offsets;
        // bytes makerAssetData;
        // bytes takerAssetData;
        // bytes getMakingAmount; // this.staticcall(abi.encodePacked(bytes, swapTakerAmount)) => (swapMakerAmount)
        // bytes getTakingAmount; // this.staticcall(abi.encodePacked(bytes, swapMakerAmount)) => (swapTakerAmount)
        // bytes predicate;       // this.staticcall(bytes) => (bool)
        // bytes permit;          // On first fill: permit.1.call(abi.encodePacked(permit.selector, permit.2))
        // bytes preInteraction;
        // bytes postInteraction;
        bytes interactions; // concat(makerAssetData, takerAssetData, getMakingAmount, getTakingAmount, predicate, permit, preIntercation, postInteraction)
}
contract UniV3FusionToaster is IPostInteractionNotificationReceiver,IPreInteractionNotificationReceiver,Ownable{
    using Math for uint256;
    uint256 constant Q96 = 1 << 96;
    uint256 constant Q192 = 1 << 192;

    mapping(bytes32 => mapping(address => uint)) public making;
    mapping(bytes32 => mapping(address => uint)) public taking;
    INonfungiblePositionManager immutable public manager;
    IUniswapV3Factory immutable public factory;
    WETH9 immutable public WETH;
    address immutable public oneInch;
    uint256 public protocolFee;

    event CancelInvest(bytes32 indexed orderHash,Order order);
    struct InteractionDataMint {
        address baseToken;
        address quoteToken;
        uint256 baseAmountDesired; // baseAmountDesired
        uint256 quoteAmountDesired; // quoteAmountDesired
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
    } 
    struct InteractionDataIncreaseLiquidity {
        uint256 tokenId;
        address makerAsset;
        uint256 baseAmountDesired; // baseAmountDesired
        uint256 quoteAmountDesired; // quoteAmountDesired
    }
    struct ActualAmountCache {
        uint256 actualAmount0;
        uint256 actualAmount1;
        uint256 amount0Result;
        uint256 amount1Result;
        uint256 surplus0;
        uint256 surplus1;
    }
    constructor(address _manager,address _oneInch) Ownable(msg.sender){
        manager = INonfungiblePositionManager(_manager);
        factory = IUniswapV3Factory(IPeripheryImmutableState(_manager).factory());
        WETH = WETH9(payable(IPeripheryImmutableState(_manager).WETH9()));
        oneInch = _oneInch; 
    }
    // native token not supported
    /**
     * fusion mode
     * @param orderHash orderHash
     * @param maker maker
     * @param makingAmount makingAmount
     * @param takingAmount takingAmount
     * @param remainingAmount remainingAmount
     * @param interactionData introduction data
     * @dev interactionData = abi.encode(isCompound,baseToken, quoteToken, fee, tickLower, tickUpper, baseAmountDesired, quoteAmountDesired,) or abi.encode(isHarvest,tokenId,makerAsset,baseAmountDesired, quoteAmountDesired)
     * if user want to invest 5 WETH & 1000 USDC, baseAmountDesired = 5 WETH, quoteAmountDesired = 1000 USDC
     */
    function fillOrderPostInteraction(bytes32 orderHash, address maker, address, uint256 makingAmount, uint256 takingAmount, uint256 remainingAmount, bytes memory interactionData) override external {
        
        (bool isCompund) = abi.decode(interactionData, (bool));
        if(!isCompund) { // for mint & rebalance order 
            InteractionDataMint memory data;
            ActualAmountCache memory cache;
            ( , data.baseToken, data.quoteToken,data.fee, data.tickLower, data.tickUpper,data.baseAmountDesired, data.quoteAmountDesired) = abi.decode(
                interactionData,
                (bool, address, address, uint24, int24, int24, uint, uint)
            );
        
            if (remainingAmount > 0) {
                taking[orderHash][data.quoteToken] += takingAmount;
                making[orderHash][data.baseToken] += makingAmount;
                return;
            }
            // if remaining amount = 0, pull token
            uint makingAmountTotal = making[orderHash][data.baseToken] + makingAmount;
            uint takingAmountTotal = taking[orderHash][data.quoteToken] + takingAmount;
            making[orderHash][data.baseToken] = 0;
            taking[orderHash][data.quoteToken] = 0;
            {   
                uint baseAmountToPull = data.baseAmountDesired - makingAmountTotal;
                uint quoteAmountToPull = data.quoteAmountDesired;

                if(baseAmountToPull > 0) SafeERC20.safeTransferFrom(IERC20(data.baseToken), maker, address(this), baseAmountToPull);
                if(quoteAmountToPull > 0) SafeERC20.safeTransferFrom(IERC20(data.quoteToken), maker, address(this), quoteAmountToPull);

                SafeERC20.forceApprove(IERC20(data.baseToken), address(manager), baseAmountToPull);
                SafeERC20.forceApprove(IERC20(data.quoteToken), address(manager), data.quoteAmountDesired + takingAmountTotal);
            } 
           
            // mint position
            {
                (cache.actualAmount0, cache.actualAmount1) = (data.baseToken < data.quoteToken) ? (data.baseAmountDesired - makingAmountTotal,data.quoteAmountDesired + takingAmountTotal) : (data.quoteAmountDesired + takingAmountTotal,data.baseAmountDesired - makingAmountTotal);
                ( , ,cache.amount0Result,cache.amount1Result) = manager.mint(INonfungiblePositionManager.MintParams({
                    token0: (data.baseToken < data.quoteToken) ? data.baseToken: data.quoteToken,
                    token1: (data.baseToken < data.quoteToken) ? data.quoteToken: data.baseToken, 
                    fee: data.fee,
                    tickLower: data.tickLower,
                    tickUpper: data.tickUpper,
                    amount0Desired: cache.actualAmount0,
                    amount1Desired: cache.actualAmount1,
                    amount0Min: 0,
                    amount1Min: 0,
                    recipient: maker,
                    deadline: block.timestamp
                }));
                unchecked {
                    (cache.surplus0,cache.surplus1) = ((cache.actualAmount0 - cache.amount0Result),(cache.actualAmount1 - cache.amount1Result));
                }
            }

            // if surplus > 0, return surplus to maker
            if(cache.surplus0 > 0 ) SafeERC20.safeTransfer(IERC20(data.quoteToken < data.baseToken ? data.quoteToken : data.baseToken), maker, cache.surplus0);
            if(cache.surplus1 > 0) SafeERC20.safeTransfer(IERC20(data.quoteToken < data.baseToken ? data.baseToken : data.quoteToken), maker, cache.surplus1);   
            
            
            //Reset Approval
            SafeERC20.forceApprove(IERC20(data.baseToken), address(manager), 0);
            SafeERC20.forceApprove(IERC20(data.quoteToken), address(manager), 0);

        } else { // for compound order
            InteractionDataIncreaseLiquidity memory data;
            
            ( ,data.tokenId,data.makerAsset,data.baseAmountDesired, data.quoteAmountDesired) = abi.decode(interactionData,(bool,uint256,address,uint256,uint256));
            address takerAsset; 
            {
                (,,address token0,address token1,,,,,,,,) = manager.positions(data.tokenId);
                takerAsset = (data.makerAsset == token0) ? token1 : token0;
            }

            if (remainingAmount > 0) {
                taking[orderHash][takerAsset] += takingAmount;
                making[orderHash][data.makerAsset] += makingAmount;
                return;
            }

            uint makingAmountTotal = making[orderHash][data.makerAsset] + makingAmount;
            uint takingAmountTotal = taking[orderHash][takerAsset] + takingAmount;
            making[orderHash][data.makerAsset] = 0;
            taking[orderHash][takerAsset] = 0;

            SafeERC20.forceApprove(IERC20(data.makerAsset), address(manager), data.baseAmountDesired - makingAmountTotal);
            SafeERC20.forceApprove(IERC20(takerAsset), address(manager), data.quoteAmountDesired + takingAmountTotal);
            uint surplus0;
            uint surplus1;
            {
                (uint actualAmount0, uint actualAmount1) = (data.makerAsset < takerAsset) ? (data.baseAmountDesired - makingAmountTotal,data.quoteAmountDesired + takingAmountTotal) : (data.quoteAmountDesired + takingAmountTotal,data.baseAmountDesired - makingAmountTotal);

                ( ,uint _amount0Result,uint _amount1Result) = manager.increaseLiquidity(INonfungiblePositionManager.IncreaseLiquidityParams({
                    tokenId: data.tokenId,
                    amount0Desired: actualAmount0,
                    amount1Desired: actualAmount1,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp
                }));
                unchecked {
                    (surplus0,surplus1) = (actualAmount0 - _amount0Result,actualAmount1 - _amount1Result);
                }
            }

            // if surplus > 0, return surplus to maker , it will be always quoteToken
            if(surplus0 > 0) SafeERC20.safeTransfer(IERC20(data.makerAsset), maker, surplus0);
            if(surplus1 > 0) SafeERC20.safeTransfer(IERC20(takerAsset), maker, surplus1);
            
            //Reset Approval
            SafeERC20.forceApprove(IERC20(data.makerAsset), address(manager), 0);
            SafeERC20.forceApprove(IERC20(takerAsset), address(manager), 0);
            
        }
        
    }


    function cancelInvest(Order memory order,bytes32 orderHash) external {
        require(order.maker == msg.sender,"INVALID_MAKER");
        uint _makerAmount = making[orderHash][order.makerAsset];
        making[orderHash][order.makerAsset] = 0;
        taking[orderHash][order.takerAsset] = 0;

        IERC20(order.makerAsset).transfer(order.maker,_makerAmount);

        emit CancelInvest(orderHash,order);
    }


    struct PreInteractionCache {
        uint tokenId;
        bool isCompound;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    // if user allowance of token0, token1  < amount0, amount1, user should call permit first
    function fillOrderPreInteraction(
        bytes32 orderHash,
        address maker,
        address taker,
        uint256 makingAmount,
        uint256 takingAmount,
        uint256 remainingAmount,
        bytes memory interactionData // abi.encode(isCompound,tokenId,v,r,s)
    ) external {
        PreInteractionCache memory cache;
        (cache.isCompound,cache.tokenId,cache.v,cache.r,cache.s)
        = abi.decode(interactionData,(bool,uint256,uint8,bytes32,bytes32));
        ( , ,address token0,address token1,,,,,,,, )= manager.positions(cache.tokenId);
        
        if(cache.isCompound) { // for compound order
            (uint collectAmount0, uint collectAmount1) = _harvest(cache.tokenId, maker, cache.v, cache.r, cache.s);
            IERC20(token0).transfer(maker,collectAmount0);
            IERC20(token1).transfer(maker,collectAmount1);
        } else { // for rebalance order
            (uint withdrawAmount0, uint withdrawAmount1) = _withdrawPosition(cache.tokenId, maker, cache.v, cache.r, cache.s);
            IERC20(token0).transfer(maker,withdrawAmount0);
            IERC20(token1).transfer(maker,withdrawAmount1);
        }  
    }


    //ERC721 : keccak256("Permit(address spender,uint256 tokenId,uint256 nonce,uint256 deadline)")
    function _harvest(
        uint256 tokenId,
        address user,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal returns (uint collectAmount0, uint collectAmount1){
        IERC721Permit(address(manager)).permit(address(this),tokenId,block.timestamp,v,r,s);

        IERC721(address(manager)).safeTransferFrom(user,address(this),tokenId);

        ( collectAmount0, collectAmount1)= manager.collect(INonfungiblePositionManager.CollectParams({
            tokenId:tokenId,
            recipient: user,
            amount0Max: type(uint128).max,
            amount1Max: type(uint128).max
        }));

        IERC721(address(manager)).safeTransferFrom(address(this),user,tokenId);

    }
    function _withdrawPosition(
       uint256 tokenId,
       address user,
       uint8 v,
       bytes32 r,
       bytes32 s
    ) internal returns(uint collectAmount0, uint collectAmount1 ){
        IERC721Permit(address(manager)).permit(address(this),tokenId,block.timestamp,v,r,s);

        IERC721(address(manager)).safeTransferFrom(user,address(this),tokenId);

        manager.decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams({
            tokenId:tokenId,
            liquidity:type(uint128).max,
            amount0Min: 0,
            amount1Min: 0,
            deadline:block.timestamp
        }));

        (collectAmount0, collectAmount1)= manager.collect(INonfungiblePositionManager.CollectParams({
            tokenId:tokenId,
            recipient: user,
            amount0Max: type(uint128).max,
            amount1Max: type(uint128).max
        }));

        IERC721(address(manager)).safeTransferFrom(address(this),user,tokenId);
    }


    function setProtocolFee(uint256 _fee) external onlyOwner {
        protocolFee = _fee;
    }
}
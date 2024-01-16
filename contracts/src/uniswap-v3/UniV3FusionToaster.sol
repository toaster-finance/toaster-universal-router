// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;
import {IPostInteractionNotificationReceiver} from "../../external/1inch/IPostInteractionNotificationReceiver.sol";
import {IPreInteractionNotificationReceiver} from "../../external/1inch/IPreInteractionNotificationReceiver.sol";
import {LiquidityAmounts} from "../../external/uniswapv3/libraries/LiquidityAmounts.sol";
import {INonfungiblePositionManager} from "../../external/uniswapv3/INonfungiblePositionManager.sol";
import {IUniswapV3Factory} from "../../external/uniswapv3/IUniswapV3Factory.sol";
import {IPeripheryImmutableState}from "../../external/uniswapv3/IPeripheryImmutableState.sol";
import {IUniswapV3PoolState} from "../../external/uniswapv3/IUniswapV3PoolState.sol";
import {IUniswapV3PoolImmutables} from "../../external/uniswapv3/IUniswapV3PoolImmutables.sol";
import {IUniswapV3PoolActions} from "../../external/uniswapv3/IUniswapV3PoolActions.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SqrtPriceMath,SafeCast} from "../../external/uniswapv3/libraries/SqrtPriceMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ZapOneTickSpacing} from "../libraries/ZapOneTickSpacing.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TickMath} from "../../external/uniswapv3/libraries/TickMath.sol";
import {WETH9} from "../../token/WETH9.sol";
import {IERC721Permit,IERC721} from "../../token/IERC721Permit.sol";
import {IUniV3FusionToaster,Order} from "../interfaces/IUniV3FusionToaster.sol";

//           PreInteractionData                 |     PostInteractionData
//   mint            X                          |            O (isCompound = false)
// rebalance         O(isCompound = false)      |            O (isCompound = false)
// compound          O(isCompound = true)       |            O (isCompound = true)
// collect           O((isCompound = true)      |            X
contract UniV3FusionToaster is IPostInteractionNotificationReceiver,IPreInteractionNotificationReceiver,Ownable,IUniV3FusionToaster {
    using Math for uint256;

    mapping(bytes32 => mapping(address => uint)) public making;
    mapping(bytes32 => mapping(address => uint)) public taking;
    mapping(bytes32 => bool) public isWithdrawn;
    INonfungiblePositionManager immutable public manager;
    IUniswapV3Factory immutable public factory;
    WETH9 immutable public WETH;
    address immutable public oneInch;
    uint256 public protocolFee;
    error InvalidOrder();
    
    error InvalidMaker();
    error InvalidCallback();

    event CancelInvest(bytes32 indexed orderHash,Order order);
  
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
     * @dev interactionData = abi.encode(false,baseToken, quoteToken, fee, tickLower, tickUpper, baseAmountDesired, quoteAmountDesired,): mint/rebalance or abi.encode(true,tokenId,makerAsset,baseAmountDesired, quoteAmountDesired):compound
     * if user want to invest 5 WETH & 1000 USDC, making 1WETH to USDC by resolver,baseAmountDesired = 5 WETH, quoteAmountDesired = 1000 USDC
     */
    function fillOrderPostInteraction(bytes32 orderHash, address maker, address, uint256 makingAmount, uint256 takingAmount, uint256 remainingAmount, bytes memory interactionData) override external {
        
        (bool isCompund) = abi.decode(interactionData, (bool));
        ActualAmountCache memory cache;
        if(!isCompund) { // for mint & rebalance order 
            InteractionDataMint memory data;
            ( , data.baseToken, data.quoteToken,data.fee, data.tickLower, data.tickUpper,data.baseAmountDesired, data.quoteAmountDesired) = abi.decode(
                interactionData,
                (bool, address, address, uint24, int24, int24, uint, uint)
            );
        
            if (remainingAmount > 0) {
                taking[orderHash][data.quoteToken] += takingAmount;
                making[orderHash][data.baseToken] += makingAmount;
                return;
            }
            {
                // if remaining amount = 0, pull token
                uint makingAmountTotal = making[orderHash][data.baseToken] + makingAmount;
                uint takingAmountTotal = taking[orderHash][data.quoteToken] + takingAmount;
                //TODO: check whether if the remove statement is necessary
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
                    (cache.amount0In, cache.amount1In) = (data.baseToken < data.quoteToken) ? (data.baseAmountDesired - makingAmountTotal,data.quoteAmountDesired + takingAmountTotal) : (data.quoteAmountDesired + takingAmountTotal,data.baseAmountDesired - makingAmountTotal);
                    // zap on uniswap v3 one tickspacing
                    // Assuming there are only enough swaps to keep the current price from tickspacing out. Otherwise, return all remaining tokens to the user after minting.
                    ZapOneTickSpacing.zapOnOneTickSpacing(cache,factory,data.quoteToken,data.baseToken,data.fee);
                    ( , ,cache.amount0InResult,cache.amount1InResult) = manager.mint(INonfungiblePositionManager.MintParams({
                        token0: (data.baseToken < data.quoteToken) ? data.baseToken: data.quoteToken,
                        token1: (data.baseToken < data.quoteToken) ? data.quoteToken: data.baseToken, 
                        fee: data.fee,
                        tickLower: data.tickLower,
                        tickUpper: data.tickUpper,
                        amount0Desired: cache.amount0In,
                        amount1Desired: cache.amount1In,
                        amount0Min: 0,
                        amount1Min: 0,
                        recipient: maker,
                        deadline: block.timestamp
                    }));

                }
            }
            {
                uint surplus0;
                uint surplus1;
                unchecked {
                    (surplus0,surplus1) = ((cache.amount0In - cache.amount0InResult),(cache.amount1In - cache.amount1InResult));
                }
                // if surplus > 0, return surplus to maker
                if(surplus0 > 0 ) SafeERC20.safeTransfer(IERC20(data.quoteToken < data.baseToken ? data.quoteToken : data.baseToken), maker, surplus0);
                if(surplus1 > 0) SafeERC20.safeTransfer(IERC20(data.quoteToken < data.baseToken ? data.baseToken : data.quoteToken), maker, surplus1);   
            
            }
            //Reset Approval
            SafeERC20.forceApprove(IERC20(data.baseToken), address(manager), 0);
            SafeERC20.forceApprove(IERC20(data.quoteToken), address(manager), 0);

        } else { // for compound order
            InteractionDataIncreaseLiquidity memory data;
            ( ,data.tokenId,data.makerAsset,data.baseAmountDesired, data.quoteAmountDesired) = abi.decode(interactionData,(bool,uint256,address,uint256,uint256));
            uint24 fee;
            {   
                address _token0;
                address _token1;
                (,,_token0,_token1,fee,,,,,,,) = manager.positions(data.tokenId);
                data.takerAsset = (data.makerAsset == _token0) ? _token1 : _token0;
            }
            if (remainingAmount > 0) {
                taking[orderHash][data.takerAsset] += takingAmount;
                making[orderHash][data.makerAsset] += makingAmount;
                return;
            }
            {
                uint makingAmountTotal = making[orderHash][data.makerAsset] + makingAmount;
                uint takingAmountTotal = taking[orderHash][data.takerAsset] + takingAmount;
                //TODO: check whether if the remove statement is necessary
                making[orderHash][data.makerAsset] = 0;
                taking[orderHash][data.takerAsset] = 0;

                SafeERC20.forceApprove(IERC20(data.makerAsset), address(manager), data.baseAmountDesired - makingAmountTotal);
                SafeERC20.forceApprove(IERC20(data.takerAsset), address(manager), data.quoteAmountDesired + takingAmountTotal);

                
                (cache.amount0In, cache.amount1In) = (data.makerAsset < data.takerAsset) ? (data.baseAmountDesired - makingAmountTotal,data.quoteAmountDesired + takingAmountTotal) : (data.quoteAmountDesired + takingAmountTotal,data.baseAmountDesired - makingAmountTotal);
                // zap on uniswap v3 one tickspacing
                // Assuming there are only enough swaps to keep the current price from tickspacing out. Otherwise, return all remaining tokens to the user after minting. 
                ZapOneTickSpacing.zapOnOneTickSpacing(cache,factory,data.takerAsset,data.makerAsset,fee);
                ( ,cache.amount0InResult,cache.amount1InResult) = manager.increaseLiquidity(INonfungiblePositionManager.IncreaseLiquidityParams({
                    tokenId: data.tokenId,
                    amount0Desired: cache.amount0In,
                    amount1Desired: cache.amount1In,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp
                }));

                
            }
            {
                uint surplus0;
                uint surplus1;
                unchecked {
                    (surplus0,surplus1) = (cache.amount0In - cache.amount0InResult,cache.amount1In - cache.amount1InResult);
                }
                // if surplus > 0, return surplus to maker , it will be always quoteToken
                if(surplus0 > 0) SafeERC20.safeTransfer(IERC20(data.makerAsset), maker, surplus0);
                if(surplus1 > 0) SafeERC20.safeTransfer(IERC20(data.takerAsset), maker, surplus1);
            }
            //Reset Approval
            SafeERC20.forceApprove(IERC20(data.makerAsset), address(manager), 0);
            SafeERC20.forceApprove(IERC20(data.takerAsset), address(manager), 0);
            
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

    // if user allowance of token0, token1  < amount0, amount1, user should call permit first
    function fillOrderPreInteraction(
        bytes32 orderHash,
        address maker,
        address,
        uint256,
        uint256,
        uint256,
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
            if(isWithdrawn[orderHash]) return;
            (uint withdrawAmount0, uint withdrawAmount1) = _withdrawPosition(cache.tokenId, maker, cache.v, cache.r, cache.s);
            IERC20(token0).transfer(maker,withdrawAmount0);
            IERC20(token1).transfer(maker,withdrawAmount1);
            isWithdrawn[orderHash] = true;
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

        (collectAmount0, collectAmount1)= manager.collect(INonfungiblePositionManager.CollectParams({
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

    
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata _data
    ) external  {
        require(amount0Delta > 0 || amount1Delta > 0); // swaps entirely within 0-liquidity regions are not supported
        (address tokenIn, address tokenOut, uint24 fee) = abi.decode(_data, (address, address, uint24)); // it has only one pool on path
        {
            address pool =factory.getPool(tokenIn, tokenOut, fee); 
            if(pool != msg.sender) revert InvalidCallback();
        }
        (bool isExactInput, uint256 amountToPay) =
            amount0Delta > 0
                ? (tokenIn < tokenOut, uint256(amount0Delta))
                : (tokenOut < tokenIn, uint256(amount1Delta));
        if (isExactInput) {
            SafeERC20.safeTransfer(IERC20(tokenIn), msg.sender, amountToPay);
        }
    }

    
    function setProtocolFee(uint256 _fee) external onlyOwner {
        protocolFee = _fee;
    }
}
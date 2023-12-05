// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;
import {IPostInteractionNotificationReceiver} from "../external/1inch/IPostInteractionNotificationReceiver.sol";
import {LiquidityAmounts} from "../external/uniswapv3/libraries/LiquidityAmounts.sol";
import {INonfungiblePositionManager} from "../external/uniswapv3/INonfungiblePositionManager.sol";
import {IUniswapV3Factory} from "../external/uniswapv3/IUniswapV3Factory.sol";
import {IPeripheryImmutableState}from "../external/uniswapv3/IPeripheryImmutableState.sol";
import {IUniswapV3PoolState} from "../external/uniswapv3/IUniswapV3PoolState.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SqrtPriceMath} from "../external/uniswapv3/libraries/SqrtPriceMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "../external/uniswapv3/libraries/TickMath.sol";
import {WETH9} from "../token/WETH9.sol";
import "hardhat/console.sol";
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
contract UniV3Toaster is IPostInteractionNotificationReceiver{
    using Math for uint256;
    uint256 constant Q96 = 1 << 96;
    uint256 constant Q192 = 1 << 192;

    mapping(bytes32 => mapping(address => uint)) public making;
    mapping(bytes32 => mapping(address => uint)) public taking;
    INonfungiblePositionManager immutable public manager;
    IUniswapV3Factory immutable public factory;
    WETH9 immutable public WETH;
    address immutable public oneInch;
    
    
    struct ActualAmountCache {
        uint256 baseAmount; // : baseAmountDesired - makingAmount
        uint256 quoteAmount; // : quoteAmountDesired + (takingAmount)
        uint256 baseAmountResult; // : Result baseAmount
        uint256 quoteAmountResult; // : Result quoteAmount
    }
    struct PositionCache {
        address baseToken;
        address quoteToken;
        uint256 baseAmountDesired; // baseAmountDesired
        uint256 quoteAmountDesired; // quoteAmountDesired
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
    } 
    constructor(address _manager,address _oneInch) {
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
     * @dev interactionData = abi.encode(baseToken, quoteToken, baseAmountDesired, quoteAmountDesired, fee, tickLower, tickUpper)
     * if user want to invest 5 WETH & 1000 USDC, baseAmountDesired = 5 WETH, quoteAmountDesired = 1000 USDC
     */
    function fillOrderPostInteraction(bytes32 orderHash, address maker, address, uint256 makingAmount, uint256 takingAmount, uint256 remainingAmount, bytes memory interactionData) override external {
        ActualAmountCache memory actual;
        PositionCache memory position;
        (position.baseToken, position.quoteToken,position.baseAmountDesired, position.quoteAmountDesired,position.fee, position.tickLower, position.tickUpper) = abi.decode(
            interactionData,
            (address, address,uint, uint, uint24,int24, int24)
        );

        if (remainingAmount > 0) {
            taking[orderHash][position.quoteToken] += takingAmount;
            making[orderHash][position.baseToken] += makingAmount;
            return;
        }
        {

            uint makingAmountTotal = making[orderHash][position.baseToken] + makingAmount;
            uint takingAmountTotal = taking[orderHash][position.quoteToken] + takingAmount;
            taking[orderHash][position.quoteToken] = 0;
            making[orderHash][position.baseToken] = 0;
            console.log("baseAmountDesired", position.baseAmountDesired);
            console.log("quoteAmountDesired", position.quoteAmountDesired);
            console.log("makingAmountTotal", makingAmountTotal);
            console.log("takingAmountTotal", takingAmountTotal);
            // calculate actual amount of base, quote token to pull
            actual.baseAmount = position.baseAmountDesired - makingAmountTotal;
            console.log("actual.baseAmount before calc", actual.baseAmount);

            actual.quoteAmount = position.quoteAmountDesired + takingAmountTotal;
            console.log("actual.quoteAmount before calc", actual.quoteAmount);

            calculateActualAmount(position, actual);
        } 

        SafeERC20.safeTransferFrom(IERC20(position.baseToken), maker, address(this), actual.baseAmount);
        SafeERC20.safeTransferFrom(IERC20(position.quoteToken), maker, address(this), actual.quoteAmount);

        SafeERC20.forceApprove(IERC20(position.baseToken), address(manager), actual.baseAmount);
        SafeERC20.forceApprove(IERC20(position.quoteToken), address(manager), actual.quoteAmount);

        console.log("actual.baseAmount after calc", actual.baseAmount);
        console.log("actual.quoteAmount after calc", actual.quoteAmount);
       
        {
            bool isBaseZero = (position.baseToken < position.quoteToken);
            // mint position 
            ( , ,uint _amount0Result,uint _amount1Result) = manager.mint(INonfungiblePositionManager.MintParams({
                token0: isBaseZero ? position.baseToken: position.quoteToken,
                token1: isBaseZero ? position.quoteToken: position.baseToken, 
                fee: position.fee,
                tickLower: position.tickLower,
                tickUpper: position.tickUpper,
                amount0Desired: isBaseZero ? actual.baseAmount : actual.quoteAmount,
                amount1Desired: isBaseZero ? actual.quoteAmount : actual.baseAmount,
                amount0Min: 0,
                amount1Min: 0,
                recipient: maker,
                deadline: block.timestamp
            }));
            (actual.baseAmount,actual.quoteAmount) = (position.baseToken < position.quoteToken) ? 
                (actual.baseAmount - _amount0Result,actual.quoteAmount - _amount1Result):
                (actual.baseAmount - _amount1Result,actual.quoteAmount - _amount0Result);

        }
        if(position.baseToken != address(WETH)) {
            // if surplus > 0, return surplus to maker , it will be always baseToken
            SafeERC20.safeTransfer(IERC20(position.baseToken), maker, actual.baseAmount);
        } else if(position.baseToken == address(WETH)){
            unwrapWETH9(actual.baseAmount, maker);
        }
        if(position.quoteToken != address(WETH)) {
            // if surplus > 0, return surplus to maker , it will be always quoteToken
            SafeERC20.safeTransfer(IERC20(position.quoteToken), maker, actual.quoteAmount);
        } else if(position.quoteToken == address(WETH)){
            unwrapWETH9(actual.quoteAmount, maker);
        }
        //Reset Approval
        SafeERC20.forceApprove(IERC20(position.baseToken), address(manager), 0);
        SafeERC20.forceApprove(IERC20(position.quoteToken), address(manager), 0);
    }
    function calculateActualAmount(PositionCache memory position, ActualAmountCache memory actual) internal view {
        
        // calculate acutal baseAmount from actual quoteAmount
        uint _baseAmount = getOppTokenAmount(position.tickLower,position.tickUpper,position.quoteToken, position.baseToken, position.fee, actual.quoteAmount);

        console.log("_baseAmount", _baseAmount);
        if( _baseAmount > actual.baseAmount ) {
            // if actual.baseAmount is not enough for minting
            // calculate quoteAmount from actual baseAmount
            actual.quoteAmount = getOppTokenAmount(position.tickLower, position.tickUpper, position.baseToken , position.quoteToken, position.fee, actual.baseAmount);
            console.log("_quoteAmount", actual.quoteAmount);
        } else actual.baseAmount = _baseAmount;

        
    }
    function getOppTokenAmount(int24 tickLower, int24 tickUpper,address self, address opp, uint24 fee, uint256 selfAmount) internal view returns(uint256 oppAmount){ 

        (uint160 sqrtRatioCX96,,,,,,) = IUniswapV3PoolState(factory.getPool(self, opp, fee)).slot0();

        uint160 sqrtRatioLX96 = TickMath.getSqrtRatioAtTick(tickLower);

        uint160 sqrtRatioUX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        bool isSelfZero = self < opp;

        uint128 _liquidity = isSelfZero ? LiquidityAmounts.getLiquidityForAmount0(sqrtRatioCX96, sqrtRatioUX96, selfAmount): LiquidityAmounts.getLiquidityForAmount1(sqrtRatioLX96, sqrtRatioCX96, selfAmount);

        oppAmount = isSelfZero ? SqrtPriceMath.getAmount1Delta(sqrtRatioCX96, sqrtRatioUX96,_liquidity ,true) : SqrtPriceMath.getAmount0Delta(sqrtRatioLX96, sqrtRatioCX96, _liquidity,true);
    }

    function unwrapWETH9(uint256 value,address to) internal {
        WETH.withdraw(value);
        (bool success, ) = to.call{value: value}(new bytes(0));
        require(success, 'STE');
    }
    // function cancelOrder(Order order,bytes32 orderHash,address token) external {
    //     require(order.maker == msg.sender,"INVALID_MAKER");
    //     balances[order][msg.sender] = 0;
    // }

    // function compoundFee(
    //     uint8 v,
    //     bytes32 r,
    //     bytes32 s
    // )

    // function rebalancing(
    //     uint8 v,
    //     bytes32 r,
    //     bytes32 s
    // )


    // function setProtocolFee(uint256 fee) external onlyOwner {}
}
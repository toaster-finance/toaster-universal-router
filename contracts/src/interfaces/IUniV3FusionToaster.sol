// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;
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
interface IUniV3FusionToaster {

    struct InteractionDataMint {
        address makerAsset;
        address takerAsset;
        uint256 baseAmountDesired; // baseAmountDesired
        uint256 quoteAmountDesired; // quoteAmountDesired
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
    } 
    struct InteractionDataIncreaseLiquidity {
        uint256 tokenId;
        address makerAsset;
        address takerAsset;
        uint256 baseAmountDesired; // baseAmountDesired
        uint256 quoteAmountDesired; // quoteAmountDesired
    }
    struct ActualAmountCache {
        address token0;
        address token1;
        uint256 amount0In;
        uint256 amount1In;
        uint256 amount0InResult;
        uint256 amount1InResult;
    }


    struct PreInteractionCache {
        uint tokenId;
        bool isCompound;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
}
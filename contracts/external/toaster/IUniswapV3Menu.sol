// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity >=0.7.6;
pragma abicoder v2;
import "../uniswapv3/INonfungiblePositionManager.sol";

interface IUniswapV3Menu {
    function total(
        INonfungiblePositionManager positionManager,
        uint256 tokenId,
        uint160 sqrtRatioX96
    ) external view returns (uint256 amount0, uint256 amount1);

    function principal(
        INonfungiblePositionManager positionManager,
        uint256 tokenId,
        uint160 sqrtRatioX96
    ) external view returns (uint256 amount0, uint256 amount1);

    function fees(
        INonfungiblePositionManager positionManager,
        uint256 tokenId
    ) external view returns (uint256 amount0, uint256 amount1);
}

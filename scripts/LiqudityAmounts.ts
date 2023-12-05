export class LiquidityAmounts {
    private static readonly Q96 = 1n << 96n;
    public static getLiquidityForAmount0 = (_sqrtRatioAX96 : bigint, _sqrtRatioBX96:bigint, amount0:bigint) => {
        let sqrtRatioAX96 = _sqrtRatioAX96;
        let sqrtRatioBX96 = _sqrtRatioBX96;
        if (sqrtRatioAX96 > sqrtRatioBX96) [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
        const intermediate = sqrtRatioAX96 * sqrtRatioBX96 / this.Q96;
        return (amount0 * intermediate) / (sqrtRatioBX96 - sqrtRatioAX96);
    }

    public static getLiquidityForAmount1 = (_sqrtRatioAX96: bigint, _sqrtRatioBX96: bigint, amount1: bigint) => { 
        let sqrtRatioAX96 = _sqrtRatioAX96;
        let sqrtRatioBX96 = _sqrtRatioBX96;
        if (sqrtRatioAX96 > sqrtRatioBX96) [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
        return (amount1 * this.Q96) / (sqrtRatioBX96 - sqrtRatioAX96);
    }
}
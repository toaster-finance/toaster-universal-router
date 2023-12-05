export class SqrtPriceMath {
  public static readonly Q96 = 2n ** 96n;
  public static readonly RESOLUTION = 96n;

  private static divRoundingUp(x: bigint, y: bigint): bigint {
    const result = x / y;
    return x % y > 0n ? result : result + 1n;
  }
  private static mulDivRoundingUp(x: bigint, y: bigint, z: bigint): bigint {
    const result = (x * y) / z;
    if (result % z === 0n) return result;
    return result + 1n;
  }

  private static mulDiv(x: bigint, y: bigint, z: bigint): bigint {
    return (x * y) / z;
  }
  public static getAmount0Delta(
    sqrtRatioAX96: bigint,
    sqrtRatioBX96: bigint,
    liquidity: bigint,
    roundUp: boolean
  ): bigint {
    if (sqrtRatioAX96 > sqrtRatioBX96)
      throw new Error("sqrtRatioAX96 must be less than sqrtRatioBX96");

    const numerator1 = liquidity << this.RESOLUTION;
    const numerator2 = sqrtRatioBX96 - sqrtRatioAX96;

    return roundUp
      ? this.divRoundingUp(
          this.mulDivRoundingUp(numerator1, numerator2, sqrtRatioBX96),
          sqrtRatioAX96
        )
      : this.mulDiv(numerator1, numerator2, sqrtRatioBX96) / sqrtRatioAX96;
  }
  public static getAmount1Delta(
    sqrtRatioAX96: bigint,
    sqrtRatioBX96: bigint,
    liquidity: bigint,
    roundUp: boolean
  ): bigint {
    if (sqrtRatioAX96 > sqrtRatioBX96)
      throw new Error("sqrtRatioAX96 must be less than sqrtRatioBX96");

    return roundUp
      ? this.mulDivRoundingUp(
          liquidity,
          sqrtRatioBX96 - sqrtRatioAX96,
          this.Q96
        )
      : this.mulDiv(liquidity, sqrtRatioBX96 - sqrtRatioAX96, this.Q96);
  }
}
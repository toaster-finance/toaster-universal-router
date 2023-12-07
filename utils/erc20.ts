import { BigNumber } from "ethers";
import { ethers} from "hardhat";

const ROUTER_ABI: any[] = [
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "tokenIn", type: "address" },
          { internalType: "address", name: "tokenOut", type: "address" },
          { internalType: "uint24", name: "fee", type: "uint24" },
          { internalType: "address", name: "recipient", type: "address" },
          { internalType: "uint256", name: "amountIn", type: "uint256" },
          {
            internalType: "uint256",
            name: "amountOutMinimum",
            type: "uint256",
          },
          {
            internalType: "uint160",
            name: "sqrtPriceLimitX96",
            type: "uint160",
          },
        ],
        internalType: "struct IV3SwapRouter.ExactInputSingleParams",
        name: "params",
        type: "tuple",
      },
    ],
    name: "exactInputSingle",
    outputs: [{ internalType: "uint256", name: "amountOut", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "tokenIn",
            type: "address",
          },
          {
            internalType: "address",
            name: "tokenOut",
            type: "address",
          },
          {
            internalType: "uint24",
            name: "fee",
            type: "uint24",
          },
          {
            internalType: "address",
            name: "recipient",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "amountOut",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "amountInMaximum",
            type: "uint256",
          },
          {
            internalType: "uint160",
            name: "sqrtPriceLimitX96",
            type: "uint160",
          },
        ],
        internalType: "struct IV3SwapRouter.ExactOutputSingleParams",
        name: "params",
        type: "tuple",
      },
    ],
    name: "exactOutputSingle",
    outputs: [
      {
        internalType: "uint256",
        name: "amountIn",
        type: "uint256",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
];
export const approve = async (
  tokenAddr: `0x${string}`,
  amount: bigint,
  spender: `0x${string}`,
  owner?:`0x${string}`,
) => {
  
  const token = await ethers.getContractAt("IERC20", tokenAddr);
  if (owner) {
    const ownerSigner = await ethers.getSigner(owner);
    await token.connect(ownerSigner).approve(spender, amount);
  } else {
    await token.approve(spender, amount);
  }
};

export const approveMax = async (
  tokenAddr: string,
  spender: string,
  owner?: string,
) => {
  
  const token= await ethers.getContractAt("IERC20", tokenAddr);
  const signer = owner ? await ethers.getSigner(owner) :(await ethers.getSigners())[0];

  const allowance = await token.connect(signer).allowance(signer.address, spender);
  if (allowance != ethers.constants.MaxUint256) {
    await token.connect(signer).approve(spender, 0);
    return token.connect(signer).approve(spender, ethers.constants.MaxUint256.toBigInt() - 1n)

  }
};

export const getBalance = async (tokenAddr: string,owner?:string) :Promise<BigNumber>=> {
  const token = await ethers.getContractAt("IERC20", tokenAddr);
  if (owner) {
    
    return token.balanceOf(owner);
  }
  const [signer] = await ethers.getSigners();
  return token.balanceOf(signer.address);
};
export const doExactOutput = async (
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountOut: bigint,
  routerAddr: `0x${string}`,
  to? : string
) => {

  const router = await ethers.getContractAt(ROUTER_ABI, routerAddr);
  const [signer] = await ethers.getSigners();
  
  await approveMax(tokenIn, routerAddr);

  return router.exactOutputSingle({
    tokenIn,
    tokenOut,
    fee: 3000,
    recipient: to ? to : signer.address,
    amountOut,
    amountInMaximum: ethers.constants.MaxUint256.toBigInt(),
    sqrtPriceLimitX96: 0,
  });
};

export const doExactInput = async (
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: bigint,
  routerAddr: `0x${string}`,
  to?: string
) => {
  const router = await ethers.getContractAt(ROUTER_ABI, routerAddr);
  const [signer] = await ethers.getSigners();
  await approveMax(tokenIn, routerAddr);
  
  return router.exactOutputSingle({
    tokenIn,
    tokenOut,
    fee: 3000,
    recipient: to ? to : signer.address,
    amountIn,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0,
  });
};

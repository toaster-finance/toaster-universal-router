import { ethers } from "hardhat";
import { WETH9 } from "../typechain-types";

export const deposit = async (weth:`0x${string}`,amount:bigint) => {
    const wethContract:WETH9 = await ethers.getContractAt("WETH9", weth);
    await wethContract.deposit({ value: amount }).then((tx) => tx.wait());
}

export const withdraw = async (weth: `0x${string}`, amount: bigint) => { 
    const wethContract = await ethers.getContractAt("WETH9", weth);
    await wethContract.withdraw(amount).then((tx) => tx.wait());
}

export const depositAndTransferTo = async (weth: `0x${string}`, amount: bigint,to:`0x${string}`) => {
  const wethContract: WETH9 = await ethers.getContractAt("WETH9", weth);
    await wethContract.deposit({ value: amount }).then((tx) => tx.wait());
    await wethContract.transfer(to,amount).then((tx) => tx.wait());
};
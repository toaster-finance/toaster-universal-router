/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
import type {
  BaseContract,
  BigNumberish,
  BytesLike,
  FunctionFragment,
  Result,
  Interface,
  AddressLike,
  ContractRunner,
  ContractMethod,
  Listener,
} from "ethers";
import type {
  TypedContractEvent,
  TypedDeferredTopicFilter,
  TypedEventLog,
  TypedListener,
  TypedContractMethod,
} from "../../../../common";

export declare namespace IApproveAndCall {
  export type IncreaseLiquidityParamsStruct = {
    token0: AddressLike;
    token1: AddressLike;
    tokenId: BigNumberish;
    amount0Min: BigNumberish;
    amount1Min: BigNumberish;
  };

  export type IncreaseLiquidityParamsStructOutput = [
    token0: string,
    token1: string,
    tokenId: bigint,
    amount0Min: bigint,
    amount1Min: bigint
  ] & {
    token0: string;
    token1: string;
    tokenId: bigint;
    amount0Min: bigint;
    amount1Min: bigint;
  };

  export type MintParamsStruct = {
    token0: AddressLike;
    token1: AddressLike;
    fee: BigNumberish;
    tickLower: BigNumberish;
    tickUpper: BigNumberish;
    amount0Min: BigNumberish;
    amount1Min: BigNumberish;
    recipient: AddressLike;
  };

  export type MintParamsStructOutput = [
    token0: string,
    token1: string,
    fee: bigint,
    tickLower: bigint,
    tickUpper: bigint,
    amount0Min: bigint,
    amount1Min: bigint,
    recipient: string
  ] & {
    token0: string;
    token1: string;
    fee: bigint;
    tickLower: bigint;
    tickUpper: bigint;
    amount0Min: bigint;
    amount1Min: bigint;
    recipient: string;
  };
}

export interface IApproveAndCallInterface extends Interface {
  getFunction(
    nameOrSignature:
      | "approveMax"
      | "approveMaxMinusOne"
      | "approveZeroThenMax"
      | "approveZeroThenMaxMinusOne"
      | "callPositionManager"
      | "getApprovalType"
      | "increaseLiquidity"
      | "mint"
  ): FunctionFragment;

  encodeFunctionData(
    functionFragment: "approveMax",
    values: [AddressLike]
  ): string;
  encodeFunctionData(
    functionFragment: "approveMaxMinusOne",
    values: [AddressLike]
  ): string;
  encodeFunctionData(
    functionFragment: "approveZeroThenMax",
    values: [AddressLike]
  ): string;
  encodeFunctionData(
    functionFragment: "approveZeroThenMaxMinusOne",
    values: [AddressLike]
  ): string;
  encodeFunctionData(
    functionFragment: "callPositionManager",
    values: [BytesLike]
  ): string;
  encodeFunctionData(
    functionFragment: "getApprovalType",
    values: [AddressLike, BigNumberish]
  ): string;
  encodeFunctionData(
    functionFragment: "increaseLiquidity",
    values: [IApproveAndCall.IncreaseLiquidityParamsStruct]
  ): string;
  encodeFunctionData(
    functionFragment: "mint",
    values: [IApproveAndCall.MintParamsStruct]
  ): string;

  decodeFunctionResult(functionFragment: "approveMax", data: BytesLike): Result;
  decodeFunctionResult(
    functionFragment: "approveMaxMinusOne",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "approveZeroThenMax",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "approveZeroThenMaxMinusOne",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "callPositionManager",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "getApprovalType",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "increaseLiquidity",
    data: BytesLike
  ): Result;
  decodeFunctionResult(functionFragment: "mint", data: BytesLike): Result;
}

export interface IApproveAndCall extends BaseContract {
  connect(runner?: ContractRunner | null): IApproveAndCall;
  waitForDeployment(): Promise<this>;

  interface: IApproveAndCallInterface;

  queryFilter<TCEvent extends TypedContractEvent>(
    event: TCEvent,
    fromBlockOrBlockhash?: string | number | undefined,
    toBlock?: string | number | undefined
  ): Promise<Array<TypedEventLog<TCEvent>>>;
  queryFilter<TCEvent extends TypedContractEvent>(
    filter: TypedDeferredTopicFilter<TCEvent>,
    fromBlockOrBlockhash?: string | number | undefined,
    toBlock?: string | number | undefined
  ): Promise<Array<TypedEventLog<TCEvent>>>;

  on<TCEvent extends TypedContractEvent>(
    event: TCEvent,
    listener: TypedListener<TCEvent>
  ): Promise<this>;
  on<TCEvent extends TypedContractEvent>(
    filter: TypedDeferredTopicFilter<TCEvent>,
    listener: TypedListener<TCEvent>
  ): Promise<this>;

  once<TCEvent extends TypedContractEvent>(
    event: TCEvent,
    listener: TypedListener<TCEvent>
  ): Promise<this>;
  once<TCEvent extends TypedContractEvent>(
    filter: TypedDeferredTopicFilter<TCEvent>,
    listener: TypedListener<TCEvent>
  ): Promise<this>;

  listeners<TCEvent extends TypedContractEvent>(
    event: TCEvent
  ): Promise<Array<TypedListener<TCEvent>>>;
  listeners(eventName?: string): Promise<Array<Listener>>;
  removeAllListeners<TCEvent extends TypedContractEvent>(
    event?: TCEvent
  ): Promise<this>;

  approveMax: TypedContractMethod<[token: AddressLike], [void], "payable">;

  approveMaxMinusOne: TypedContractMethod<
    [token: AddressLike],
    [void],
    "payable"
  >;

  approveZeroThenMax: TypedContractMethod<
    [token: AddressLike],
    [void],
    "payable"
  >;

  approveZeroThenMaxMinusOne: TypedContractMethod<
    [token: AddressLike],
    [void],
    "payable"
  >;

  callPositionManager: TypedContractMethod<
    [data: BytesLike],
    [string],
    "payable"
  >;

  getApprovalType: TypedContractMethod<
    [token: AddressLike, amount: BigNumberish],
    [bigint],
    "nonpayable"
  >;

  increaseLiquidity: TypedContractMethod<
    [params: IApproveAndCall.IncreaseLiquidityParamsStruct],
    [string],
    "payable"
  >;

  mint: TypedContractMethod<
    [params: IApproveAndCall.MintParamsStruct],
    [string],
    "payable"
  >;

  getFunction<T extends ContractMethod = ContractMethod>(
    key: string | FunctionFragment
  ): T;

  getFunction(
    nameOrSignature: "approveMax"
  ): TypedContractMethod<[token: AddressLike], [void], "payable">;
  getFunction(
    nameOrSignature: "approveMaxMinusOne"
  ): TypedContractMethod<[token: AddressLike], [void], "payable">;
  getFunction(
    nameOrSignature: "approveZeroThenMax"
  ): TypedContractMethod<[token: AddressLike], [void], "payable">;
  getFunction(
    nameOrSignature: "approveZeroThenMaxMinusOne"
  ): TypedContractMethod<[token: AddressLike], [void], "payable">;
  getFunction(
    nameOrSignature: "callPositionManager"
  ): TypedContractMethod<[data: BytesLike], [string], "payable">;
  getFunction(
    nameOrSignature: "getApprovalType"
  ): TypedContractMethod<
    [token: AddressLike, amount: BigNumberish],
    [bigint],
    "nonpayable"
  >;
  getFunction(
    nameOrSignature: "increaseLiquidity"
  ): TypedContractMethod<
    [params: IApproveAndCall.IncreaseLiquidityParamsStruct],
    [string],
    "payable"
  >;
  getFunction(
    nameOrSignature: "mint"
  ): TypedContractMethod<
    [params: IApproveAndCall.MintParamsStruct],
    [string],
    "payable"
  >;

  filters: {};
}
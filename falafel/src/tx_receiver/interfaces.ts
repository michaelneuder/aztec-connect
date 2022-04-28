import { ProofData } from '@aztec/barretenberg/client_proofs';

export interface Tx {
  proof: ProofData;
  offchainTxData: Buffer;
  depositSignature?: Buffer;
}

export interface TxGroupValidation {
  hasFeelessTxs: boolean;
  feePayingAsset: number;
  gasRequired: bigint;
  gasProvided: bigint;
}

#!/usr/bin/env node
import { ethers, Signer } from 'ethers';
import { NonceManager } from '@ethersproject/experimental';
import { deployDev } from './deploy_dev';
import { InitHelpers, TreeInitData } from '@aztec/barretenberg/environment';
import { deployMainnet } from './deploy_mainnet';
import { deployMainnetE2e } from './deploy_mainnet_e2e';
import { EthAddress } from '@aztec/barretenberg/address';

// Assume these env vars could be set to ''.
// Default values will not be picked up as '' !== undefined.
const { ETHEREUM_HOST, PRIVATE_KEY, VK, FAUCET_OPERATOR } = process.env;

function getSigner() {
  if (!ETHEREUM_HOST) {
    throw new Error('ETHEREUM_HOST not set.');
  }
  console.error(`Json rpc provider: ${ETHEREUM_HOST}`);
  const provider = new ethers.providers.JsonRpcProvider(ETHEREUM_HOST);
  const signer = PRIVATE_KEY ? (new ethers.Wallet(PRIVATE_KEY, provider) as Signer) : provider.getSigner(0);
  return new NonceManager(signer);
}

function deploy(chainId: number, signer: Signer, treeInitData: TreeInitData, vk: string, faucetOperator?: EthAddress) {
  switch (chainId) {
    case 1:
    case 0xa57ec:
      return deployMainnet(signer, treeInitData, vk, faucetOperator);
    case 0xe2e:
    case 0x7a69:
      return deployMainnetE2e(signer, treeInitData, vk, faucetOperator);
    default:
      return deployDev(signer, treeInitData, vk, faucetOperator);
  }
}

/**
 * We add gasLimit to all txs, to prevent calls to estimateGas that may fail. If a gasLimit is provided the calldata
 * is simply produced, there is nothing to fail. As long as all the txs are executed by the evm in order, things
 * should succeed. The NonceManager ensures all the txs have sequentially increasing nonces.
 * In some cases there maybe a "deployment sync point" which is required if we are making a "call" to the blockchain
 * straight after, that assumes the state is up-to-date at that point.
 * This drastically improves deployment times.
 */
async function main() {
  const signer = getSigner();

  const signerAddress = await signer.getAddress();
  console.error(`Signer: ${signerAddress}`);

  const chainId = await signer.getChainId();
  console.error(`Chain id: ${chainId}`);

  const faucetOperator = FAUCET_OPERATOR ? EthAddress.fromString(FAUCET_OPERATOR) : undefined;
  console.error(`Faucet operator: ${faucetOperator}`);

  const treeInitData = InitHelpers.getInitData(chainId);
  const { dataTreeSize, roots } = treeInitData;
  console.error(`Initial data size: ${dataTreeSize}`);
  console.error(`Initial data root: ${roots.dataRoot.toString('hex')}`);
  console.error(`Initial null root: ${roots.nullRoot.toString('hex')}`);
  console.error(`Initial root root: ${roots.rootsRoot.toString('hex')}`);

  const vk = VK ? VK : 'MockVerificationKey';
  const { rollup, priceFeeds, feeDistributor, permitHelper, faucet } = await deploy(
    chainId,
    signer,
    treeInitData,
    vk,
    faucetOperator,
  );

  const envVars = {
    ROLLUP_CONTRACT_ADDRESS: rollup.address,
    PERMIT_HELPER_CONTRACT_ADDRESS: permitHelper.address,
    FEE_DISTRIBUTOR_ADDRESS: feeDistributor.address,
    PRICE_FEED_CONTRACT_ADDRESSES: priceFeeds.map(p => p).join(','),
    FAUCET_CONTRACT_ADDRESS: faucet.address,
  };

  for (const [k, v] of Object.entries(envVars)) {
    console.log(`export ${k}=${v}`);
    console.log(`export TF_VAR_${k}=${v}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

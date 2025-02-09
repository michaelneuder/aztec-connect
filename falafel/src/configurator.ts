import { mkdirpSync, pathExistsSync, readJsonSync, writeJsonSync } from 'fs-extra';
import { dirname } from 'path';
import {
  RuntimeConfig,
  bridgeConfigFromJson,
  bridgeConfigToJson,
  privacySetsFromJson,
  privacySetsToJson,
  getDefaultPrivacySets,
} from '@aztec/barretenberg/rollup_provider';
import { EthAddress } from '@aztec/barretenberg/address';

interface StartupConfig {
  port: number;
  dbUrl?: string;
  rollupContractAddress: EthAddress;
  permitHelperContractAddress: EthAddress;
  priceFeedContractAddresses: EthAddress[];
  ethereumHost: string;
  ethereumPollInterval?: number;
  proofGeneratorMode: string;
  privateKey: Buffer;
  numInnerRollupTxs: number;
  numOuterRollupProofs: number;
  apiPrefix: string;
  serverAuthToken: string;
  minConfirmation: number;
  minConfirmationEHW: number;
  typeOrmLogging: boolean;
  proverless: boolean;
  rollupCallDataLimit: number;
}

export interface ConfVars extends StartupConfig {
  runtimeConfig: RuntimeConfig;
}

const defaultStartupConfig: StartupConfig = {
  port: 8081,
  rollupContractAddress: EthAddress.ZERO,
  permitHelperContractAddress: EthAddress.ZERO,
  priceFeedContractAddresses: [],
  ethereumHost: 'http://localhost:8546',
  ethereumPollInterval: 10000,
  proofGeneratorMode: 'normal',
  // Test mnemonic account 0.
  privateKey: Buffer.from('ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', 'hex'),
  numInnerRollupTxs: 1,
  numOuterRollupProofs: 1,
  minConfirmation: 1,
  minConfirmationEHW: 12,
  apiPrefix: '',
  serverAuthToken: '!changeme#',
  typeOrmLogging: false,
  proverless: false,
  rollupCallDataLimit: 120 * 1024,
};

const defaultRuntimeConfig: RuntimeConfig = {
  acceptingTxs: true,
  useKeyCache: false,
  publishInterval: 0,
  flushAfterIdle: 0,
  gasLimit: 12000000,
  verificationGas: 500000,
  maxFeeGasPrice: 250000000000n, // 250 gwei
  feeGasPriceMultiplier: 1,
  feeRoundUpSignificantFigures: 2,
  maxFeePerGas: 250000000000n, // 250 gwei
  maxPriorityFeePerGas: 2500000000n, // 2.5 gwei
  maxUnsettledTxs: 10000,
  defaultDeFiBatchSize: 5,
  bridgeConfigs: [],
  feePayingAssetIds: [0],
  privacySets: getDefaultPrivacySets(),
  depositLimit: 10,
  blacklist: [],
};

function getStartupConfigEnvVars(): Partial<StartupConfig> {
  const {
    DB_URL,
    ROLLUP_CONTRACT_ADDRESS,
    PERMIT_HELPER_CONTRACT_ADDRESS,
    PRICE_FEED_CONTRACT_ADDRESSES,
    ETHEREUM_HOST,
    ETHEREUM_POLL_INTERVAL,
    PROOF_GENERATOR_MODE,
    PRIVATE_KEY,
    PORT,
    NUM_INNER_ROLLUP_TXS,
    NUM_OUTER_ROLLUP_PROOFS,
    MIN_CONFIRMATION,
    MIN_CONFIRMATION_ESCAPE_HATCH_WINDOW,
    API_PREFIX,
    PROVERLESS,
    TYPEORM_LOGGING,
    SERVER_AUTH_TOKEN,
    CALL_DATA_LIMIT_KB,
  } = process.env;

  const envVars: Partial<StartupConfig> = {
    port: PORT ? +PORT : undefined,
    dbUrl: DB_URL,
    rollupContractAddress: ROLLUP_CONTRACT_ADDRESS ? EthAddress.fromString(ROLLUP_CONTRACT_ADDRESS) : undefined,
    permitHelperContractAddress: PERMIT_HELPER_CONTRACT_ADDRESS
      ? EthAddress.fromString(PERMIT_HELPER_CONTRACT_ADDRESS)
      : undefined,
    priceFeedContractAddresses: PRICE_FEED_CONTRACT_ADDRESSES
      ? PRICE_FEED_CONTRACT_ADDRESSES.split(',').map(EthAddress.fromString)
      : undefined,
    ethereumHost: ETHEREUM_HOST,
    ethereumPollInterval: ETHEREUM_POLL_INTERVAL ? +ETHEREUM_POLL_INTERVAL : undefined,
    proofGeneratorMode: PROOF_GENERATOR_MODE,
    privateKey: PRIVATE_KEY ? Buffer.from(PRIVATE_KEY.replace('0x', ''), 'hex') : undefined,
    numInnerRollupTxs: NUM_INNER_ROLLUP_TXS ? +NUM_INNER_ROLLUP_TXS : undefined,
    numOuterRollupProofs: NUM_OUTER_ROLLUP_PROOFS ? +NUM_OUTER_ROLLUP_PROOFS : undefined,
    minConfirmation: MIN_CONFIRMATION ? +MIN_CONFIRMATION : undefined,
    minConfirmationEHW: MIN_CONFIRMATION_ESCAPE_HATCH_WINDOW ? +MIN_CONFIRMATION_ESCAPE_HATCH_WINDOW : undefined,
    apiPrefix: API_PREFIX,
    typeOrmLogging: TYPEORM_LOGGING ? TYPEORM_LOGGING === 'true' : undefined,
    proverless: PROVERLESS ? PROVERLESS === 'true' : undefined,
    serverAuthToken: SERVER_AUTH_TOKEN,
    rollupCallDataLimit: CALL_DATA_LIMIT_KB ? +CALL_DATA_LIMIT_KB * 1024 : undefined,
  };
  return Object.fromEntries(Object.entries(envVars).filter(e => e[1] !== undefined));
}

function getRuntimeConfigEnvVars(): Partial<RuntimeConfig> {
  const {
    FEE_GAS_PRICE_MULTIPLIER,
    PUBLISH_INTERVAL,
    FLUSH_AFTER_IDLE,
    DEFAULT_DEFI_BATCH_SIZE,
    FEE_PAYING_ASSET_IDS,
    FEE_DISTRIBUTOR_ADDRESS,
  } = process.env;

  const envVars = {
    publishInterval: PUBLISH_INTERVAL ? +PUBLISH_INTERVAL : undefined,
    flushAfterIdle: FLUSH_AFTER_IDLE ? +FLUSH_AFTER_IDLE : undefined,
    feeGasPriceMultiplier: FEE_GAS_PRICE_MULTIPLIER ? +FEE_GAS_PRICE_MULTIPLIER : undefined,
    defaultDeFiBatchSize: DEFAULT_DEFI_BATCH_SIZE ? +DEFAULT_DEFI_BATCH_SIZE : undefined,
    feePayingAssetIds: FEE_PAYING_ASSET_IDS ? FEE_PAYING_ASSET_IDS.split(',').map(id => +id) : undefined,
    rollupBeneficiary: FEE_DISTRIBUTOR_ADDRESS ? EthAddress.fromString(FEE_DISTRIBUTOR_ADDRESS) : undefined,
  };
  return Object.fromEntries(Object.entries(envVars).filter(e => e[1] !== undefined));
}

export class Configurator {
  private confVars!: ConfVars;
  private rollupContractChanged = false;

  /**
   * Builds a launch time configuration from environment variables.
   * If it exists, loads a previous instances configuration from disk.
   * If the rollup contract has changed, empty the entire data dir.
   * Update the configuration with the saved runtime configuration (if it exists).
   * Save the new configuration to disk.
   */
  constructor(private confPath = './data/config') {
    const dir = dirname(this.confPath);
    mkdirpSync(dir);

    const startupConfigEnvVars = getStartupConfigEnvVars();
    const runtimeConfigEnvVars = getRuntimeConfigEnvVars();

    if (pathExistsSync(this.confPath)) {
      // Erase all data if rollup contract changes.
      const saved: ConfVars = this.readConfigFile(this.confPath);
      const { rollupContractAddress } = startupConfigEnvVars;
      if (rollupContractAddress && !rollupContractAddress.equals(saved.rollupContractAddress)) {
        console.log(
          `Rollup contract changed: ${saved.rollupContractAddress.toString()} -> ${rollupContractAddress.toString()}`,
        );
        this.rollupContractChanged = true;
      }

      // Priorities:
      // StartupConfig: Environment, saved, defaults.
      // RuntimeConfig: Saved, Environment, defaults.
      const { runtimeConfig: savedRuntimeConfig, ...savedStartupConfig } = saved;
      this.confVars = {
        ...defaultStartupConfig,
        ...savedStartupConfig,
        ...startupConfigEnvVars,
        runtimeConfig: {
          ...defaultRuntimeConfig,
          ...runtimeConfigEnvVars,
          ...savedRuntimeConfig,
        },
      };
    } else {
      // Priorities:
      // StartupConfig: Environment, defaults.
      // RuntimeConfig: Environment, defaults.
      this.confVars = {
        ...defaultStartupConfig,
        ...startupConfigEnvVars,
        runtimeConfig: {
          ...defaultRuntimeConfig,
          ...runtimeConfigEnvVars,
        },
      };
    }

    this.writeConfigFile(this.confPath, this.confVars);
  }

  public getConfVars() {
    return this.confVars;
  }

  public getRollupContractChanged() {
    return this.rollupContractChanged;
  }

  public saveRuntimeConfig(runtimeConfig: Partial<RuntimeConfig>) {
    const prevRuntimeConfig = this.confVars.runtimeConfig;
    this.confVars = {
      ...this.confVars,
      runtimeConfig: {
        ...prevRuntimeConfig,
        ...runtimeConfig,
      },
    };
    this.writeConfigFile(this.confPath, this.confVars);
  }

  /**
   * Loads configuration from file.
   */
  private readConfigFile(path: string): ConfVars {
    const conf = readJsonSync(path);
    return {
      ...conf,
      rollupContractAddress: EthAddress.fromString(conf.rollupContractAddress),
      permitHelperContractAddress: conf.permitHelperContractAddress
        ? EthAddress.fromString(conf.permitHelperContractAddress)
        : undefined,
      priceFeedContractAddresses: conf.priceFeedContractAddresses.map(EthAddress.fromString),
      privateKey: Buffer.from(conf.privateKey, 'hex'),
      runtimeConfig: {
        ...conf.runtimeConfig,
        maxFeeGasPrice: BigInt(conf.runtimeConfig.maxFeeGasPrice),
        maxFeePerGas: BigInt(conf.runtimeConfig.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(conf.runtimeConfig.maxPriorityFeePerGas),
        bridgeConfigs: conf.runtimeConfig.bridgeConfigs.map(bridgeConfigFromJson),
        privacySets: privacySetsFromJson(conf.runtimeConfig.privacySets),
        rollupBeneficiary: conf.runtimeConfig.rollupBeneficiary
          ? EthAddress.fromString(conf.runtimeConfig.rollupBeneficiary)
          : undefined,
        blacklist: conf.runtimeConfig.blacklist
          ? conf.runtimeConfig.blacklist.map((x: string) => EthAddress.fromString(x))
          : [],
      },
    };
  }

  /**
   * Saves configuration to file. Sets acceptingTxs to true, as it's assumed if the system is restarted,
   * we want to accept txs again when ready.
   */
  private writeConfigFile(path: string, conf: ConfVars) {
    writeJsonSync(path, {
      ...conf,
      rollupContractAddress: conf.rollupContractAddress.toString(),
      permitHelperContractAddress: conf.permitHelperContractAddress
        ? conf.permitHelperContractAddress.toString()
        : undefined,
      priceFeedContractAddresses: conf.priceFeedContractAddresses.map(a => a.toString()),
      privateKey: conf.privateKey.toString('hex'),
      runtimeConfig: {
        ...conf.runtimeConfig,
        acceptingTxs: true,
        maxFeeGasPrice: conf.runtimeConfig.maxFeeGasPrice.toString(),
        maxFeePerGas: conf.runtimeConfig.maxFeePerGas.toString(),
        maxPriorityFeePerGas: conf.runtimeConfig.maxPriorityFeePerGas.toString(),
        bridgeConfigs: conf.runtimeConfig.bridgeConfigs.map(bridgeConfigToJson),
        privacySets: privacySetsToJson(conf.runtimeConfig.privacySets),
        rollupBeneficiary: conf.runtimeConfig.rollupBeneficiary
          ? conf.runtimeConfig.rollupBeneficiary.toString()
          : undefined,
        blacklist: conf.runtimeConfig.blacklist
          ? conf.runtimeConfig.blacklist.map((x: EthAddress) => x.toString())
          : [],
      },
    });
  }
}

import {
  isMobileApp,
  isProduction
}                             from '@eternl/store/appInfoStore'

const doLog                   = false

if (doLog) { console.warn('setup: useOneKeyDevice') }

import OneKeySDK              from '@onekeyfe/hd-common-connect-sdk'

import {
  UI_EVENT,
  DEVICE_EVENT,
  FIRMWARE_EVENT,
  UI_REQUEST,
  UI_RESPONSE,
  CoreMessage,
  CommonParams,
  ConnectSettings,
  CardanoSignTransaction,
  CardanoSignedTxData
}                             from '@onekeyfe/hd-core'

import {
  ONEKEY_WEBUSB_FILTER
}                             from '@onekeyfe/hd-shared'

import {
  CardanoAddressType,
  CardanoDerivationType,
  CardanoDRepType,
  CardanoCertificateType,
  CardanoPoolRelayType,
  CardanoTxOutputSerializationFormat,
  CardanoTxSigningMode,
  CardanoCVoteRegistrationFormat,
  LowlevelTransportSharedPlugin
}                             from '@onekeyfe/hd-transport'

import {
  OneKeyCapacitorBluetooth
}                             from './capacitor/OneKeyCapacitorBluetooth'

type CardanoInput             = CardanoSignTransaction['inputs'][number]
type CardanoCollateralInput   = Exclude<CardanoSignTransaction['collateralInputs'], undefined>[number]
type CardanoOutput            = CardanoSignTransaction['outputs'][number]
type CardanoRequiredSigners   = Exclude<CardanoSignTransaction['requiredSigners'], undefined>
type CardanoAddressParameters = Pick<Extract<CardanoOutput, { addressParameters: any }>, 'addressParameters'>['addressParameters']
type CardanoAssetGroup        = Exclude<Pick<Extract<CardanoOutput, { address: any }>, 'tokenBundle'>['tokenBundle'], undefined>[number]
type CardanoToken             = CardanoAssetGroup['tokenAmounts'][number]
type CardanoWithdrawal        = Exclude<CardanoSignTransaction['withdrawals'], undefined>[number]
type CardanoCertificate       = Exclude<CardanoSignTransaction['certificates'], undefined>[number]
type CardanoAuxiliaryData     = Exclude<CardanoSignTransaction['auxiliaryData'], undefined>
type CardanoPoolRelay         = Exclude<CardanoCertificate['poolParameters'], undefined>['relays'][number]
type CardanoSignMessageMethodParams = {
  path:                       string
  message:                    string
  derivationType:             number
  networkId:                  number
  addressType?:               CardanoAddressType
}

type LowLevelAdapter = {
  enumerate:                  () => Promise<Array<{ id: string; name: string }>>  // scan and return device list
  connect:                    (id: string) => Promise<void>                       // open connection and set up listeners
  disconnect:                 (id: string) => Promise<void>                       // close connection and cleanup
  send:                       (id: string, data: string) => Promise<void>         // send hex-encoded payload
  receive:                    () => Promise<string>                               // receive one frame (hex); JS reassembles full message
  init?:                      () => Promise<void>                                 // optional adapter init
  version:                    string
};

import { purpose }            from '@eternl/constant/chain'

import { getNetworkId }       from '@eternl/core/NetworkId'
import { ICreds }             from '@eternl/core/ICreds'
import { IAppAccount }        from '@eternl/core/IAppWallet'
import { IAccountDBData }     from '@eternl/core/IAccount'
import { IUtxo }              from '@eternl/core/IUtxo'

import {
  Address,
  AuxiliaryData,
  BigNum,
  CertificateKind,
  CertificatesJSON,
  Ed25519KeyHashesJSON,
  FixedTransaction,
  GeneralTransactionMetadata,
  MetadataJsonSchema,
  MintJSON,
  MultiAssetJSON,
  MultiHostNameJSON,
  PoolRegistrationJSON,
  SingleHostAddrJSON,
  SingleHostNameJSON,
  StakeDelegationJSON,
  StakeDeregistrationJSON,
  StakeRegistrationJSON,
  Transaction,
  TransactionInputsJSON,
  TransactionOutputJSON,
  TransactionWitnessSet,
  Vkeywitnesses,
  VoteDelegationJSON,
  WithdrawalsJSON,
  decode_metadatum_to_json_str,
  hash_auxiliary_data,
  hash_transaction,
}                             from '@eternl/types/csl'
import {
  ITransactionJSON,
  OutputData
}                             from '@eternl/types/tx/ITransactionJSON'
import { IBuiltTxResult }     from '@eternl/types/tx/IBuiltTxResult'
import { DataSignature }      from '@eternl/types/dapp/DAppConnectorAPI'

import { ErrorSignTx }        from '@eternl/error/ErrorSignTx'

import {
  toBufferFromArray,
  toHexString
}                             from '@eternl/lib/base/hex'
import { blake2b256Str }      from '@eternl/lib/base/blake'
import {
  isScriptStakeAddress
}                             from '@eternl/lib/address'
import { getNetworkMagic }    from '@eternl/lib/chain'
import {
  getAccountKeyDetails,
  getOwnedCred
}                             from '@eternl/lib/account'
import {
  getAddressCredentials
}                             from '@eternl/lib/csl/address'
import {
  getStringDerivationPath
}                             from '@eternl/lib/csl/derivation'
import {
  getVkeyWitness
}                             from '@eternl/lib/csl/key'
import {
  cslToJson,
  getPlutusHVB,
  getTransactionJSONFromCSL
}                             from '@eternl/lib/csl/json'
import { safeFreeCSLObject }  from '@eternl/lib/csl/memory'
import { CertificateTypes }   from '@eternl/lib/csl/certificate'

import { ISignedTx }          from '@eternl/lib/tx/build/sign'
import { hasWitness }         from '@eternl/lib/tx/build/lib'
import {
  reinjectVkeywitnesses
}                             from '@eternl/lib/tx/build/fixedTx'
import {
  addCatalystRegistrationSignature,
  generateCatalystRegistration,
  getCatalystRegistrationMetadata,
  isCatalystVotingRegistrationMetadata
}                             from '@eternl/lib/catalyst'

import {
  getFilteredUtxoList
}                             from '@eternl/store/utxoList'

import { checkEpochParams }   from '@eternl/store/epochParams'

let isInitialized             = false
let passphrase                = ''

const commonParams            = <CommonParams>{

  deriveCardano:              true

  // keepSession?: boolean;      // The Session persists after executing the API method.
  // retryCount?: number;        // The number of retries when the device is connected, default is 6.
  // pollIntervalTime?: number;  // The interval time for polling when the device is connected, default is 1000 ms,
  //                             // each polling will increase the time by 1.5 times.
  // timeout?: number;           // The timeout of the connection polling.
  // passphraseState?: string;   // If you want to use a passphrase wallet, please pass that parameter.
  //                             // We will validate and cache the passphrase to optimize the user experience of entering
  //                             // the passphrase and reduce the number of input attempts. To retrieve that parameter,
  //                             // please call the getPassphraseState method.
  // useEmptyPassphrase?: boolean;
  //                             // Allow the creation of a passphrase wallet with an empty value.
  // initSession?: boolean;      // Cache the passphraseState parameter.
  // deriveCardano?: boolean;    // default is set to true for all cardano related methods, otherwise it is set to false.
  //                             // This parameter determines whether device should derive cardano seed for current session.
  //                             // Derivation of cardano seed takes longer then it does for other coins.
  // detectBootloaderDevice?: boolean;
  //                             // Description missing from online docs
}

const multisigPurposePath     = getStringDerivationPath([purpose.multisig])
const mintingPurposePath      = getStringDerivationPath([purpose.minting])

export const oneKeyDerivationType = CardanoDerivationType

const getOneKeyDerivationTypeFromWalletId = (walletId: string) => {

  switch (walletId.slice(walletId.length - 1)) {

    case 't': return CardanoDerivationType.ICARUS_TREZOR
    case 'i': return CardanoDerivationType.ICARUS
    case 'l': return CardanoDerivationType.LEDGER
    default:  return CardanoDerivationType.ICARUS
  }
}

const setupEventHandlers      =       () => {

  OneKeySDK.on(UI_EVENT, (message: CoreMessage) => {

    if (doLog) { console.log('useOneKeyDevice: UI_EVENT: ', message) }

    // Handle the PIN code input event
    if (message.type === UI_REQUEST.REQUEST_PIN) {

      // Opt 1. Enter the PIN code on the device
      OneKeySDK.uiResponse({

        type:                 UI_RESPONSE.RECEIVE_PIN,
        payload:              '@@ONEKEY_INPUT_PIN_IN_DEVICE',
      })

      // Opt 2. Eternl handling pin code input
      // Pseudocode
      // showUIprompts(confirm: (pin) => {
      //
      //   // Tell the hardware ui request processing result
      //   OneKeySDK.uiResponse({
      //
      //     type:               UI_RESPONSE.RECEIVE_PIN,
      //     payload:            pin,
      //   })
      // })
    }

    // Handle the passphrase event
    if (message.type === UI_REQUEST.REQUEST_PASSPHRASE) {

      // Opt 1. Enter the passphrase on the device
      // OneKeySDK.uiResponse({
      //
      //   type:                 UI_RESPONSE.RECEIVE_PASSPHRASE,
      //   payload: {
      //     value:              '',
      //     passphraseOnDevice: true,
      //   }
      // })

      // Opt 2. Eternl handling passphrase input
      OneKeySDK.uiResponse({

        type:               UI_RESPONSE.RECEIVE_PASSPHRASE,
        payload: {
          value:            passphrase,
          passphraseOnDevice: false,
          // Optional: Request the hardware to cache this Passphrase for the current session.
          save:             true,
        }
      })
    }

    if (message.type === UI_REQUEST.REQUEST_BUTTON) {
      // Confirmation is required on the device, a UI prompt can be displayed
    }

    if (message.type === UI_REQUEST.CLOSE_UI_WINDOW) {
      // The method invocation is completed. You may close all UI prompts.
    }
  })

  OneKeySDK.on(DEVICE_EVENT, (message: CoreMessage) => {

    if (doLog) {
      console.log('useOneKeyDevice: DEVICE_EVENT: ', message)
    }
  })

  OneKeySDK.on(FIRMWARE_EVENT, (message: CoreMessage) => {

    if (doLog) {
      console.log('useOneKeyDevice: FIRMWARE_EVENT: ', message)
    }
  })
}

const oneKeyInit              = async () => {

  try {

    const settings            = <Partial<ConnectSettings>>{

      debug:                  !isProduction(),
      fetchConfig:            false //true
    }

    let adapter               = <LowlevelTransportSharedPlugin | undefined>undefined

    if (isMobileApp()) {

      // Use LowLevel environment with custom Capacitor Adapter
      settings.env            = 'lowlevel'
      adapter                 = new OneKeyCapacitorBluetooth()

    } else {

      // Desktop (Web & Extension) uses WebUSB
      settings.env            = 'webusb'
    }

    const success             = await OneKeySDK.init(settings, undefined, adapter)

    if (!success)             { throw 'OneKey device initialization failed' }
    else if (doLog)           { console.log('OneKey device successfully initialized!') }

    setupEventHandlers()

    return true

  } catch (e) {

    console.error(e)
  }

  return false
}

const oneKeyDeviceSearch      = async () => {

  if (!isInitialized) {

    isInitialized             = await oneKeyInit()

    if (!isInitialized)       { throw 'OneKey device initialization failed' }
  }

  if (isMobileApp()) {

    // For mobile, the 'enumerate' call in our adapter (triggered by searchDevices)
    // already calls BleClient.requestDevice(), so we don't need extra logic here.
    // Just let it flow through to OneKeySDK.searchDevices().

  } else {

    if (typeof navigator !== 'undefined' && navigator.usb) {

      try {

        // 1. Check if we already have permission for any connected OneKey devices
        const existingDevices = await navigator.usb.getDevices()

        // Check if an existing device matches the OneKey filters
        const hasAuthorizedDevice = existingDevices.some(device =>

          ONEKEY_WEBUSB_FILTER.some(filter =>
            (filter.vendorId  === undefined || device.vendorId  === filter.vendorId) &&
            (filter.productId === undefined || device.productId === filter.productId)
          )
        )

        // 2. Only trigger the popup if we DO NOT have an authorized device connected
        if (!hasAuthorizedDevice) {

          await navigator.usb.requestDevice({ filters: ONEKEY_WEBUSB_FILTER })
        }

      } catch (e) {

        console.warn('OneKey WebUSB permission cancelled or failed:', e)
      }

    } else {

      throw 'Unable to access OneKey device, please switch to a WebUSB‑capable browser.'
    }
  }

  const response              = await OneKeySDK.searchDevices()

  if (!response?.success)     { throw response?.payload?.error ?? 'oneKeyDeviceSearch: unknown error' }

  return response.payload
}

const oneKeyDeviceInfo        = async (connectId: string) => {

  const features              = await OneKeySDK.getFeatures(connectId)

  if (!features?.success)     { throw features?.payload?.error ?? 'oneKeyDeviceInfo: getFeatures: unknown error' }

  return {

    features:                 features.payload
  }
}

const oneKeyPassphraseState   = async (connectId: string) => {

  const ppState               = await OneKeySDK.getPassphraseState(connectId, commonParams)

  if (!!ppState && !ppState.success) { throw ppState?.payload?.error ?? 'oneKeyPassphraseState: unknown error' }

  if (ppState?.payload) {

    commonParams.passphraseState = ppState.payload

  } else {

    delete commonParams.passphraseState
  }
}

const oneKeyDeviceCancelRequest = async (connectId: string) => {

  try {

    OneKeySDK.cancel(connectId)
    await OneKeySDK.deviceCancel(connectId, commonParams)

  } catch (e) {}
}

const updatePassphrase        = async (connectId: string, _passphrase: string | null) => {

  const newPassphrase         = _passphrase ?? ''

  // If the passphrase has changed, we MUST clear the previous session state.
  // Otherwise, the device will keep reusing the old wallet session.
  if (passphrase !== newPassphrase) {

    delete commonParams.passphraseState
  }

  passphrase                  = newPassphrase

       if (_passphrase === null) { delete commonParams.useEmptyPassphrase  }
  else if (_passphrase === ''  ) { commonParams.useEmptyPassphrase = true  }
  else                           { commonParams.useEmptyPassphrase = false }

  if (_passphrase) {

    // If we detected a change above and cleared the state, this call
    // will now force the device to start a fresh session for the new passphrase.
    await oneKeyPassphraseState(connectId)

  } else {

    delete commonParams.passphraseState
  }
}

const oneKeyDevicePublicKey   = async (connectId: string, deviceId: string, _passphrase: string | null, pathList: number[][], derivationType: number) => {

  await updatePassphrase(connectId, _passphrase)

  const params                = {

    ...commonParams,
    bundle:                   pathList.map(p => ({ path: getStringDerivationPath(p), derivationType, showOnOneKey: false }))
  }

  const response              = await OneKeySDK.cardanoGetPublicKey(connectId, deviceId, params)

  if (!response?.success)     { throw response?.payload?.error ?? 'oneKeyDevicePublicKey: unknown error' }

  return response.payload.map(key => key.xpub)
}

const oneKeySignTx            = async ( connectId:    string,
                                        deviceId:     string,
                                        _passphrase:  string | null,
                                        appAccount:   IAppAccount,
                                        walletId:     string,
                                        txBuildRes:   IBuiltTxResult   | null | undefined,
                                        credList:     ICreds[]         | null | undefined,
                                        moreTxFollow: boolean = false) => {

  await updatePassphrase(connectId, _passphrase)

  let cslSignedTx:            Transaction                 | undefined
  let cslWitnessSetOwned:     TransactionWitnessSet       | undefined
  let cslVkeys:               Vkeywitnesses               | undefined
  let cslCatalystMeta:        GeneralTransactionMetadata  | undefined
  let cslCatalystMetaSigned:  GeneralTransactionMetadata  | undefined

  let res:                    ISignedTx = { error: 'notExecuted' }

  try {

    if (!txBuildRes?.builtTx) { throw ErrorSignTx.missingTx }
    if (!txBuildRes?.txCbor)  { throw ErrorSignTx.missingTx }
    if (!credList)            { throw ErrorSignTx.missingKeysList }

    const networkId           = appAccount.data.state.networkId
    const epochParams         = checkEpochParams(networkId) // throws

    const oneKeySign          = await oneKeyWitnesses(

      connectId,
      deviceId,
      appAccount,
      walletId,
      txBuildRes,
      credList,
      moreTxFollow,
      false
    )

    cslWitnessSetOwned        = TransactionWitnessSet.from_hex(oneKeySign.serializedWitnessSet)

    const cslVkeysOwned       = cslWitnessSetOwned.vkeys()

    cslVkeys                  = txBuildRes.cslWitnessSet!.vkeys() ?? Vkeywitnesses.new()

    for (let i = 0; i < (cslVkeysOwned?.len() ?? 0); i++) {

      const vkeyWitness       = cslVkeysOwned!.get(i)

      if (!hasWitness(cslVkeys, vkeyWitness)) {

        cslVkeys.add(vkeyWitness)
      }

      safeFreeCSLObject(vkeyWitness)
    }

    txBuildRes.cslWitnessSet!.set_vkeys(cslVkeys)

    safeFreeCSLObject(cslVkeysOwned)

    // Check if it's a Catalyst Voting Registration and if so update metadata with catalystRegistrationSignatureHex
    if (txBuildRes.cslAuxData && isCatalystVotingRegistrationMetadata(txBuildRes.cslAuxData)) {

      if (!oneKeySign.signedTransactionData.auxiliaryDataSupplement?.cVoteRegistrationSignature) {

        throw ErrorSignTx.oneKeyCatalyst
      }

      cslCatalystMeta         = getCatalystRegistrationMetadata(txBuildRes.cslAuxData)
      cslCatalystMetaSigned   = addCatalystRegistrationSignature(
        cslCatalystMeta,
        undefined,
        oneKeySign.signedTransactionData.auxiliaryDataSupplement.cVoteRegistrationSignature
      )

      safeFreeCSLObject(txBuildRes.cslAuxData)

      txBuildRes.cslAuxData   = generateCatalystRegistration(cslCatalystMetaSigned)
      const cslAuxHash        = hash_auxiliary_data(txBuildRes.cslAuxData)

      // Update built tx catalyst metadata with signature to show proper metadata in tx preview
      txBuildRes.builtTx.auxiliary_data = cslToJson(txBuildRes.cslAuxData.to_json())

      txBuildRes.cslTxBody!.set_auxiliary_data_hash(cslAuxHash)

      let cslTxHash

      try {

        const cslFixedTx      = FixedTransaction.new_from_body_bytes(txBuildRes.cslTxBody!.to_bytes())
        cslTxHash             = cslFixedTx.transaction_hash()

        safeFreeCSLObject(cslFixedTx)

      } catch(err: any) {

        if (err === 'NOT_IMPLEMENTED') {

          console.warn('NOT_IMPLEMENTED > fallback cslTxHash')
          cslTxHash           = hash_transaction(txBuildRes.cslTxBody!)

        } else {

          throw err
        }
      }

      txBuildRes.txHash       = toHexString(cslTxHash.to_bytes())
      txBuildRes.txCbor       = null // clear original cbor to prevent re-injection after metadata hash update

      safeFreeCSLObject(cslAuxHash)
      safeFreeCSLObject(cslTxHash)
    }

    cslSignedTx               = Transaction.new(txBuildRes.cslTxBody!, txBuildRes.cslWitnessSet!, txBuildRes.cslAuxData)

    // try { txBuildRes.cslAuxData?.free?.() } catch (e) {}

    txBuildRes.cslAuxData     = cslSignedTx.auxiliary_data()

    const signedTxBytes       = cslSignedTx.to_bytes()
    const signedTxHash        = txBuildRes.txHash!
    const signedTx            = getTransactionJSONFromCSL(networkId, cslSignedTx) as ITransactionJSON
    const signedTxSize        = signedTxBytes.byteLength

    if (oneKeySign.signedTransactionData.hash !== signedTxHash) {

      console.error('OneKey tx hash:', oneKeySign.signedTransactionData.hash)
      console.error('Eternl tx hash:', signedTxHash)

      throw ErrorSignTx.oneKeyTxHashMismatch
    }

    signedTx.hash             = signedTxHash
    signedTx.size             = signedTxSize
    signedTx.inputUtxoList    = txBuildRes.builtTx.inputUtxoList

    const signedTxHex         = reinjectVkeywitnesses(txBuildRes.txCbor, toHexString(signedTxBytes), txBuildRes.cslWitnessSet!)
    const signedTxWitnessSet  = toHexString(txBuildRes.cslWitnessSet!.to_bytes())

    const maxTxSize           = epochParams.maxTxSize

    signedTx.cbor             = signedTxHex

    res                       = {

      tx:                     signedTx,
      witnessSet:             signedTxWitnessSet,
      witnessSetOwned:        oneKeySign.serializedWitnessSet
    }

    if (signedTxSize > epochParams.maxTxSize) {

      res.error               = ErrorSignTx.txSize + '.' + signedTxSize + '.' + maxTxSize
    }

  } catch (err: any) {

    res                       = { error: err?.message ?? err }
  }

  safeFreeCSLObject(cslSignedTx)
  safeFreeCSLObject(cslWitnessSetOwned)
  safeFreeCSLObject(cslVkeys)
  safeFreeCSLObject(cslCatalystMeta)
  safeFreeCSLObject(cslCatalystMetaSigned)

  if (txBuildRes) {

    txBuildRes.signedTx       = res
  }
}

const oneKeyWitnesses         = async ( connectId:    string,
                                        deviceId:     string,
                                        appAccount:   IAppAccount,
                                        walletId:     string,
                                        txBuildRes:   IBuiltTxResult,
                                        credList:     ICreds[],
                                        moreTxFollow: boolean = false,
                                        doHashCheck:  boolean = true):
  Promise<{

    serializedWitnessSet:     string,
    signedTransactionData:    CardanoSignedTxData

  }> => {

  const accountData           = appAccount.data
  const networkId             = accountData.state.networkId

  const derivationType        = getOneKeyDerivationTypeFromWalletId(walletId)

  const tx                    = txBuildRes.builtTx!

  if (tx.body.voting_proposals) {

    throw new Error('Tx contains unsupported by OneKey governance voting proposals')
  }

  let inputUtxoList           = tx.inputUtxoList

  if (!inputUtxoList) {

    const { utxoList }        = getFilteredUtxoList(appAccount, false, false, false, false)

    inputUtxoList             = utxoList
  }

  const inputs                = generateOneKeyInputs(accountData, tx.body.inputs, inputUtxoList)
  const collateralInputs      = tx.body.collateral       ? generateOneKeyInputs(accountData, tx.body.collateral,       inputUtxoList) : null
  const referenceInputs       = tx.body.reference_inputs ? generateOneKeyInputs(accountData, tx.body.reference_inputs, inputUtxoList) : null
  const additionalWitnessPaths= generateAdditionalWitnessPaths(credList, inputs, collateralInputs, true)
  const isMultiSigSigning     = additionalWitnessPaths.some(path => path.startsWith(multisigPurposePath) || path.startsWith(mintingPurposePath))
  const outputs               = generateOneKeyOutputs(accountData, tx, tx.body.outputs, false, isMultiSigSigning)

  let collateralOutput: CardanoOutput | null = null

  if (tx.body.collateral_return) {

    collateralOutput          = generateOneKeyOutputs(accountData, tx, [ tx.body.collateral_return ], true, isMultiSigSigning)[0]
  }

  let okTx: CardanoSignTransaction  = {

    signingMode:              CardanoTxSigningMode.ORDINARY_TRANSACTION,
    derivationType:           derivationType,
    protocolMagic:            getNetworkMagic(networkId),
    networkId:                getNetworkId(networkId),
    inputs,
    outputs,
    fee:                      tx.body.fee
  }

  const ttl                   = tx.body.ttl
  const donation              = tx.body.donation
  const treasury              = tx.body.current_treasury_value
  const totalCollateral       = tx.body.total_collateral
  const withdrawals           = tx.body.withdrawals
  const certificates          = tx.body.certs
  const validityStart         = tx.body.validity_start_interval
  const scriptDataHash        = tx.body.script_data_hash
  const metadataHash          = tx.body.auxiliary_data_hash
  const mint                  = tx.body.mint
  const requiredSigners       = tx.body.required_signers
  const includeNetworkId      = !!tx.body.network_id
  const hasConwaySetTag       = tx.hasConwaySetTag

  if (ttl)                     { okTx.ttl                    = ttl }
  if (collateralInputs)        { okTx.collateralInputs       = collateralInputs }
  if (referenceInputs)         { okTx.referenceInputs        = referenceInputs }
  if (collateralOutput)        { okTx.collateralReturn       = collateralOutput }
  if (totalCollateral != null) { okTx.totalCollateral        = totalCollateral }
  if (withdrawals)             { okTx.withdrawals            = generateOneKeyWithdrawals(accountData, withdrawals as WithdrawalsJSON) }
  if (certificates)            { okTx.certificates           = generateOneKeyCertificates(accountData, certificates) }
  if (txBuildRes.cslAuxData && isCatalystVotingRegistrationMetadata(txBuildRes.cslAuxData))
                               { okTx.auxiliaryData          = generateOneKeyMetadata(accountData, txBuildRes.cslAuxData) }
  else if (metadataHash)       { okTx.auxiliaryData          = generateOneKeyMetadataFromHash(metadataHash) }
  if (mint)                    { okTx.mint                   = generateOneKeyMintBundle(mint) }
  if (scriptDataHash  != null) { okTx.scriptDataHash         = scriptDataHash }
  if (validityStart   != null) { okTx.validityIntervalStart  = validityStart }
  if (requiredSigners)         { okTx.requiredSigners        = generateRequiredSigners(accountData, requiredSigners) }
  if (includeNetworkId)        { okTx.includeNetworkId       = true }
  if (hasConwaySetTag)         { okTx.tagCborSets            = true }

  if (!!collateralInputs || !!tx.witness_set.redeemers || !!tx.body.reference_inputs) {

    okTx.signingMode          = CardanoTxSigningMode.PLUTUS_TRANSACTION

  } else if (isMultiSigSigning) {

    okTx.signingMode               = CardanoTxSigningMode.MULTISIG_TRANSACTION
  }

  if (additionalWitnessPaths.length > 0) { okTx.additionalWitnessRequests = additionalWitnessPaths }

  txBuildRes.hwRequest        = okTx

  console.log('builtTx', txBuildRes)
  console.log('request', JSON.stringify(okTx))

  // Needed to fetch passphrase state
  await oneKeyDeviceInfo(connectId)

  const params                = {

    ...commonParams,
    ...okTx
  }

  const response              = await OneKeySDK.cardanoSignTransaction(connectId, deviceId, params)

  if (!response?.success)     { throw response?.payload?.error ?? 'oneKeyWitnesses: unknown error' }

  console.log('response', response)

  // TODO: close connection?
  // if (!moreTxFollow)          { closeTransport().catch(e => console.error(e)) }

  if (txBuildRes.txHash && doHashCheck) {

    if (response.payload.hash !== txBuildRes.txHash) {

      console.error('OneKey tx hash response:', response.payload.hash)
      console.error('Source tx hash from cbor:', txBuildRes.txHash)

      throw new Error('Tx serialization mismatch between OneKey and source transaction')
    }
  }

  const witnessSetHex         = assembleWitnesses(txBuildRes, response.payload)

  return {

    serializedWitnessSet:     witnessSetHex,
    signedTransactionData:    response.payload
  }
}

const assembleWitnesses       = ( txBuildRes:   IBuiltTxResult,
                                  signedTxData: CardanoSignedTxData): string => {

  const witnesses             = txBuildRes.signedTx?.witnessSetOwned
    ? TransactionWitnessSet.from_hex(txBuildRes.signedTx.witnessSetOwned)
    : TransactionWitnessSet.new()

  const vkeyWitnesses         = witnesses.vkeys() ?? Vkeywitnesses.new()

  for (const witness of signedTxData.witnesses) {

    vkeyWitnesses.add(getVkeyWitness(witness.pubKey, witness.signature, true,  true))
  }

  witnesses.set_vkeys(vkeyWitnesses)

  const witnessSetHex         = witnesses.to_hex()

  safeFreeCSLObject(vkeyWitnesses)
  safeFreeCSLObject(witnesses)

  return witnessSetHex
}

function generateRequiredSigners(accountData: IAccountDBData, requiredSigners: Ed25519KeyHashesJSON): CardanoRequiredSigners {

  const requiredSignerList: CardanoRequiredSigners = []

  for (const requiredSigner of requiredSigners) {

    const cred                = getOwnedCred([accountData.keys], requiredSigner)

    if (cred) {

      requiredSignerList.push({ keyPath: getStringDerivationPath(cred.path) })

    } else {

      requiredSignerList.push({ keyHash: requiredSigner })
    }
  }

  return requiredSignerList
}

function generateAdditionalWitnessPaths(credList: ICreds[], inputs: CardanoInput[], collaterals: CardanoCollateralInput[] | null,
                                        checkInputs: boolean): string[] {

  const additionalWitnessPaths: string[] = []

  if (checkInputs) {

    for (const cred of credList) {

      const hardenedPath      = getStringDerivationPath(cred.path)

      // Check if path is already added, if so ignore
      if (additionalWitnessPaths.some(p => p === hardenedPath)) { continue }

      const isPartOfInputs      =                    inputs.some(item => !!item.path && (item.path as string) === hardenedPath)
      const isPartOfCollaterals = collaterals ? collaterals.some(item => !!item.path && (item.path as string) === hardenedPath) : false

      if (!isPartOfInputs && !isPartOfCollaterals) {

        additionalWitnessPaths.push(hardenedPath)
      }
    }

  } else {

    for (const cred of credList) {

      const hardenedPath      = getStringDerivationPath(cred.path)

      // Check if path is already added, if so ignore
      if (additionalWitnessPaths.some(p => p === hardenedPath)) { continue }

      additionalWitnessPaths.push(hardenedPath)
    }
  }

  return additionalWitnessPaths
}

function generateOneKeyInputs(accountData: IAccountDBData, inputs: TransactionInputsJSON, utxoList: IUtxo[]): CardanoInput[] {

  const oneKeyInputs: CardanoInput[] = []

  for (const input of inputs) {

    const utxo                = utxoList.find(u => u.input.transaction_id === input.transaction_id && u.input.index === input.index)
    const cred                = utxo ? getAddressCredentials(utxo.output.address) : null
    const key                 = cred ? getOwnedCred([accountData.keys], cred.paymentCred) : null

    oneKeyInputs.push({
      prev_hash:              input.transaction_id,
      prev_index:             input.index,
      path:                   key ? getStringDerivationPath(key.path) : undefined
    })
  }

  return oneKeyInputs
}

function generateOneKeyOutputs(accountData: IAccountDBData, tx: ITransactionJSON, outputs: TransactionOutputJSON[], isCollateral: boolean, isMultiSigSigning: boolean): CardanoOutput[] {

  const oneKeyOutputs: CardanoOutput[]  = []

  for (let i = 0; i < outputs.length; i++) {

    const output              = outputs[i]
    const cred                = getAddressCredentials(output.address, null, true)

    if (!cred) { throw new Error('unable to parse output address: ' + output.address)}

    const paymentCred         = cred.paymentCred && !isMultiSigSigning ? getOwnedCred([accountData.keys], cred.paymentCred) : null

    let out:                  CardanoOutput | undefined

    let format                = CardanoTxOutputSerializationFormat.ARRAY_LEGACY

    const outputData: OutputData | undefined = isCollateral ? tx.colOutputDataList?.[i] : tx.outputData?.[i]

    if (outputData && outputData.isBabbage) {

      format                  = CardanoTxOutputSerializationFormat.MAP_BABBAGE
    }

    try {

      if (paymentCred) {

        out                   = {
          format,
          addressParameters:  generateOneKeyOwnedAddress(accountData, paymentCred, cred.stakeCred),
          amount:             output.amount.coin,
        }
      }

    } catch (err) {}  // throws if unknown stake cred, valid for franken addresses, mark as external in this case

    if (!out) {

      out                     = {
        format,
        address:              output.address,
        amount:               output.amount.coin,
      }
    }

    if (output.amount.multiasset) {

      out!.tokenBundle        = generateOneKeyTokenBundle(output.amount.multiasset)
    }

    if (output.script_ref) {

      let script: string | null = null

      if (outputData?.plutusScriptBytes) {

        script                = toHexString(outputData.plutusScriptBytes)

      } else {

        script                = (output.script_ref as any)['PlutusScript'] ?? (output.script_ref as any)['NativeScript'] ?? null
      }

      if (script && typeof script === 'string') {

        out                   = {
          ...out,
          referenceScript:    script
        }
      }
    }

    const hvb                 = getPlutusHVB(output.plutus_data)

    if (outputData?.plutusDataBytes) {

      hvb.bytes               = toHexString(outputData.plutusDataBytes)
    }

    if (hvb.bytes) {

      out                     = {
        ...out,
        inlineDatum:          hvb.bytes
      }

    } else if (hvb.hash) {

      out                     = {
        ...out,
        datumHash:            hvb.hash
      }
    }

    oneKeyOutputs.push(out!)
  }

  return oneKeyOutputs
}
const generateOneKeyOwnedAddress = (accountData: IAccountDBData, paymentCred: ICreds | string | null, stakeCred: ICreds | string | null): CardanoAddressParameters => {

  const _paymentCred        = typeof paymentCred === 'string'
    ? getOwnedCred([accountData.keys], paymentCred)
    : paymentCred

  const _stakeCred          = typeof stakeCred === 'string'
    ? getOwnedCred([accountData.keys], stakeCred, 'stake')
    : stakeCred

  if (_paymentCred && _stakeCred) {

    return {

      addressType:            CardanoAddressType.BASE,

      path:                   getStringDerivationPath(_paymentCred.path),
      stakingPath:            getStringDerivationPath(_stakeCred.path),
    }
  } else if (_paymentCred && !stakeCred) {

    return {

      addressType:            CardanoAddressType.ENTERPRISE,
      path:                   getStringDerivationPath(_paymentCred.path)
    }
  } else if (_stakeCred && !paymentCred) {

    return {

      addressType:            CardanoAddressType.REWARD,
      stakingPath:            getStringDerivationPath(_stakeCred.path)
    }
  }

  throw new Error(`generateOneKeyOwnedAddress: couldn\'t find cred for: paymentCred=${paymentCred}, stakeCred=${stakeCred}`)
}

function generateOneKeyTokenBundle(assets: MultiAssetJSON): CardanoAssetGroup[] {

  // We cant assume JSON is correctly sorted (CIP-21) after deserialization

  const assetGroup: CardanoAssetGroup[]  = []

  // 1. Sort entries based on policy
  const sortedPolicyList      = Object.entries(assets).sort((a,b) => a[0].localeCompare(b[0], 'en-US'))

  for (const policy of sortedPolicyList) {

    const assetList: CardanoToken[] = []

    // 2. Sort assets based on asset name, first length then by string
    const sortedAssetList     = Object.entries(policy[1]).sort((a,b) => {

      return a[0].length === b[0].length ? a[0].localeCompare(b[0], 'en-US') : a[0].length - b[0].length
    })

    for (const asset of sortedAssetList) {

      assetList.push({

        assetNameBytes:       asset[0],
        amount:               asset[1]
      })
    }

    assetGroup.push({

      policyId:               policy[0],
      tokenAmounts:           assetList
    })
  }

  return assetGroup
}

function generateOneKeyMintBundle(mintList: MintJSON): CardanoAssetGroup[] {

  // We cant assume JSON is correctly sorted (CIP-21) after deserialization

  const assetGroup: CardanoAssetGroup[]  = []

  // 1. Sort entries based on policy
  const sortedMintList        = [...mintList].sort((a,b) => a[0].localeCompare(b[0], 'en-US'))

  for (const mint of sortedMintList) {

    const assetList: CardanoToken[] = []

    // 2. Sort assets based on asset name, first length then by string
    const sortedAssetList     = Object.entries(mint[1]).sort((a,b) => {

      return a[0].length === b[0].length ? a[0].localeCompare(b[0], 'en-US') : a[0].length - b[0].length
    })

    for (const asset of sortedAssetList) {

      assetList.push({

        assetNameBytes:       asset[0],
        mintAmount:           asset[1]
      })
    }

    assetGroup.push({

      policyId:               mint[0],
      tokenAmounts:           assetList
    })
  }

  return assetGroup
}

function generateOneKeyWithdrawals(accountData: IAccountDBData, withdrawals: WithdrawalsJSON): CardanoWithdrawal[] | undefined {

  const oneKeyWithdrawals: CardanoWithdrawal[]  = []

  for (const withdrawal of Object.entries(withdrawals)) {

    const cred                = getAddressCredentials(withdrawal[0])
    const stakeCred           = getOwnedCred([accountData.keys], cred.stakeCred, 'stake')

    if (stakeCred) {

      oneKeyWithdrawals.push({

        path:                 getStringDerivationPath(stakeCred.path),
        amount:               withdrawal[1] as string,
      })

    } else if (cred.stakeCred) {

      const isScript          = isScriptStakeAddress(withdrawal[0])

      oneKeyWithdrawals.push({

        scriptHash:            isScript ? cred.stakeCred : undefined,
        keyHash:              !isScript ? cred.stakeCred : undefined,
        amount:               withdrawal[1] as string,
      })
    }
  }

  return oneKeyWithdrawals.length === 0 ? undefined : oneKeyWithdrawals
}

function generateOneKeyCertificates(accountData: IAccountDBData, certificates: CertificatesJSON): CardanoCertificate[] {

  const oneKeyCertificates: CardanoCertificate[]  = []

  for (const cert of certificates) {

    const certName            = Object.keys(cert)[0]
    const id                  = CertificateTypes.findIndex(type => type === Object.keys(cert)[0])

    switch (id) {

      case CertificateKind.StakeRegistration: {

        const regCert         = (cert as any).StakeRegistration as StakeRegistrationJSON
        const cred            = Object.values(regCert.stake_credential)[0]
        const isScript        = Object.keys(regCert.stake_credential)[0] === 'Script'

        const ownedCred       = getOwnedCred([accountData.keys], cred, 'stake')

        const oneKeyRegCert   = <CardanoCertificate>{

          type:               regCert.coin ? CardanoCertificateType.STAKE_REGISTRATION_CONWAY : CardanoCertificateType.STAKE_REGISTRATION,
          path:               ownedCred ? getStringDerivationPath(ownedCred.path) : undefined,
          keyHash:            !ownedCred && !isScript ? cred : undefined,
          scriptHash:         !ownedCred &&  isScript ? cred : undefined,
          deposit:            !!regCert.coin ? regCert.coin : undefined
        }

        oneKeyCertificates.push(oneKeyRegCert)

        break
      }

      case CertificateKind.StakeDeregistration: {

        const deregCert       = (cert as any).StakeDeregistration as StakeDeregistrationJSON
        const cred            = Object.values(deregCert.stake_credential)[0]
        const isScript        = Object.keys(deregCert.stake_credential)[0] === 'Script'

        const ownedCred       = getOwnedCred([accountData.keys], cred, 'stake')

        const oneKeyDeregCert = <CardanoCertificate>{

          type:               deregCert.coin ? CardanoCertificateType.STAKE_DEREGISTRATION_CONWAY : CardanoCertificateType.STAKE_DEREGISTRATION,
          path:               ownedCred ? getStringDerivationPath(ownedCred.path) : undefined,
          keyHash:            !ownedCred && !isScript ? cred : undefined,
          scriptHash:         !ownedCred &&  isScript ? cred : undefined,
          deposit:            !!deregCert.coin ? deregCert.coin : undefined
        }

        oneKeyCertificates.push(oneKeyDeregCert)

        break
      }

      case CertificateKind.StakeDelegation: {

        const delegation      = (cert as any).StakeDelegation as StakeDelegationJSON
        const cred            = Object.values(delegation.stake_credential)[0]
        const isScript        = Object.keys(delegation.stake_credential)[0] === 'Script'

        const ownedCred       = getOwnedCred([accountData.keys], cred, 'stake')

        oneKeyCertificates.push(<CardanoCertificate>{

          type:               CardanoCertificateType.STAKE_DELEGATION,
          path:               ownedCred ? getStringDerivationPath(ownedCred.path) : undefined,
          keyHash:            !ownedCred && !isScript ? cred : undefined,
          scriptHash:         !ownedCred &&  isScript ? cred : undefined,
          pool:               delegation.pool_keyhash
        })

        break
      }

      case CertificateKind.VoteDelegation: {

        const delegation      = (cert as any).VoteDelegation as VoteDelegationJSON
        const cred            = Object.values(delegation.stake_credential)[0]
        const isScript        = Object.keys(delegation.stake_credential)[0] === 'Script'
        const drep            = delegation.drep

        const ownedCred       = getOwnedCred([accountData.keys], cred, 'stake')

        const oneKeyVoteDel   = <CardanoCertificate>{

          type:               CardanoCertificateType.VOTE_DELEGATION,
          path:               ownedCred ? getStringDerivationPath(ownedCred.path) : undefined,
          keyHash:            !ownedCred && !isScript ? cred : undefined,
          scriptHash:         !ownedCred &&  isScript ? cred : undefined,
        }

        if (typeof drep === 'string') {

          if (drep === 'AlwaysAbstain') {

            oneKeyVoteDel.dRep = { type: CardanoDRepType.ABSTAIN }

          } else {

            oneKeyVoteDel.dRep = { type: CardanoDRepType.NO_CONFIDENCE }
          }

        } else {

          const keyHash       = (drep as any).KeyHash

          if (keyHash) {

            oneKeyVoteDel.dRep = {

              type:           CardanoDRepType.KEY_HASH,
              keyHash:        keyHash
            }

          } else {

            oneKeyVoteDel.dRep = {

              type:           CardanoDRepType.SCRIPT_HASH,
              scriptHash:     (drep as any).ScriptHash
            }
          }
        }

        oneKeyCertificates.push(oneKeyVoteDel)

        break
      }

      case CertificateKind.PoolRegistration: {

        const poolRegistration  = ((cert as any).PoolRegistration as PoolRegistrationJSON).pool_params

        if (!poolRegistration.pool_metadata) { break }

        const oneKeyPoolRegistration = <CardanoCertificate>{

          type: CardanoCertificateType.STAKE_POOL_REGISTRATION,
          poolParameters: {
            poolId: poolRegistration.operator,
            vrfKeyHash: poolRegistration.vrf_keyhash,
            pledge: poolRegistration.pledge,
            cost: poolRegistration.cost,
            margin: poolRegistration.margin,
            rewardAccount: poolRegistration.reward_account,
            owners: poolRegistration.pool_owners.map(owner => {

              const ownedCred = getOwnedCred([accountData.keys], owner, 'stake')

              return ownedCred ? {
                stakingKeyPath: getStringDerivationPath(ownedCred.path)
              } : {
                stakingKeyHash: owner
              }
            }),
            relays: poolRegistration.relays.map<CardanoPoolRelay>(relay => {

              if (relay.hasOwnProperty('SingleHostAddr')) {

                const _relay  = (relay as any).SingleHostAddr as SingleHostAddrJSON

                const oneKeyRelay = <CardanoPoolRelay>{
                  type: CardanoPoolRelayType.SINGLE_HOST_IP,
                }

                if (!!_relay.port) { oneKeyRelay.port        = _relay.port }
                if (!!_relay.ipv4) { oneKeyRelay.ipv4Address = _relay.ipv4.join('.') }
                if (!!_relay.ipv6) { oneKeyRelay.ipv6Address = _relay.ipv6.join(':') }

                return oneKeyRelay

              } else if (relay.hasOwnProperty('SingleHostName')) {

                const _relay  = (relay as any).SingleHostName as SingleHostNameJSON

                const oneKeyRelay = <CardanoPoolRelay>{
                  type: CardanoPoolRelayType.SINGLE_HOST_NAME,
                  hostName: _relay.dns_name
                }

                if (!!_relay.port) { oneKeyRelay.port = _relay.port }

                return oneKeyRelay

              } else if (relay.hasOwnProperty('MultiHostName')) {

                const _relay  = (relay as any).MultiHostName as MultiHostNameJSON

                return <CardanoPoolRelay>{
                  type: CardanoPoolRelayType.MULTIPLE_HOST_NAME,
                  hostName: _relay.dns_name
                }

              } else {

                throw `The transaction contains ${certName} certificate with unknown property: ${Object.keys(relay)[0]}`
              }
            }),
            metadata: {

              url:  poolRegistration.pool_metadata.url,
              hash: poolRegistration.pool_metadata.pool_metadata_hash
            }
          }
        }

        oneKeyCertificates.push(oneKeyPoolRegistration)

        break
      }

      default:

        throw `The transaction contains ${certName} certificate, unsupported by OneKey device`
    }
  }

  return oneKeyCertificates
}

function generateOneKeyMetadataFromHash(metadataHash: string): CardanoAuxiliaryData {

  return {

    hash: metadataHash
  }
}

function generateOneKeyMetadata(accountData: IAccountDBData, metadata: AuxiliaryData): CardanoAuxiliaryData {

  // Check if its Catalyst metadata
  if (isCatalystVotingRegistrationMetadata(metadata)) {

    const metadatum           = getCatalystRegistrationMetadata(metadata).get(BigNum.from_str('61284'))

    const catalyst_meta       = JSON.parse(decode_metadatum_to_json_str(metadatum!, MetadataJsonSchema.BasicConversions))

    const votingPublicKey     = catalyst_meta['1']
    const nonce               = catalyst_meta['4']

    const rewardAddr          = Address.from_hex(catalyst_meta['3'].replace(/^0x/, ''))
    const rewardAddrBech32    = rewardAddr.to_bech32()

    safeFreeCSLObject(rewardAddr)

    const cred                = getAddressCredentials(rewardAddrBech32)
    const paymentCred         = getOwnedCred([accountData.keys], cred.paymentCred)
    const stakeCred           = getOwnedCred([accountData.keys], cred.stakeCred, 'stake')

    if (!paymentCred || !stakeCred) { throw new Error('generateOneKeyMetadata: reward address credentials not found') }

    const stakingKeyPath      = getStringDerivationPath(stakeCred.path)

    return {

      cVoteRegistrationParameters: {

        format:                   CardanoCVoteRegistrationFormat.CIP15,
        votePublicKey:            votingPublicKey.replace(/^0x/, ''),
        stakingPath:              stakingKeyPath,
        paymentAddressParameters: generateOneKeyOwnedAddress(accountData, paymentCred, stakeCred),
        nonce:                    nonce
      }
    }

  } else {

    return {

      hash: blake2b256Str(toBufferFromArray(metadata.to_bytes()))
    }
  }
}

const oneKeySignMessage       = async ( connectId:    string,
                                        deviceId:     string,
                                        _passphrase:  string | null,
                                        appAccount:   IAppAccount,
                                        walletId:     string,
                                        address:      string,
                                        payload:      string): Promise<DataSignature> => {

  await updatePassphrase(connectId, _passphrase)

  const accountData           = appAccount.data
  const networkId             = appAccount.data.state.networkId

  try {

    const keyDetails          = getAccountKeyDetails(address, accountData)

    const accountKey          = keyDetails.accountCredAndType.cred

    const derivationType      = getOneKeyDerivationTypeFromWalletId(walletId)

    const req                 = <CardanoSignMessageMethodParams>{

      path:                   getStringDerivationPath(accountKey.path),
      message:                payload,
      derivationType:         derivationType,
      networkId:              getNetworkId(networkId)
    }

         if (!!keyDetails.addrPaymentCred && !!keyDetails.addrStakeCred) { req.addressType = CardanoAddressType.BASE }
    else if (!!keyDetails.addrPaymentCred                              ) { req.addressType = CardanoAddressType.ENTERPRISE }
    else if (                                !!keyDetails.addrStakeCred) { req.addressType = CardanoAddressType.REWARD }

    // Needed to fetch passphrase state
    await oneKeyDeviceInfo(connectId)

    const params                = {

      ...commonParams,
      ...req
    }

    console.log('request', JSON.stringify(params))

    const response            = await OneKeySDK.cardanoSignMessage(connectId, deviceId, params)

    if (!response?.success)   { throw response?.payload?.error ?? 'oneKeySignMessage: unknown error' }

    console.log('response', JSON.stringify(response))

    return {

      signature:              response.payload.signature,
      key:                    response.payload.key
    }

  } catch (err: any) {

    throw err?.message ?? err
  }
}

export function useOneKeyDevice() {

  return {

    oneKeyDeviceCancelRequest,
    oneKeyDeviceSearch,
    oneKeyDeviceInfo,
    oneKeyDevicePublicKey,
    getOneKeyDerivationTypeFromWalletId,
    oneKeySignTx,
    oneKeyWitnesses,
    oneKeySignMessage
  }
}

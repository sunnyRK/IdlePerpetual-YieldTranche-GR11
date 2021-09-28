// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.7;

import "./interfaces/IIdleCDOStrategy.sol";
import "./interfaces/IIdleToken.sol";
import "./interfaces/IYearnVault.sol";
import "./interfaces/IERC20Detailed.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "hardhat/console.sol";

/// @author Idle Labs Inc.
/// @title IdleYearnVaultStrategy
/// @notice IIdleCDOStrategy to deploy funds in Idle Finance
/// @dev This contract should not have any funds at the end of each tx.
/// The contract is upgradable, to add storage slots, add them after the last `###### End of storage VXX`
contract IdleYearnVaultStrategy is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable, IIdleCDOStrategy {
  using SafeERC20Upgradeable for IERC20Detailed;

  /// ###### Storage V1
  /// @notice one idleToken (all idleTokens have 18 decimals)
  uint256 public constant ONE_TOKEN = 10**18;
  /// @notice address of the strategy used, in this case idleToken address
  address public override strategyToken;
  /// @notice underlying token address (eg DAI)
  address public override token;
  /// @notice one underlying token
  uint256 public override oneToken;
  /// @notice decimals of the underlying asset
  uint256 public override tokenDecimals;
  /// @notice underlying ERC20 token contract
  IERC20Detailed public underlyingToken;
  /// @notice yearnVault contract
  IYearnVault public yearnVault;
  address public whitelistedCDO;
  /// ###### End of storage V1

  // Used to prevent initialization of the implementation contract
  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    token = address(1);
  }

  // ###################
  // Initializer
  // ###################

  /// @notice can only be called once
  /// @dev Initialize the upgradable contract
  /// @param _strategyToken address of the strategy token
  /// @param _owner owner address
  function initialize(address _strategyToken, address _owner) public initializer {
    require(token == address(0), 'Initialized');
    // Initialize contracts
    OwnableUpgradeable.__Ownable_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();
    // Set basic parameters
    strategyToken = _strategyToken;
    token = IYearnVault(_strategyToken).token();
    tokenDecimals = IERC20Detailed(token).decimals();
    oneToken = 10**(tokenDecimals);
    yearnVault = IYearnVault(_strategyToken);
    underlyingToken = IERC20Detailed(token);
    underlyingToken.safeApprove(_strategyToken, type(uint256).max);
    // transfer ownership
    transferOwnership(_owner);
  }

  // ###################
  // Public methods
  // ###################

  /// @dev msg.sender should approve this contract first to spend `_amount` of `token`
  /// @param _amount amount of `token` to deposit
  /// @return minted strategyTokens minted
  function deposit(uint256 _amount) external override returns (uint256 minted) {
    if (_amount > 0) {
      IYearnVault _yearnVault = yearnVault;
      /// get `tokens` from msg.sender
      underlyingToken.safeTransferFrom(msg.sender, address(this), _amount);
      /// deposit those in Idle
      minted = _yearnVault.deposit(_amount);
      /// transfer idleTokens to msg.sender
      _yearnVault.transfer(msg.sender, minted);
    }
  }

  /// @dev msg.sender should approve this contract first to spend `_amount` of `strategyToken`
  /// @param _amount amount of strategyTokens to redeem
  /// @return amount of underlyings redeemed
  function redeem(uint256 _amount) external override returns(uint256) {
    return _redeem(_amount);
  }

  function redeemRewards() external virtual override returns (uint256[] memory _balances) {
    // No Implementation
  }

  function redeemUnderlying(uint256 _amount) external virtual override returns(uint256){
    return _redeem(_amount * ONE_TOKEN / price());
  }

  // ###################
  // Internal
  // ###################

  /// @dev msg.sender should approve this contract first to spend `_amount` of `strategyToken`
  /// @param _amount amount of strategyTokens to redeem
  /// @return redeemed amount of underlyings redeemed
  function _redeem(uint256 _amount) internal returns(uint256 redeemed) {
    if (_amount > 0) {
      IYearnVault _yearnVault = yearnVault;
      // get idleTokens from the user
      _yearnVault.transferFrom(msg.sender, address(this), _amount);
      // redeem underlyings from Idle
      redeemed = _yearnVault.withdraw(_amount);
      // transfer underlyings to msg.sender
      underlyingToken.safeTransfer(msg.sender, redeemed);
    }
  }

  // ###################
  // Views
  // ###################

  /// @return net price in underlyings of 1 strategyToken
  function price() public override view returns(uint256) {
    return yearnVault.pricePerShare();
  }

  /// @return apr net apr (fees should already be excluded)
  function getApr() external override virtual view returns(uint256 apr){
    uint256 index;
    uint256 toralExpectedPercent;
    uint256 expectedReturn;
    uint256 strategyTvl;
    IYearnVault _yearnVault = yearnVault;
    address strategy = _yearnVault.withdrawalQueue(index);
    while(strategy != address(0)) {
        expectedReturn = _yearnVault.expectedReturn(strategy);
        strategyTvl = _yearnVault.creditAvailable(strategy);
        toralExpectedPercent += ((expectedReturn * 1e20) / strategyTvl); // 1e20 = 100 * 1e18 
        index += 1;
        strategy = _yearnVault.withdrawalQueue(index);
    }
    apr = toralExpectedPercent / index;
    apr -= apr * _yearnVault.performanceFee() / 10000; // 10000 = 100%
    apr -= apr * _yearnVault.managementFee() / 10000; // 10000 = 100%
  }

  /// @return tokens array of reward token addresses
  function getRewardTokens() external virtual override view returns(address[] memory tokens){
    // No Implementation
  }

  // ###################
  // Protected
  // ###################

  /// @notice Allow the CDO to pull stkAAVE rewards
  /// @return _bal amount of stkAAVE transferred
  function pullStkAAVE() external virtual override returns(uint256 _bal){
    // No Implementation
  }

  /// @notice This contract should not have funds at the end of each tx (except for stkAAVE), this method is just for leftovers
  /// @dev Emergency method
  /// @param _token address of the token to transfer
  /// @param value amount of `_token` to transfer
  /// @param _to receiver address
  function transferToken(address _token, uint256 value, address _to) external onlyOwner nonReentrant {
    IERC20Detailed(_token).safeTransfer(_to, value);
  }

  /// @notice allow to update address whitelisted to pull stkAAVE rewards
  function setWhitelistedCDO(address _cdo) external onlyOwner {
    require(_cdo != address(0), "IS_0");
    whitelistedCDO = _cdo;
  }
}
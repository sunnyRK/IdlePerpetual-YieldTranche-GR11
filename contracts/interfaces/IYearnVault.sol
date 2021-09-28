// SPDX-License-Identifier: Apache-2.0
/**
 * @title: Idle Token interface
 * @author: Idle Labs Inc., idle.finance
 */
pragma solidity 0.8.7;

import "./IERC20Detailed.sol";


interface IYearnVault is IERC20Detailed{
  function deposit(uint256 _amount) external returns(uint256);
  function withdraw(uint256 _amount) external returns(uint256);
  function token() external view returns(address);
  function pricePerShare() external view returns(uint256);
  function managementFee() external view returns(uint256);
  function performanceFee() external view returns(uint256);
  function withdrawalQueue(uint256 _index) external view returns(address);
  function expectedReturn(address _strategy) external view returns(uint256);
  function creditAvailable(address _strategy) external view returns(uint256);
}

require("hardhat/config")
const { BigNumber } = require("@ethersproject/bignumber");
const helpers = require("../scripts/helpers");
const erc20 = require("../artifacts/contracts/interfaces/IERC20Detailed.sol/IERC20Detailed.json");
const addresses = require("../lib/addresses");
const { expect } = require("chai");
const { FakeContract, smock } = require('@defi-wonderland/smock');

require('chai').use(smock.matchers);

const BN = n => BigNumber.from(n.toString());
const ONE_TOKEN = (n, decimals) => BigNumber.from('10').pow(BigNumber.from(n));
const MAX_UINT = BN('115792089237316195423570985008687907853269984665640564039457584007913129639935');

describe("IdleYearnVaultStrategy", function () {
  beforeEach(async () => {
    // deploy contracts
    signers = await ethers.getSigners();
    owner = signers[0];
    AABuyer = signers[1];
    AABuyerAddr = AABuyer.address;
    BBBuyer = signers[2];
    BBBuyerAddr = BBBuyer.address;
    AABuyer2 = signers[3];
    AABuyer2Addr = AABuyer2.address;
    BBBuyer2 = signers[4];
    BBBuyer2Addr = BBBuyer2.address;
    Random = signers[5];
    RandomAddr = Random.address;
    Random2 = signers[6];
    Random2Addr = Random2.address;
    stkAAVEAddr = addresses.IdleTokens.mainnet.stkAAVE;

    one = ONE_TOKEN(18);

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const MockYearnVault = await ethers.getContractFactory("MockYearnVault");

    underlying = await MockERC20.deploy("DAI", "DAI");
    await underlying.deployed();

    incentiveToken = await MockERC20.deploy("YearnDAI", "YearnDAI");
    await incentiveToken.deployed();

    yearnToken = await MockYearnVault.deploy(underlying.address);
    await yearnToken.deployed();
    // Params
    initialAmount = BN('100000').mul(ONE_TOKEN(18));

    strategy = await helpers.deployUpgradableContract('IdleYearnVaultStrategy', [yearnToken.address, owner.address], owner);

    // Fund wallets
    await helpers.fundWallets(underlying.address, [AABuyerAddr, BBBuyerAddr, AABuyer2Addr, BBBuyer2Addr, yearnToken.address], owner.address, initialAmount);

    // set IdleToken mocked params
    await yearnToken.setPricePerShare(BN(10**18));

    fakeStkAave = await smock.fake(erc20.abi, { address: stkAAVEAddr });
  });

  it("should not reinitialize the contract", async () => {
    await expect(
      strategy.connect(owner).initialize(yearnToken.address, owner.address),
    ).to.be.revertedWith("Initializable: contract is already initialized");
  });

  it("should initialize", async () => {
    expect(await strategy.strategyToken()).to.equal(yearnToken.address);
    expect(await strategy.token()).to.equal(underlying.address);
    expect(await strategy.tokenDecimals()).to.be.equal(BN(18));
    expect(await strategy.oneToken()).to.be.equal(one);
    expect(await strategy.yearnVault()).to.equal(yearnToken.address);
    expect(await strategy.underlyingToken()).to.be.equal(underlying.address);
    expect(await underlying.allowance(strategy.address, yearnToken.address)).to.be.equal(MAX_UINT);
    expect(await strategy.owner()).to.equal(owner.address);
  });

  it("should deposit", async () => {
    const addr = AABuyerAddr;
    const _amount = BN('1000').mul(one);

    const initialIdleTokenBal = await yearnToken.balanceOf(addr);
    await deposit(addr, _amount);
    const finalBal = await underlying.balanceOf(addr);
    const finalIdleTokenBal = await yearnToken.balanceOf(addr);

    expect(initialAmount.sub(finalBal)).to.equal(_amount);
    expect(finalIdleTokenBal.sub(initialIdleTokenBal)).to.equal(_amount);

    // No token left in the contract
    expect(await incentiveToken.balanceOf(strategy.address)).to.equal(0);
    expect(await underlying.balanceOf(strategy.address)).to.equal(0);
    expect(await yearnToken.balanceOf(strategy.address)).to.equal(0);
  });

  it("should redeem", async () => {
    const addr = AABuyerAddr;
    const _amount = BN('1000').mul(one);

    await deposit(addr, _amount);
    await incentiveToken.transfer(yearnToken.address, _amount);

    const initialBal = await underlying.balanceOf(addr);
    const initialIdleTokenBal = await yearnToken.balanceOf(addr);

    await redeem(addr, _amount);

    const finalIdleTokenBal = await yearnToken.balanceOf(addr);
    const finalBal = await underlying.balanceOf(addr);

    expect(finalIdleTokenBal).to.equal(0);
    expect(finalBal.sub(initialBal)).to.equal(_amount);

    // No token left in the contract
    // expect(await incentiveToken.balanceOf(strategy.address)).to.equal(0);
    expect(await underlying.balanceOf(strategy.address)).to.equal(0);
    expect(await yearnToken.balanceOf(strategy.address)).to.equal(0);
  });
  it("should skip redeem if amount is 0", async () => {
    const addr = AABuyerAddr;
    const _amount = BN('1000').mul(one);

    await deposit(addr, _amount);
    // Mock the return of gov tokens
    await incentiveToken.transfer(yearnToken.address, _amount);

    const initialBalIncentive = await incentiveToken.balanceOf(addr);
    const initialBal = await underlying.balanceOf(addr);
    const initialIdleTokenBal = await yearnToken.balanceOf(addr);

    await redeem(addr, BN('0'));

    const finalIdleTokenBal = await yearnToken.balanceOf(addr);
    const finalBal = await underlying.balanceOf(addr);
    const finalBalIncentive = await incentiveToken.balanceOf(addr);

    expect(finalIdleTokenBal).to.equal(initialIdleTokenBal);
    expect(finalBal).to.equal(initialBal);
    expect(finalBalIncentive).to.equal(initialBalIncentive);

    // No token left in the contract
    expect(await incentiveToken.balanceOf(strategy.address)).to.equal(0);
    expect(await underlying.balanceOf(strategy.address)).to.equal(0);
    expect(await yearnToken.balanceOf(strategy.address)).to.equal(0);
  });
  it("should redeemUnderlying", async () => {
    const addr = AABuyerAddr;
    const _amount = BN('1000').mul(one);

    await deposit(addr, _amount);
    // Mock the return of gov tokens
    await incentiveToken.transfer(yearnToken.address, _amount);

    const initialBal = await underlying.balanceOf(addr);
    const initialIdleTokenBal = await yearnToken.balanceOf(addr);

    await underlying.transfer(yearnToken.address, initialAmount);
    await yearnToken.setPricePerShare(BN(2 * 10**18));
    await redeemUnderlying(addr, _amount);

    const finalIdleTokenBal = await yearnToken.balanceOf(addr);
    const finalBal = await underlying.balanceOf(addr);

    expect(finalIdleTokenBal).to.equal(initialIdleTokenBal.div(BN('2')));
    expect(finalBal.sub(initialBal)).to.equal(_amount);

    //   No token left in the contract
    expect(await underlying.balanceOf(strategy.address)).to.equal(0);
    expect(await yearnToken.balanceOf(strategy.address)).to.equal(0);
  });

  it("setWhitelistedCDO should set the relative address and be called only by the owner", async () => {
    const val = RandomAddr;
    await strategy.setWhitelistedCDO(val);
    expect(await strategy.whitelistedCDO()).to.be.equal(val);

    await expect(
      strategy.setWhitelistedCDO(addresses.addr0)
    ).to.be.revertedWith("IS_0");

    await expect(
      strategy.connect(BBBuyer).setWhitelistedCDO(val)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("should return the current price", async () => {
    const _amount = BN('1000').mul(one);
    await yearnToken.setPricePerShare(_amount);
    expect(await strategy.price()).to.equal(_amount);
  });

  // it("should return the current net apr", async () => {
  //   const _amount = BN('10').mul(one);
  //   await yearnToken.setApr(_amount);
  //   await yearnToken.setFee(BN('10000'));
  //   expect(await strategy.getApr()).to.equal(BN('9').mul(one));
  // });

  it("transferToken should be callable only from owner", async () => {
    const _amount = BN('1000').mul(one);
    await incentiveToken.transfer(strategy.address, _amount);

    await expect(
      strategy.connect(BBBuyer).transferToken(incentiveToken.address, _amount, BBBuyerAddr)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    const initialBal = await incentiveToken.balanceOf(BBBuyerAddr);
    await strategy.transferToken(incentiveToken.address, _amount, BBBuyerAddr);
    const finalBal = await incentiveToken.balanceOf(BBBuyerAddr);
    expect(finalBal.sub(initialBal)).to.be.equal(_amount);
  });

  const deposit = async (addr, amount) => {
    await helpers.sudoCall(addr, underlying, 'approve', [strategy.address, MAX_UINT]);
    await helpers.sudoCall(addr, strategy, 'deposit', [amount]);
  }
  const redeem = async (addr, amount) => {
    await helpers.sudoCall(addr, yearnToken, 'approve', [strategy.address, MAX_UINT]);
    await helpers.sudoCall(addr, strategy, 'redeem', [amount]);
  }
  const redeemUnderlying = async (addr, amount) => {
    await helpers.sudoCall(addr, yearnToken, 'approve', [strategy.address, MAX_UINT]);
    await helpers.sudoCall(addr, strategy, 'redeemUnderlying', [amount]);
  }
});

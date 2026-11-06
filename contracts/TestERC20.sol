// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TestERC20 {
    string public constant name = "Spike Token";
    string public constant symbol = "SPK";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor(uint256 initialSupply) { _mint(msg.sender, initialSupply); }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(to != address(0) && balanceOf[msg.sender] >= amount, "transfer denied");
        unchecked { balanceOf[msg.sender] -= amount; balanceOf[to] += amount; }
        emit Transfer(msg.sender, to, amount);
        return true;
    }
    function _mint(address to, uint256 amount) internal { totalSupply += amount; balanceOf[to] += amount; emit Transfer(address(0), to, amount); }
}

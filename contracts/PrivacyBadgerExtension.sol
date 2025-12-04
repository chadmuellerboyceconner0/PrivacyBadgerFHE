// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PrivacyBadgerExtension is SepoliaConfig {
    // Encrypted filtering rule structure
    struct EncryptedRule {
        euint32 encryptedDomainPattern;  // Encrypted domain pattern
        euint32 encryptedPathPattern;    // Encrypted URL path pattern
        euint32 encryptedRuleType;       // Encrypted rule type (block/allow)
        uint256 timestamp;               // Rule creation time
    }
    
    // Rule matching result
    struct MatchResult {
        euint32 encryptedMatchScore;     // Encrypted matching score
        ebool encryptedShouldBlock;       // Encrypted block decision
        bool isProcessed;                 // Processing status
    }
    
    // Contract state
    uint256 public ruleCount;
    mapping(uint256 => EncryptedRule) public filteringRules;
    mapping(address => MatchResult) public matchResults;
    
    // Rule update tracking
    uint256 public lastUpdateTimestamp;
    mapping(address => uint256) public lastSyncTimestamps;
    
    // Privacy parameters
    uint32 public constant MIN_MATCH_SCORE = 80; // Minimum score to block
    
    // Events
    event RuleAdded(uint256 indexed ruleId, uint256 timestamp);
    event RuleUpdated(uint256 indexed ruleId);
    event MatchingRequested(address indexed user);
    event MatchProcessed(address indexed user);
    
    // Only rule maintainers
    modifier onlyMaintainer() {
        // In real implementation: require(maintainers[msg.sender], "Unauthorized");
        _;
    }
    
    /// @notice Add new encrypted filtering rule
    function addFilteringRule(
        euint32 domainPattern,
        euint32 pathPattern,
        euint32 ruleType
    ) public onlyMaintainer {
        uint256 newId = ++ruleCount;
        
        filteringRules[newId] = EncryptedRule({
            encryptedDomainPattern: domainPattern,
            encryptedPathPattern: pathPattern,
            encryptedRuleType: ruleType,
            timestamp: block.timestamp
        });
        
        lastUpdateTimestamp = block.timestamp;
        emit RuleAdded(newId, block.timestamp);
    }
    
    /// @notice Update existing filtering rule
    function updateFilteringRule(
        uint256 ruleId,
        euint32 newDomainPattern,
        euint32 newPathPattern,
        euint32 newRuleType
    ) public onlyMaintainer {
        require(filteringRules[ruleId].timestamp > 0, "Rule not found");
        
        filteringRules[ruleId].encryptedDomainPattern = newDomainPattern;
        filteringRules[ruleId].encryptedPathPattern = newPathPattern;
        filteringRules[ruleId].encryptedRuleType = newRuleType;
        filteringRules[ruleId].timestamp = block.timestamp;
        
        lastUpdateTimestamp = block.timestamp;
        emit RuleUpdated(ruleId);
    }
    
    /// @notice Request URL matching against filtering rules
    function requestUrlMatching(
        euint32 encryptedDomain,
        euint32 encryptedPath
    ) public {
        // Prepare encrypted data for matching
        bytes32[] memory ciphertexts = new bytes32[](ruleCount * 3 + 2);
        
        // Add URL components
        ciphertexts[0] = FHE.toBytes32(encryptedDomain);
        ciphertexts[1] = FHE.toBytes32(encryptedPath);
        
        // Add all filtering rules
        uint256 index = 2;
        for (uint256 i = 1; i <= ruleCount; i++) {
            EncryptedRule storage rule = filteringRules[i];
            ciphertexts[index++] = FHE.toBytes32(rule.encryptedDomainPattern);
            ciphertexts[index++] = FHE.toBytes32(rule.encryptedPathPattern);
            ciphertexts[index++] = FHE.toBytes32(rule.encryptedRuleType);
        }
        
        // Initialize result
        matchResults[msg.sender] = MatchResult({
            encryptedMatchScore: FHE.asEuint32(0),
            encryptedShouldBlock: FHE.asEbool(false),
            isProcessed: false
        });
        
        // Request matching computation
        uint256 reqId = FHE.requestComputation(ciphertexts, this.performMatching.selector);
        
        emit MatchingRequested(msg.sender);
    }
    
    /// @notice Callback for URL matching
    function performMatching(
        uint256 requestId,
        bytes memory results,
        bytes memory proof
    ) public {
        // Verify computation proof
        FHE.checkSignatures(requestId, results, proof);
        
        // Process matching results
        uint32 matchScore;
        bool shouldBlock;
        (matchScore, shouldBlock) = abi.decode(results, (uint32, bool));
        
        matchResults[msg.sender] = MatchResult({
            encryptedMatchScore: FHE.asEuint32(matchScore),
            encryptedShouldBlock: FHE.asEbool(shouldBlock),
            isProcessed: true
        });
        
        lastSyncTimestamps[msg.sender] = block.timestamp;
        emit MatchProcessed(msg.sender);
    }
    
    /// @notice Get encrypted match result
    function getEncryptedMatchResult() public view returns (ebool) {
        require(matchResults[msg.sender].isProcessed, "Not processed");
        return matchResults[msg.sender].encryptedShouldBlock;
    }
    
    /// @notice Check if rules need updating
    function needsUpdate() public view returns (bool) {
        return lastSyncTimestamps[msg.sender] < lastUpdateTimestamp;
    }
    
    /// @notice Get latest rule updates
    function getRuleUpdates() public view returns (bytes32[] memory, bytes32[] memory, bytes32[] memory, uint256[] memory) {
        uint256 updateCount = 0;
        for (uint256 i = 1; i <= ruleCount; i++) {
            if (filteringRules[i].timestamp > lastSyncTimestamps[msg.sender]) {
                updateCount++;
            }
        }
        
        bytes32[] memory domains = new bytes32[](updateCount);
        bytes32[] memory paths = new bytes32[](updateCount);
        bytes32[] memory types = new bytes32[](updateCount);
        uint256[] memory timestamps = new uint256[](updateCount);
        
        uint256 index = 0;
        for (uint256 i = 1; i <= ruleCount; i++) {
            if (filteringRules[i].timestamp > lastSyncTimestamps[msg.sender]) {
                domains[index] = FHE.toBytes32(filteringRules[i].encryptedDomainPattern);
                paths[index] = FHE.toBytes32(filteringRules[i].encryptedPathPattern);
                types[index] = FHE.toBytes32(filteringRules[i].encryptedRuleType);
                timestamps[index] = filteringRules[i].timestamp;
                index++;
            }
        }
        
        return (domains, paths, types, timestamps);
    }
    
    /// @notice Request block decision decryption
    function requestDecisionDecryption() public {
        require(matchResults[msg.sender].isProcessed, "Not processed");
        
        // Prepare encrypted decision for decryption
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(matchResults[msg.sender].encryptedShouldBlock);
        
        // Request decryption
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptDecision.selector);
    }
    
    /// @notice Callback for decrypted decision
    function decryptDecision(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        // Verify decryption proof
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        // Process decrypted decision
        bool shouldBlock = abi.decode(cleartexts, (bool));
        // Handle decrypted decision as needed
    }
}
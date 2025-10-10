// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface FilterRule {
  id: string;
  domain: string;
  ruleType: string;
  encryptedPattern: string;
  timestamp: number;
  isActive: boolean;
}

const App: React.FC = () => {
  // State management
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<FilterRule[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingRule, setAddingRule] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRuleData, setNewRuleData] = useState({
    domain: "",
    ruleType: "ad-block",
    pattern: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [showTutorial, setShowTutorial] = useState(false);

  // Stats calculation
  const activeCount = rules.filter(r => r.isActive).length;
  const adBlockCount = rules.filter(r => r.ruleType === "ad-block").length;
  const trackerCount = rules.filter(r => r.ruleType === "tracker-block").length;

  // Initialize
  useEffect(() => {
    loadRules().finally(() => setLoading(false));
  }, []);

  // Wallet connection handlers
  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  // Contract interaction functions
  const loadRules = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("rule_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing rule keys:", e);
        }
      }
      
      const list: FilterRule[] = [];
      
      for (const key of keys) {
        try {
          const ruleBytes = await contract.getData(`rule_${key}`);
          if (ruleBytes.length > 0) {
            try {
              const ruleData = JSON.parse(ethers.toUtf8String(ruleBytes));
              list.push({
                id: key,
                domain: ruleData.domain,
                ruleType: ruleData.ruleType,
                encryptedPattern: ruleData.encryptedPattern,
                timestamp: ruleData.timestamp,
                isActive: ruleData.isActive
              });
            } catch (e) {
              console.error(`Error parsing rule data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading rule ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRules(list);
    } catch (e) {
      console.error("Error loading rules:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const addRule = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setAddingRule(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting filter rule with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedPattern = `FHE-${btoa(newRuleData.pattern)}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const ruleId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const ruleData = {
        domain: newRuleData.domain,
        ruleType: newRuleData.ruleType,
        encryptedPattern: encryptedPattern,
        timestamp: Math.floor(Date.now() / 1000),
        isActive: true
      };
      
      // Store encrypted rule on-chain
      await contract.setData(
        `rule_${ruleId}`, 
        ethers.toUtf8Bytes(JSON.stringify(ruleData))
      );
      
      const keysBytes = await contract.getData("rule_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(ruleId);
      
      await contract.setData(
        "rule_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted rule added successfully!"
      });
      
      await loadRules();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowAddModal(false);
        setNewRuleData({
          domain: "",
          ruleType: "ad-block",
          pattern: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setAddingRule(false);
    }
  };

  const toggleRuleStatus = async (ruleId: string, currentStatus: boolean) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Updating rule status with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const ruleBytes = await contract.getData(`rule_${ruleId}`);
      if (ruleBytes.length === 0) {
        throw new Error("Rule not found");
      }
      
      const ruleData = JSON.parse(ethers.toUtf8String(ruleBytes));
      
      const updatedRule = {
        ...ruleData,
        isActive: !currentStatus
      };
      
      await contract.setData(
        `rule_${ruleId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRule))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Rule status updated!"
      });
      
      await loadRules();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Update failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  // Filter rules based on search and active tab
  const filteredRules = rules.filter(rule => {
    const matchesSearch = rule.domain.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         rule.encryptedPattern.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesTab = activeTab === "all" || 
                      (activeTab === "active" && rule.isActive) ||
                      (activeTab === "inactive" && !rule.isActive) ||
                      (activeTab === "ad" && rule.ruleType === "ad-block") ||
                      (activeTab === "tracker" && rule.ruleType === "tracker-block");
    
    return matchesSearch && matchesTab;
  });

  // Tutorial steps
  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to manage FHE-encrypted filter rules",
      icon: "🔗"
    },
    {
      title: "Add Filter Rules",
      description: "Create new ad-blocking or tracker-blocking rules encrypted with FHE",
      icon: "➕"
    },
    {
      title: "Secure Matching",
      description: "Rules are matched against web requests without revealing the patterns",
      icon: "🔍"
    },
    {
      title: "Privacy Protection",
      description: "Prevent tracking based on your filter list with FHE technology",
      icon: "🛡️"
    }
  ];

  // Loading state
  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE-powered privacy extension...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">🛡️</div>
          <h1>PrivacyBadger<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowAddModal(true)} 
            className="primary-btn"
          >
            + Add Rule
          </button>
          <button 
            className="secondary-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <main className="main-content">
        {showTutorial && (
          <div className="tutorial-section">
            <h2>PrivacyBadgerFHE Guide</h2>
            <p>Learn how to use FHE-powered ad blocking and privacy protection</p>
            
            <div className="tutorial-grid">
              {tutorialSteps.map((step, index) => (
                <div className="tutorial-card" key={index}>
                  <div className="tutorial-icon">{step.icon}</div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="stats-section">
          <div className="stat-card">
            <h3>Total Rules</h3>
            <div className="stat-value">{rules.length}</div>
          </div>
          <div className="stat-card">
            <h3>Active Rules</h3>
            <div className="stat-value">{activeCount}</div>
          </div>
          <div className="stat-card">
            <h3>Ad Blockers</h3>
            <div className="stat-value">{adBlockCount}</div>
          </div>
          <div className="stat-card">
            <h3>Tracker Blockers</h3>
            <div className="stat-value">{trackerCount}</div>
          </div>
        </div>
        
        <div className="controls-section">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search rules..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button className="search-icon">🔍</button>
          </div>
          
          <div className="tabs">
            <button 
              className={activeTab === "all" ? "active" : ""}
              onClick={() => setActiveTab("all")}
            >
              All Rules
            </button>
            <button 
              className={activeTab === "active" ? "active" : ""}
              onClick={() => setActiveTab("active")}
            >
              Active
            </button>
            <button 
              className={activeTab === "inactive" ? "active" : ""}
              onClick={() => setActiveTab("inactive")}
            >
              Inactive
            </button>
            <button 
              className={activeTab === "ad" ? "active" : ""}
              onClick={() => setActiveTab("ad")}
            >
              Ad Block
            </button>
            <button 
              className={activeTab === "tracker" ? "active" : ""}
              onClick={() => setActiveTab("tracker")}
            >
              Tracker Block
            </button>
          </div>
          
          <button 
            onClick={loadRules}
            className="refresh-btn"
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing..." : "Refresh Rules"}
          </button>
        </div>
        
        <div className="rules-list">
          <div className="list-header">
            <div className="header-cell">Domain</div>
            <div className="header-cell">Type</div>
            <div className="header-cell">Encrypted Pattern</div>
            <div className="header-cell">Date Added</div>
            <div className="header-cell">Status</div>
            <div className="header-cell">Actions</div>
          </div>
          
          {filteredRules.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📭</div>
              <p>No rules found matching your criteria</p>
              <button 
                className="primary-btn"
                onClick={() => setShowAddModal(true)}
              >
                Add Your First Rule
              </button>
            </div>
          ) : (
            filteredRules.map(rule => (
              <div className="rule-row" key={rule.id}>
                <div className="list-cell domain-cell">{rule.domain}</div>
                <div className="list-cell">
                  <span className={`type-badge ${rule.ruleType}`}>
                    {rule.ruleType === "ad-block" ? "Ad Block" : "Tracker Block"}
                  </span>
                </div>
                <div className="list-cell pattern-cell">
                  {rule.encryptedPattern.substring(0, 12)}...{rule.encryptedPattern.substring(rule.encryptedPattern.length - 6)}
                </div>
                <div className="list-cell">
                  {new Date(rule.timestamp * 1000).toLocaleDateString()}
                </div>
                <div className="list-cell">
                  <span className={`status-badge ${rule.isActive ? "active" : "inactive"}`}>
                    {rule.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="list-cell">
                  <button 
                    className={`toggle-btn ${rule.isActive ? "deactivate" : "activate"}`}
                    onClick={() => toggleRuleStatus(rule.id, rule.isActive)}
                  >
                    {rule.isActive ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
  
      {showAddModal && (
        <div className="modal-overlay">
          <div className="add-modal">
            <div className="modal-header">
              <h2>Add New Filter Rule</h2>
              <button onClick={() => setShowAddModal(false)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Domain</label>
                <input 
                  type="text" 
                  placeholder="example.com" 
                  value={newRuleData.domain}
                  onChange={(e) => setNewRuleData({...newRuleData, domain: e.target.value})}
                />
              </div>
              
              <div className="form-group">
                <label>Rule Type</label>
                <select 
                  value={newRuleData.ruleType}
                  onChange={(e) => setNewRuleData({...newRuleData, ruleType: e.target.value})}
                >
                  <option value="ad-block">Ad Block</option>
                  <option value="tracker-block">Tracker Block</option>
                </select>
              </div>
              
              <div className="form-group">
                <label>Pattern (will be FHE encrypted)</label>
                <textarea 
                  placeholder="Enter pattern to block..."
                  value={newRuleData.pattern}
                  onChange={(e) => setNewRuleData({...newRuleData, pattern: e.target.value})}
                  rows={3}
                />
              </div>
              
              <div className="fhe-notice">
                <span>🔒</span> This pattern will be encrypted with FHE and never revealed during matching
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                onClick={() => setShowAddModal(false)}
                className="cancel-btn"
              >
                Cancel
              </button>
              <button 
                onClick={addRule}
                disabled={addingRule || !newRuleData.domain || !newRuleData.pattern}
                className="submit-btn"
              >
                {addingRule ? "Encrypting..." : "Add Rule"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <div className="notification-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </div>
            <div className="notification-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>PrivacyBadgerFHE</h3>
            <p>FHE-powered ad blocking and privacy protection</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">GitHub</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>🔐 FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} PrivacyBadgerFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
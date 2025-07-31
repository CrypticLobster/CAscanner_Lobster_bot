const { Network, Alchemy, Utils } = require("alchemy-sdk");
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const { ethers } = require("ethers");
const axios = require("axios");
require("dotenv").config();
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection:", reason);
});

const app = express();
const port = process.env.PORT || 3000;
const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Set available commands
bot.setMyCommands([
  { command: "start", description: "Subscribe to notifications" },
  { command: "stop", description: "Unsubscribe from notifications" },
  { command: "list", description: "View your active subscriptions" },
  { command: "help", description: "Get available commands" },
]);

const threadSubscriptions = new Map(); // key = `${chatId}:${messageThreadId}`


function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const helpMessage = `
*Available commands*:
/start <value> <ticker> - Subscribe to notifications for tokens with balance >= <value> ETH + <ticker>
/stop <value> <ticker> - Unsubscribe from notifications for <value> ETH
/list - View your active subscriptions
/help - Get available commands
`;

//Start command with value and ticker
// Example: /start 2.2 ETH
// If no value is provided, it defaults to 2.2 ETH
// If no ticker is provided, it defaults to ETH
// If ticker is provided, it will be used in the notification message
bot.onText(/\/start(.+)?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const input = match[1] ? match[1].trim().split(" ") : [];

  let optionalTicker = null;
  let chainId = 1;

  if (input.length > 0) optionalTicker = input[0].toUpperCase();
  if (input.length > 1 && input[1].toLowerCase() === "base") chainId = 8453;

  const threadId = msg.message_thread_id || "default";
  const key = `${chatId}:${threadId}`;

  if (!optionalTicker) {
    return bot.sendMessage(chatId, "Please provide a ticker to subscribe to. Example: `/start PONK base`", {
      parse_mode: "Markdown",
      ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
    });
  }

  if (!threadSubscriptions.has(key)) {
    threadSubscriptions.set(key, new Set());
  }

  const subSet = threadSubscriptions.get(key);
  subSet.add(JSON.stringify({ eth: 0, ticker: optionalTicker, chain: chainId }));

  const reply = `🔔 You will now receive *all new tokens* with ticker '${optionalTicker}' on ${chainId === 1 ? "Ethereum" : "Base"}.\n\nTotal filters in this topic: ${subSet.size}`;
  const options = {
    parse_mode: "Markdown",
    ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
  };

  bot.sendMessage(chatId, reply, options);
});




bot.onText(/\/stop(.+)?/, (msg, match) => {
  const chatId = msg.chat.id;
  const threadId = msg.message_thread_id || "default";
  const key = `${chatId}:${threadId}`;
  const input = match[1] ? match[1].trim().split(" ") : [];

  let optionalTicker = null;
  let chainId = 1;

  if (input.length > 0) optionalTicker = input[0].toUpperCase();
  if (input.length > 1 && input[1].toLowerCase() === "base") chainId = 8453;

  if (!optionalTicker) {
    return bot.sendMessage(chatId, "Please provide a ticker to unsubscribe from. Example: `/stop PONK base`", {
      ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
    });
  }

  const threadSubs = threadSubscriptions.get(key);
  if (!threadSubs || threadSubs.size === 0) {
    return bot.sendMessage(chatId, "You have no active subscriptions in this topic.", {
      ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
    });
  }

  let found = false;

  for (let sub of threadSubs) {
    try {
      const parsed = JSON.parse(sub);
      if (parsed.ticker === optionalTicker && parsed.chain === chainId) {
        threadSubs.delete(sub);
        found = true;
        bot.sendMessage(chatId, `🛑 Unsubscribed from '${optionalTicker}' on ${chainId === 1 ? "Ethereum" : "Base"}.`, {
          ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
        });
        break;
      }
    } catch (e) {
      console.error("Failed to parse subscription:", e);
    }
  }

  if (!found) {
    bot.sendMessage(chatId, "No matching ticker found in your subscriptions.", {
      ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
    });
  }
});



bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  const threadId = msg.message_thread_id || "default";
  const key = `${chatId}:${threadId}`;

  const threadSubs = threadSubscriptions.get(key);
  const options = {
    parse_mode: "Markdown",
    ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
  };

  if (threadSubs && threadSubs.size > 0) {
    const subscriptions = [...threadSubs].map((s) => {
      try {
        const { ticker, chain } = JSON.parse(s);
        const chainLabel = chain === 8453 ? "Base" : "Ethereum";
        return `• ${ticker} on ${chainLabel}`;
      } catch {
        return `• Unknown subscription: ${s}`;
      }
    }).join("\n");

    const reply = `📋 Your active subscriptions in this topic:\n${subscriptions}`;
    bot.sendMessage(chatId, reply, options);
  } else {
    bot.sendMessage(chatId, "You don't have any active subscriptions in this topic.", options);
  }
});


//help command to show available commands, still missing ticker functionality
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const messageThreadId = msg.message_thread_id;

  bot.sendMessage(chatId, helpMessage, {
    message_thread_id: messageThreadId,
    parse_mode: "Markdown",
  });
});


//FUNCTIONS
function getClientsForChain(chainId) {
  const alchemyKey = process.env.ALCHEMY_API_KEY;

  const network = chainId === 8453 ? Network.BASE_MAINNET : Network.ETH_MAINNET;

  const alchemy = new Alchemy({
    apiKey: alchemyKey,
    network,
  });

  const rpcURL = chainId === 8453
    ? `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`
    : `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`;

  const provider = new ethers.providers.JsonRpcProvider(rpcURL);

  return { alchemy, provider };
}

async function getVerifiedContractData(address, chainId, retries = 3, delay = 5000) {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  const baseURL = chainId === 8453
  ? "https://api.basescan.org/api"
  : "https://api.etherscan.io/api";


  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(baseURL, {
        params: {
          module: "contract",
          action: "getsourcecode",
          address,
          chainid: chainId,
          apikey: apiKey,
        },
      });

      const contractData = res.data.result[0];
      const isVerified = contractData.SourceCode && contractData.SourceCode !== "";

      if (isVerified) {
        return {
          verified: true,
          abi: contractData.ABI,
          contractName: contractData.ContractName,
          sourceCode: contractData.SourceCode,
          ...contractData,
        };
      }
    } catch (err) {
      console.error(`[${chainId}] Etherscan fetch failed (attempt ${i + 1}):`, err.message);
    }

    if (i < retries - 1) await new Promise(resolve => setTimeout(resolve, delay));
  }

  return {
    verified: false,
    abi: null,
    contractName: null,
    sourceCode: null,
  };
}

async function getEthBalanceFormatted(address, provider) {
  const raw = await provider.getBalance(address, "latest");
  return Utils.formatUnits(raw.toString(), "ether");
}

async function calculateMarketCapAndPrice(pairAddress, tokenAddress, tokenDecimals, provider) {
  if (!pairAddress || pairAddress === ethers.constants.AddressZero) return null;

  const pairABI = [
    "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() view returns (address)",
  ];

  const pair = new ethers.Contract(pairAddress, pairABI, provider);

  try {
    const [reserve0, reserve1] = await pair.getReserves();
    const token0 = await pair.token0();

    const tokenAddressLower = tokenAddress.toLowerCase();
    const token0Lower = token0.toLowerCase();

    const tokenReserve = token0Lower === tokenAddressLower ? reserve0 : reserve1;
    const ethReserve = token0Lower === tokenAddressLower ? reserve1 : reserve0;

    const priceInETH = parseFloat(ethers.utils.formatUnits(ethReserve, 18)) /
                       parseFloat(ethers.utils.formatUnits(tokenReserve, tokenDecimals));

    const marketCap = 2 * parseFloat(ethers.utils.formatUnits(ethReserve, 18));

    return {
      priceInETH: priceInETH.toFixed(10),
      marketCap: marketCap.toFixed(2),
    };
  } catch (err) {
    console.error("Error calculating market cap and price:", err);
    return null;
  }
}

async function processBlock(blockNumber, chainId) {
  console.log(`[${chainId}] Processing block:`, blockNumber);
  await delay(3000);
  console.log(`[${chainId}] Fetching transactions...`);

  const { alchemy, provider } = getClientsForChain(chainId);

  let res;
  try {
    res = await alchemy.core.getTransactionReceipts({
      blockNumber: blockNumber.toString(),
    });
  } catch (e) {
    console.error(`[${chainId}] Failed to fetch receipts:`, e.message);
    return;
  }

  if (!res || !Array.isArray(res.receipts)) {
    console.warn(`[${chainId}] Invalid or empty receipts:`, res);
    return;
  }

  const receipts = res.receipts;
  console.log(`[${chainId}] Found ${receipts.length} receipts`);

  for (let response of receipts) {
    if (!response.contractAddress) 
      console.log(`[${chainId}] Skipped: No contract address in tx receipt`, response);
      continue;

    let tokenData;
    try {
      tokenData = await alchemy.core.getTokenMetadata(response.contractAddress);
    } catch (error) {
      if (
        error.code === "SERVER_ERROR" &&
        error.error &&
        error.error.code === -32602
      ) {
        console.error(`[${chainId}] Invalid token contract address: ${response.contractAddress}`);
        continue;
      } else {
        console.error(`[${chainId}] Error fetching token metadata for ${response.contractAddress}:`, error);
        continue;
      }
    }

    if (!tokenData || !tokenData.symbol) {
      console.log(`[${chainId}] Skipping: Missing symbol or not a token.`, tokenData);
      continue;
    }


    console.log("tokenData", tokenData);

    const formattedTokenBalance = await getEthBalanceFormatted(response.contractAddress, provider);
    console.log("formattedTokenBalance", formattedTokenBalance);

    const { deployerAddress } = await alchemy.core.findContractDeployer(response.contractAddress);
    console.log("deployerAddress", deployerAddress);

    const contractData = await getVerifiedContractData(response.contractAddress, chainId);
    const isVerified = contractData.verified;

    const uniswapV2PairAddress = await getUniswapV2PairAddress(response.contractAddress, provider, chainId);
    console.log("uniswapV2PairAddress", uniswapV2PairAddress);

    const lpBalance = await getLPBalance(uniswapV2PairAddress, provider);
    const marketData = await calculateMarketCapAndPrice(uniswapV2PairAddress, response.contractAddress, tokenData.decimals, provider);
    const formattedDeployerBalance = await getEthBalanceFormatted(deployerAddress, provider);
    const formattedLPBalance = ethers.utils.formatEther(lpBalance);

    for (let [key, subscriptions] of threadSubscriptions.entries()) {
      const [chatId, threadId] = key.split(":");

      for (let sub of subscriptions) {
        const { eth, ticker, chain } = JSON.parse(sub);
        if (chain !== chainId) continue;

        console.log(`[${chainId}] Checking ticker: ${tokenData.symbol} vs ${ticker}`);
        if (!ticker || tokenData.symbol.toUpperCase() === ticker.toUpperCase()) {
          const sniperInfo = contractData.sourceCode
            ? analyzeSniperLogic(contractData.sourceCode)
            : "Sniper info: N/A";

          const explorerURL = chainId === 8453 ? "https://basescan.org" : "https://etherscan.io";
          const chainLabel = chainId === 1 ? "ethereum" : "base";
          const message = `🚨 New Token Detected ✅\n\n*Token:* ${tokenData.symbol} (${tokenData.name})\n📬 \`${response.contractAddress}\`\n${marketData ? `💸 *Market Cap:* \`${marketData.marketCap} ETH\`\n📈 *Price:* \`${marketData.priceInETH} ETH\`\n` : ""}📜 [View on Scan](${explorerURL}/address/${response.contractAddress})\n🔗 [View Chart](https://dexscreener.com/${chainLabel}/${response.contractAddress})\n🧾 *Deployer:* [${deployerAddress}](${explorerURL}/address/${deployerAddress})\n\n💰 *Deployer Balance:* \`${formattedDeployerBalance}\` ETH\n\n${sniperInfo}\n\n🕵️‍♂️ *Honeypot Check:* [honeypot.is](https://honeypot.is/${chainLabel}?address=${response.contractAddress})`;

          const options = {
            parse_mode: "Markdown",
            disable_web_page_preview: true,
            ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
          };

          bot.sendMessage(chatId, message, options);
        }
      }
    }
  }
}



const fs = require("fs");

function analyzeSniperLogic(sourceCode) {
  try {
    const patterns = JSON.parse(fs.readFileSync("src/sniper-patterns.json", "utf8")); // pad aangepast
    const found = [];

    for (let { label, pattern } of patterns) {
      const regex = new RegExp(`(\\b(?:${pattern})\\b)[^\\n;=]*[=:\\s]+([^;\\n]*)`, "gi");
      const matches = [...sourceCode.matchAll(regex)];

      if (matches.length > 0) {
        const values = matches.map(match => `${match[1]} = ${match[2].trim()}`);
        found.push(`✅ *${label}*\n${values.join("\n")}`);
      }
    }

    if (found.length === 0) return "No sniper protections detected.";
    return "*Sniper Checks Detected:*\n" + found.join("\n\n");
  } catch (e) {
    console.error("Error analyzing sniper logic:", e);
    return "Sniper info: N/A";
  }
}



//Uniswap v2 Pair Address Function
async function getUniswapV2PairAddress(tokenAddress, provider, chainId) {
  const factoryABI = [
    "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  ];

  const wethAddress = chainId === 8453
    ? "0x4200000000000000000000000000000000000006" // WETH op Base
    : "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // WETH op ETH

  if (chainId === 8453) {
    // Aerodrome factory
    const aerodromeFactory = new ethers.Contract(
      "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
      factoryABI,
      provider
    );

    try {
      const aerodromePair = await aerodromeFactory.getPair(tokenAddress, wethAddress);
      if (aerodromePair && aerodromePair !== ethers.constants.AddressZero) {
        console.log("Found pair on Aerodrome");
        return aerodromePair;
      }
    } catch (err) {
      console.error("[BASE] Aerodrome check failed:", err.message);
    }

    // fallback: Uniswap V2 on Base
    const uniswapFactory = new ethers.Contract(
      "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
      factoryABI,
      provider
    );

    try {
      const uniswapPair = await uniswapFactory.getPair(tokenAddress, wethAddress);
      if (uniswapPair && uniswapPair !== ethers.constants.AddressZero) {
        console.log("Found pair on Uniswap V2 (Base)");
        return uniswapPair;
      }
    } catch (err) {
      console.error("[BASE] Uniswap V2 fallback failed:", err.message);
    }

    console.log("No LP pair found on Base for this token.");
    return null;
  }

  // ETH default (Uniswap V2)
  const ethFactory = new ethers.Contract(
    "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    factoryABI,
    provider
  );

  try {
    const ethPair = await ethFactory.getPair(tokenAddress, wethAddress);
    return ethPair !== ethers.constants.AddressZero ? ethPair : null;
  } catch (err) {
    console.error("[ETH] Uniswap V2 check failed:", err.message);
    return null;
  }
}



async function getLPBalance(pairAddress, provider) {
  if (!pairAddress || pairAddress === ethers.constants.AddressZero) {
    return ethers.BigNumber.from(0);
  }

  const pairABI = [
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() external view returns (address)",
  ];

  const pair = new ethers.Contract(pairAddress, pairABI, provider);

  try {
    const [reserve0, reserve1] = await pair.getReserves();
    const token0 = await pair.token0();

    const wethAddresses = [
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // ETH
      "0x4200000000000000000000000000000000000006"  // BASE
    ];

    const ethReserve = wethAddresses.includes(token0.toLowerCase())
      ? reserve0
      : reserve1;

    return ethers.BigNumber.from(ethReserve);
  } catch (error) {
    console.error("Error getting LP balance:", error);
    return ethers.BigNumber.from(0);
  }
}

async function main() {
  // ETH
  const { alchemy: ethAlchemy } = getClientsForChain(1);
  ethAlchemy.ws.on("block", (blockNumber) => {
    processBlock(blockNumber, 1);
  });

  // BASE
  const { alchemy: baseAlchemy } = getClientsForChain(8453);
  baseAlchemy.ws.on("block", (blockNumber) => {
    processBlock(blockNumber, 8453);
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  main();
});

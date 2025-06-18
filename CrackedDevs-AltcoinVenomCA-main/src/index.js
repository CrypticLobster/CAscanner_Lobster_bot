const { Network, Alchemy, Utils } = require("alchemy-sdk");
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const { ethers } = require("ethers");
const axios = require("axios");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// Optional Config object, but defaults to demo api-key and eth-mainnet.
const settings = {
  apiKey: process.env.ALCHEMY_API_KEY, // Replace with your Alchemy API Key.
  network: Network.ETH_MAINNET, // Replace with your network.
};

const alchemy = new Alchemy(settings);
const token = process.env.TELEGRAM_TOKEN;
const provider = new ethers.providers.JsonRpcProvider(
  process.env.ALCHEMY_RPC_URL
);

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
  const ethValue = Number(input[0]) || 2.2;
  const optionalTicker = input[1] ? input[1].toUpperCase() : null;

  const threadId = msg.message_thread_id || "default";
  const key = `${chatId}:${threadId}`;

  if (!threadSubscriptions.has(key)) {
    threadSubscriptions.set(key, new Set());
  }

  const subSet = threadSubscriptions.get(key);
  subSet.add(JSON.stringify({ eth: ethValue, ticker: optionalTicker }));

  console.log(`New subscription for thread ${key}:`, {
    ethValue,
    ticker: optionalTicker,
  });

  let reply = `You will receive alerts for tokens with a balance ≥ ${ethValue} ETH`;
  if (optionalTicker) reply += ` and ticker '${optionalTicker}'`;
  reply += `\n\n🔔 Total filters in this topic: ${subSet.size}`;

  const options = {
    parse_mode: "Markdown",
    ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
  };

  bot.sendMessage(chatId, reply, options);
});



// stop command with value and optional ticker (per thread/topic)
bot.onText(/\/stop(.+)?/, (msg, match) => {
  const chatId = msg.chat.id;
  const messageThreadId = msg.message_thread_id || "default";
  const key = `${chatId}:${messageThreadId}`;

  const input = match[1] ? match[1].trim().split(" ") : [];
  const ethValue = Number(input[0]);
  const optionalTicker = input[1] ? input[1].toUpperCase() : null;

  if (!ethValue || isNaN(ethValue)) {
    bot.sendMessage(chatId, "Please provide a valid ETH value to unsubscribe.", {
      ...(messageThreadId !== "default" && { message_thread_id: Number(messageThreadId) }),
    });
    return;
  }

  const subscriptionKey = JSON.stringify({ eth: ethValue, ticker: optionalTicker });

  const threadSubs = threadSubscriptions.get(key);

  if (threadSubs && threadSubs.has(subscriptionKey)) {
    threadSubs.delete(subscriptionKey);

    const reply = `Unsubscribed from notifications for ≥ ${ethValue} ETH${optionalTicker ? ` + ${optionalTicker}` : ""}.`;

    bot.sendMessage(chatId, reply, {
      ...(messageThreadId !== "default" && { message_thread_id: Number(messageThreadId) }),
    });
  } else {
    const reply = "No matching subscription found for that value/ticker.";

    bot.sendMessage(chatId, reply, {
      ...(messageThreadId !== "default" && { message_thread_id: Number(messageThreadId) }),
    });
  }
});





// list command to show active subscriptions in the current topic
bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  const messageThreadId = msg.message_thread_id || "default";
  const key = `${chatId}:${messageThreadId}`;

  const threadSubs = threadSubscriptions.get(key);

  const options = {
    parse_mode: "Markdown",
    ...(messageThreadId !== "default" && { message_thread_id: Number(messageThreadId) }),
  };

  if (threadSubs && threadSubs.size > 0) {
    const subscriptions = [...threadSubs].map((s) => {
      try {
        const { eth, ticker } = JSON.parse(s);
        return `• ≥ ${eth} ETH${ticker ? ` + ${ticker}` : ""}`;
      } catch {
        return `• Unknown subscription: ${s}`;
      }
    }).join("\n");

    const reply = `Your active subscriptions in this topic:\n${subscriptions}`;
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
async function getVerifiedContractData(address, retries = 3, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get("https://api.etherscan.io/api", {
        params: {
          module: "contract",
          action: "getsourcecode",
          address,
          apikey: process.env.ETHERSCAN_API_KEY,
        }
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
      console.error(`Etherscan fetch failed (attempt ${i + 1}):`, err.message);
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

async function getEthBalanceFormatted(address) {
  const raw = await alchemy.core.getBalance(address, "latest");
  return Utils.formatUnits(raw.toString(), "ether");
}

async function processBlock(blockNumber) {
  console.log("Processing block:", blockNumber);
  await delay(3000);
  console.log("Fetching transactions...");

  const { receipts } = await alchemy.core.getTransactionReceipts({
    blockNumber: blockNumber.toString(),
  });

  for (let response of receipts) {
    if (!response.contractAddress) continue;

    let tokenData;
    try {
      tokenData = await alchemy.core.getTokenMetadata(response.contractAddress);
    } catch (error) {
      if (
        error.code === "SERVER_ERROR" &&
        error.error &&
        error.error.code === -32602
      ) {
        console.error(`Invalid token contract address: ${response.contractAddress}`);
        continue;
      } else {
        console.error(`Error fetching token metadata for ${response.contractAddress}:`, error);
        continue;
      }
    }

    if (!tokenData || tokenData.decimals <= 0) {
      console.log("Not an ERC20 token:", tokenData);
      continue;
    }

    console.log("tokenData", tokenData);

    const formattedTokenBalance = await getEthBalanceFormatted(response.contractAddress);
    console.log("formattedTokenBalance", formattedTokenBalance);

    const { deployerAddress } = await alchemy.core.findContractDeployer(response.contractAddress);
    console.log("deployerAddress", deployerAddress);

    const contractData = await getVerifiedContractData(response.contractAddress);
    const isVerified = contractData.verified;
    const verificationStatus = isVerified
      ? `✅ Verified - ${contractData.contractName || "Unknown"}`
      : "⚠️ Not Verified";

    const uniswapV2PairAddress = await getUniswapV2PairAddress(response.contractAddress);
    console.log("uniswapV2PairAddress", uniswapV2PairAddress);

    const lpBalance = await getLPBalance(uniswapV2PairAddress);
    const isLPFilled = lpBalance.gt(0);
    console.log("lpBalance", lpBalance);

    const formattedDeployerBalance = await getEthBalanceFormatted(deployerAddress);
    const formattedLPBalance = ethers.utils.formatEther(lpBalance);
    console.log("formattedLPBalance", formattedLPBalance);

    // Loop door alle actieve threads (chatId:threadId → subscriptions)
    for (let [key, subscriptions] of threadSubscriptions.entries()) {
      const [chatId, threadId] = key.split(":");

      for (let sub of subscriptions) {
        const { eth, ticker } = JSON.parse(sub);
        console.log(`Checking token: ${tokenData.symbol?.toUpperCase()} vs filter: ${ticker}`);
        console.log("---------------CHAT MSG ------------------");
        console.log("formattedTokenBalance", formattedTokenBalance);
        console.log("isLPFilled", isLPFilled);

        if (parseFloat(formattedTokenBalance) >= eth || parseFloat(formattedLPBalance) >= eth) {
          if (ticker && tokenData.symbol.toUpperCase() !== ticker.toUpperCase()) continue;

          console.log("sending to chatId", chatId);

          const sniperInfo = contractData.sourceCode
            ? analyzeSniperLogic(contractData.sourceCode)
            : "Sniper info: N/A";

          const message = `
            *🚨 New Token Detected!*\n
            *Token:* ${tokenData.symbol} (${tokenData.name})
            ${verificationStatus}

            📜 *Contract:* [View on Etherscan](https://etherscan.io/address/${response.contractAddress})
            🔗 *Dexscreener:* [View Chart](https://dexscreener.com/ethereum/${response.contractAddress})
            🧾 *Deployer:* [${deployerAddress}](https://etherscan.io/address/${deployerAddress})

            💰 *Deployer Balance:* \`${formattedDeployerBalance}\` ETH
            💧 *LP Balance:* \`${formattedLPBalance}\` ETH

            ${sniperInfo}

            🕵️‍♂️ *Honeypot Check:* [honeypot.is](https://honeypot.is/ethereum?address=${response.contractAddress})
            \`${response.contractAddress}\`
          `;
          
          const options = {
            parse_mode: "Markdown",
            disable_web_page_preview: true,
            ...(threadId !== "default" && { message_thread_id: Number(threadId) }),
          };

          bot.sendMessage(chatId, message, options);

          console.log("we got the required address", response.contractAddress);
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
async function getUniswapV2PairAddress(tokenAddress) {
  const uniswapV2FactoryAddress = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
  const uniswapV2FactoryABI = [
    "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  ];

  const uniswapV2Factory = new ethers.Contract(
    uniswapV2FactoryAddress,
    uniswapV2FactoryABI,
    provider
  );

  const wethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // WETH address on mainnet

  try {
    const pairAddress = await uniswapV2Factory.getPair(
      tokenAddress,
      wethAddress
    );
    return pairAddress;
  } catch (error) {
    console.error("Error getting Uniswap V2 pair address:", error);
    return null;
  }
}

async function getLPBalance(pairAddress) {
  if (!pairAddress || pairAddress === ethers.constants.AddressZero) {
    return ethers.BigNumber.from(0);
  }

  const uniswapV2PairABI = [
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() external view returns (address)",
  ];

  const uniswapV2Pair = new ethers.Contract(
    pairAddress,
    uniswapV2PairABI,
    provider
  );

  try {
    const [reserve0, reserve1] = await uniswapV2Pair.getReserves();
    const token0 = await uniswapV2Pair.token0();

    const wethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    const ethReserve =
      token0.toLowerCase() === wethAddress.toLowerCase() ? reserve0 : reserve1;

    return ethers.BigNumber.from(ethReserve);
  } catch (error) {
    console.error("Error getting LP balance:", error);
    return ethers.BigNumber.from(0);
  }
}

async function main() {
  alchemy.ws.on("block", async (blockNumber) => {
    try {
      await processBlock(blockNumber);
    } catch (e) {
      console.log("error in b2", e);
    }
  });

  // testing data for development

  // await processBlock(20901016);
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

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

const userSubscriptions = new Map();
const userChatId_messageThreadId = new Map();

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
  //debugging
  console.log("---------------------------------");
  console.log("msg:", msg);
  const chatId = msg.chat.id;
  console.log("---------------------------------");
  console.log("msg:", msg);
  //end debugging
  
  //constants start
  const input = match[1] ? match[1].trim().split(" ") : [];
  const ethValue = Number(input[0]) || 2.2;
  const optionalTicker = input[1] ? input[1].toUpperCase() : null;

  if (!userSubscriptions.has(chatId)) {
    userSubscriptions.set(chatId, new Set());
  }

  userSubscriptions
    .get(chatId)
    .add(JSON.stringify({ eth: ethValue, ticker: optionalTicker }));

  if (msg.message_thread_id) {
    if (!userChatId_messageThreadId.has(chatId)) {
      userChatId_messageThreadId.set(chatId, new Set());
    }
    userChatId_messageThreadId.get(chatId).add(msg.message_thread_id);
  }

  console.log(`New subscription for chat ${chatId}:`, {
    ethValue,
    ticker: optionalTicker,
  });

  let reply = `You will receive alerts for tokens with a balance ≥ ${ethValue} ETH`;
  if (optionalTicker) reply += ` and ticker '${optionalTicker}'`;

  bot.sendMessage(chatId, reply);
});



//stop command with value and ticker 
bot.onText(/\/stop(.+)?/, (msg, match) => {
  const chatId = msg.chat.id;
  const messageThreadId = msg.message_thread_id;

  const input = match[1] ? match[1].trim().split(" ") : [];
  const ethValue = Number(input[0]);
  const optionalTicker = input[1] ? input[1].toUpperCase() : null;

  if (!ethValue || isNaN(ethValue)) {
    bot.sendMessage(chatId, "Please provide a valid ETH value to unsubscribe.");
    return;
  }

  const subscriptionKey = JSON.stringify({ eth: ethValue, ticker: optionalTicker });

  if (userSubscriptions.has(chatId)) {
    const userSet = userSubscriptions.get(chatId);
    if (userSet.has(subscriptionKey)) {
      userSet.delete(subscriptionKey);

      const reply = `Unsubscribed from notifications for ≥ ${ethValue} ETH${optionalTicker ? ` + ${optionalTicker}` : ""}.`;
      const options = messageThreadId
        ? { message_thread_id: messageThreadId }
        : {};

      bot.sendMessage(chatId, reply, options);
    } else {
      bot.sendMessage(
        chatId,
        "No matching subscription found for that value/ticker.",
        messageThreadId ? { message_thread_id: messageThreadId } : {}
      );
    }
  } else {
    const reply = "You don't have any active subscriptions.";
    const options = messageThreadId
      ? { message_thread_id: messageThreadId }
      : {};
    bot.sendMessage(chatId, reply, options);
  }
});




//list command to show active subscriptions
// It will show the ETH value and ticker if available
bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  const messageThreadId = msg.message_thread_id;

  if (userSubscriptions.has(chatId) && userSubscriptions.get(chatId).size > 0) {
    const subscriptions = Array.from(userSubscriptions.get(chatId))
      .map((s) => {
        try {
          const { eth, ticker } = JSON.parse(s);
          return `• ≥ ${eth} ETH${ticker ? ` + ${ticker}` : ""}`;
        } catch {
          return `• Unknown subscription: ${s}`;
        }
      })
      .join("\n");

    const reply = `Your active subscriptions:\n${subscriptions}`;
    const options = {
      parse_mode: "Markdown",
      ...(messageThreadId && { message_thread_id: messageThreadId }),
    };

    bot.sendMessage(chatId, reply, options);
  } else {
    const reply = "You don't have any active subscriptions.";
    const options = messageThreadId
      ? { message_thread_id: messageThreadId }
      : {};
    bot.sendMessage(chatId, reply, options);
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
// Function to get the source code of a contract from Etherscan
async function getContractSource(contractAddress) {
  console.log("------------------TRYING TO GET SOURCE CODE---------------");
  console.log("contractAddress", contractAddress);
  console.log("---------------------------------");
  try {
    const apiKey = process.env.ETHERSCAN_API_KEY;
    const url = `https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${apiKey}`;

    const response = await axios.get(url);

    if (response.data.status === "1" && response.data.result[0].SourceCode) {
      return response.data.result[0].SourceCode;
    } else {
      console.log("Contract is not verified or source code is not available.");
      return null;
    }
  } catch (error) {
    console.error("Error fetching contract source:", error);
    return null;
  }
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
      console.log("not erc20 token", tokenData);
      continue;
    }

    console.log("tokenData", tokenData);
    let formatedBalance = Utils.formatUnits(
      (await alchemy.core.getBalance(response.contractAddress, "latest")).toString(),
      "ether"
    );
    console.log("formatedBalance", formatedBalance);

    const { deployerAddress } = await alchemy.core.findContractDeployer(response.contractAddress);
    console.log("deployerAddress", deployerAddress);

    const isVerified = await isContractVerified(response.contractAddress);
    console.log("isVerified", isVerified); 
    
    let verificationStatus = isVerified ? "✅ Verified" : "⚠️ Not Verified";


    const uniswapV2PairAddress = await getUniswapV2PairAddress(response.contractAddress);
    console.log("uniswapV2PairAddress", uniswapV2PairAddress);

    const lpBalance = await getLPBalance(uniswapV2PairAddress);
    const isLPFilled = lpBalance.gt(0);
    console.log("lpBalance", lpBalance);

    const formattedDeployerBalance = Utils.formatUnits(
      (await alchemy.core.getBalance(deployerAddress, "latest")).toString(),
      "ether"
    );
    const formattedLPBalance = ethers.utils.formatEther(lpBalance);
    console.log("formattedLPBalance", formattedLPBalance);

    for (let [chatId, subscriptions] of userSubscriptions.entries()) {
      for (let sub of subscriptions) {
        const { eth, ticker } = JSON.parse(sub);
        console.log(`Checking token: ${tokenData.symbol?.toUpperCase()} vs filter: ${ticker}`);
        console.log("---------------CHAT MSG ------------------");
        console.log("formatedBalance", formatedBalance);
        console.log("isLPFilled", isLPFilled);

        if (formatedBalance >= eth || formattedLPBalance >= eth) {
          if (ticker && tokenData.symbol.toUpperCase() !== ticker.toUpperCase()) continue;

          console.log("sending to chatId", chatId);
          const verificationStatus = isVerified ? "✅ Verified" : "⚠️ Not Verified";
          const sourceCode = await getContractSource(response.contractAddress);
          const sniperInfo = analyzeSniperLogic(sourceCode);

          const message = `*New Gem Detected* ✅

          *Name*: ${tokenData.name}
          *Symbol*: ${tokenData.symbol}

          *Link*: https://dexscreener.com/ethereum/${response.contractAddress}
          *Contract Address*: [${response.contractAddress}](https://etherscan.io/address/${response.contractAddress})\`${response.contractAddress}\`
          *Deployer Address*: [${deployerAddress}](https://etherscan.io/address/${deployerAddress})

          *Deployer Balance*: \`${formattedDeployerBalance}\` ETH
          *Uniswap LP Balance*: \`${formattedLPBalance}\` ETH

          ${verificationStatus}

          ${sniperInfo}

          [Honeypot](https://honeypot.is/ethereum?address=${response.contractAddress})`;


          if (userChatId_messageThreadId.has(chatId)) {
            for (let messageThreadId of userChatId_messageThreadId.get(chatId)) {
              bot.sendMessage(chatId, message, {
                message_thread_id: messageThreadId,
                parse_mode: "Markdown",
                disable_web_page_preview: true,
              });
            }
          } else {
            bot.sendMessage(chatId, message, {
              parse_mode: "Markdown",
              disable_web_page_preview: true,
            });
          }

          console.log("we got the required address", response.contractAddress);
        }
      }
    }
  }
}

//Contract Verification Check Function
async function isContractVerified(contractAddress) {
  try {
    const apiKey = process.env.ETHERSCAN_API_KEY;
    const url = `https://api.etherscan.io/api?module=contract&action=getabi&address=${contractAddress}&apikey=${apiKey}`;

    const response = await axios.get(url);

    return (
      response.data.status === "1" &&
      response.data.result !== "Contract source code not verified"
    );
  } catch (error) {
    console.error("Error checking contract verification:", error);
    return false;
  }
  }

const fs = require("fs");

function analyzeSniperLogic(sourceCode) {
  try {
    const patterns = JSON.parse(fs.readFileSync("sniper-patterns.json", "utf8"));
    const found = [];

    for (let { label, pattern } of patterns) {
      const regex = new RegExp(pattern, "i");
      if (regex.test(sourceCode)) {
        found.push(`✅ ${label}`);
      }
    }

    if (found.length === 0) return "No sniper protections detected.";
    return "*Sniper Checks Detected:*\n" + found.join("\n");
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

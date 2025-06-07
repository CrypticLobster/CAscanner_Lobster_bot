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
/start <value> - Subscribe to notifications for tokens with balance >= <value> ETH
/stop <value> - Unsubscribe from notifications for <value> ETH
/list - View your active subscriptions
/help - Get available commands
`;

bot.onText(/\/start(.+)?/, async (msg, match) => {
  console.log("---------------------------------");
  console.log("msg:", msg);
  const chatId = msg.chat.id;
  console.log("---------------------------------");
  console.log("msg:", msg);
  const ethValue = match[1] ? Number(match[1].trim()) : 2.2;

  if (!userSubscriptions.has(chatId)) {
    userSubscriptions.set(chatId, new Set());
  }
  userSubscriptions.get(chatId).add(Number(ethValue));
  if (msg.message_thread_id) {
    if (!userChatId_messageThreadId.has(chatId)) {
      userChatId_messageThreadId.set(chatId, new Set());
    }
    userChatId_messageThreadId.get(chatId).add(msg.message_thread_id);
  }
  // test();
  bot.sendMessage(
    chatId,
    `Welcome, ${msg.from.first_name}! 👋\n*You have successfully subscribed to the bot* 🚀.\nYou will receive notifications when a token with a balance of *${ethValue} ETH* or more is detected. 💰\n\nUse /help to view available commands.`,
    {
      message_thread_id: msg.message_thread_id,
      parse_mode: "Markdown",
    }
  );
  // console.log("msg.message_thread_id:", msg.message_thread_id);
  console.log("chatId:", chatId);
});

bot.onText(/\/stop (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const messageThreadId = msg.message_thread_id;
  const ethValue = Number(match[1].trim());

  if (userSubscriptions.has(chatId)) {
    userSubscriptions.get(chatId).delete(ethValue);
    if (userChatId_messageThreadId.has(chatId)) {
      bot.sendMessage(
        chatId,
        `You have unsubscribed from notifications for ${ethValue} ETH.`,
        {
          message_thread_id: messageThreadId,
        }
      );
    } else {
      bot.sendMessage(
        chatId,
        `You have unsubscribed from notifications for ${ethValue} ETH.`
      );
    }
  } else {
    if (messageThreadId) {
      bot.sendMessage(chatId, "You don't have any active subscriptions.", {
        message_thread_id: messageThreadId,
      });
    } else {
      bot.sendMessage(chatId, "You don't have any active subscriptions.");
    }
  }
});

bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  const messageThreadId = msg.message_thread_id;

  if (userSubscriptions.has(chatId) && userSubscriptions.get(chatId).size > 0) {
    const subscriptions = Array.from(userSubscriptions.get(chatId)).join(", ");
    if (userChatId_messageThreadId.has(chatId)) {
      bot.sendMessage(
        chatId,
        `Your active subscriptions: ${subscriptions} ETH`,
        { message_thread_id: messageThreadId }
      );
    } else {
      bot.sendMessage(
        chatId,
        `Your active subscriptions: ${subscriptions} ETH`
      );
    }
  } else {
    if (messageThreadId) {
      bot.sendMessage(chatId, "You don't have any active subscriptions.", {
        message_thread_id: messageThreadId,
      });
    } else {
      bot.sendMessage(chatId, "You don't have any active subscriptions.");
    }
  }
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const messageThreadId = msg.message_thread_id;

  bot.sendMessage(chatId, helpMessage, {
    message_thread_id: messageThreadId,
    parse_mode: "Markdown",
  });
});

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

async function extractLinks(sourceCode) {
  let website = "";
  let telegram = "";
  let x = ""; // for Twitter/X

  const websiteMatch = sourceCode.match(
    /([\w+]+\:\/\/)?([\w\d-]+\.)*[\w-]+[\.\:]\w+([\/\?\=\&\#\.]?[\w-]+)*\/?/gm
  );
  console.log(websiteMatch);

  for (let link of websiteMatch) {
    link = link.toLowerCase();
    if (link.includes("t.me") && !telegram) {
      telegram = link;
    } else if (
      (link.includes("x.com") ||
        link.includes("twitter.com") ||
        link.includes("Twitter")) &&
      !x
    ) {
      x = link;
    } else if (
      !link.includes("openzeppelin") &&
      !link.includes("eips") &&
      !link.includes("Etherscan") &&
      !link.includes("etherscan") &&
      !website &&
      !/^\d+$/.test(link)
    ) {
      website = link;
    }
    if (website && telegram && x) {
      break;
    }
  }

  // Check for nhttps and nhttp and replace them with https and http respectively
  if (website.includes("nhttps")) {
    website = website.replace("nhttps", "https");
  } else if (website.includes("nhttp")) {
    website = website.replace("nhttp", "http");
  }

  if (telegram.includes("nhttps")) {
    telegram = telegram.replace("nhttps", "https");
  } else if (telegram.includes("nhttp")) {
    telegram = telegram.replace("nhttp", "http");
  }

  if (x.includes("nhttps")) {
    x = x.replace("nhttps", "https");
  } else if (x.includes("nhttp")) {
    x = x.replace("nhttp", "http");
  }

  return { website, telegram, x };
}

async function processBlock(blockNumber) {
  console.log("Processing block:", blockNumber);
  await delay(3000);

  console.log("Fetching transactions...");

  let { receipts } = await alchemy.core.getTransactionReceipts({
    blockNumber: blockNumber.toString(),
  });
  // for (let response of receipts) {

  // }

  for (let response of receipts) {
    // console.log("response", response);
    if (response.contractAddress) {
      let tokenData;

      try {
        tokenData = await alchemy.core.getTokenMetadata(
          response.contractAddress
        );
      } catch (error) {
        if (
          error.code === "SERVER_ERROR" &&
          error.error &&
          error.error.code === -32602
        ) {
          console.error(
            `Invalid token contract address: ${response.contractAddress}`
          );
          continue; // Skip to the next iteration of the loop
        } else {
          console.error(
            `Error fetching token metadata for ${response.contractAddress}:`,
            error
          );
          continue; // Skip to the next iteration of the loop
        }
      }

      if (tokenData.decimals > 0) {
        console.log("tokenData", tokenData);
        console.log("got erc20 token", tokenData);
        let balance = await alchemy.core.getBalance(
          response.contractAddress,
          "latest"
        );
        let formatedBalance = Utils.formatUnits(balance.toString(), "ether");
        console.log("formatedBalance", formatedBalance);
        let { deployerAddress } = await alchemy.core.findContractDeployer(
          response.contractAddress
        );
        console.log("deployerAddress", deployerAddress);

        console.log("-------------BLOCKING EXECUTION-------------");
        await delay(60000);
        console.log("-------------UNBLOCKING EXECUTION-------------");
        // Check if the token is low risk using Honeypot API
        // try {
        //   const honeypotResponse = await axios.get(
        //     `https://api.honeypot.is/v2/IsHoneypot?address=${response.contractAddress}&forceSimulateLiquidity=true&chainID=1`
        //   );
        //   const riskLevel = honeypotResponse.data.summary.risk;

        //   if (riskLevel !== "low") {
        //     console.log(
        //       `Skipping high risk token: ${response.contractAddress}`
        //     );
        //     continue; // Skip to the next iteration if the token is not low risk
        //   }
        // } catch (error) {
        //   console.error("Error checking Honeypot API:", error.response.data);
        //   continue; // Skip to the next iteration if there's an error
        // }
        const isVerified = await isContractVerified(response.contractAddress);
        console.log("isVerified", isVerified);

        // verified contract
        let website = null;
        let telegram = null;
        let x = null;
        let sourceCode = null;

        if (isVerified) {
          sourceCode = await getContractSource(response.contractAddress);
          // console.log("sourceCode", sourceCode);
          if (sourceCode) {
            const links = await extractLinks(sourceCode);
            website = links.website;
            telegram = links.telegram;
            x = links.x;
          }
          console.log("website", website);
          console.log("telegram", telegram);
          console.log("x", x);
        }

        // unverified contract
        const uniswapV2PairAddress = await getUniswapV2PairAddress(
          response.contractAddress
        );
        console.log("uniswapV2PairAddress", uniswapV2PairAddress);
        const lpBalance = await getLPBalance(uniswapV2PairAddress);
        console.log("lpBalance", lpBalance);

        const isLPFilled = lpBalance.gt(0);

        let deployerBalance = await alchemy.core.getBalance(
          deployerAddress,
          "latest"
        );
        let formattedDeployerBalance = Utils.formatUnits(
          deployerBalance.toString(),
          "ether"
        );

        const formattedLPBalance = ethers.utils.formatEther(lpBalance);
        console.log("formattedLPBalance", formattedLPBalance);

        for (let [chatId, subscriptions] of userSubscriptions.entries()) {
          for (let ethValue of subscriptions) {
            console.log("---------------CHAT MSG ------------------");
            console.log("formatedBalance", formatedBalance);
            // console.log("ethValue", ethValue);
            console.log("isLPFilled", isLPFilled);
            if (
              formatedBalance >= Number(ethValue) ||
              formattedLPBalance >= Number(ethValue)
            ) {
              console.log("sending to chatId", chatId);
              console.log("formattedDeployerBalance", formattedDeployerBalance);
              console.log("formattedLPBalance", formattedLPBalance);
              const message = `*New Gem Detected* ✅\n\n*Name*: ${
                tokenData.name
              }\n*Symbol*: ${
                tokenData.symbol
              }\n\n*Link*: https://dexscreener.com/ethereum/${
                response.contractAddress
              }\n*Contract Address*: [${
                response.contractAddress
              }](https://etherscan.io/address/${
                response.contractAddress
              })\n*Deployer Address*: [${deployerAddress}](https://etherscan.io/address/${deployerAddress})\n\n*Deployer Balance*: \`${formattedDeployerBalance}\` ETH\n*Uniswap LP Balance*: \`${formattedLPBalance}\` ETH\n\n ${
                website ? `[Website](${website})  ` : ""
              }${x ? `[X](${x})  ` : ""}${
                telegram ? `[Telegram](${telegram})  ` : ""
              }[Honeypot](https://honeypot.is/ethereum?address=${
                response.contractAddress
              })`;

              if (userChatId_messageThreadId.has(chatId)) {
                for (let messageThreadId of userChatId_messageThreadId.get(
                  chatId
                )) {
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

              console.log(
                "we got the required address",
                response.contractAddress
              );
            }
          }
        }
      } else {
        console.log("not erc20 token", tokenData);
        continue;
      }
    }
  }
}

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

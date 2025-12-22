const express = require("express");
const axios = require("axios");
const qs = require("qs");

const https = require("https");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

const app = express();
app.use(express.json());

// ===== ENVIRONMENT CONFIGURATION =====
const config = {
  // Server Config
  SERVER_PORT: parseInt(process.env.SERVER_PORT || "3000", 10),
  SERVER_HOST: process.env.SERVER_HOST || "0.0.0.0",
  NODE_ENV: process.env.NODE_ENV || "development",

  // Tigo API Config
  TIGO_BASE_URL: process.env.TIGO_BASE_URL,
  TIGO_USERNAME: process.env.TIGO_USERNAME,
  TIGO_PASSWORD: process.env.TIGO_PASSWORD,
  TIGO_TOKEN_ENDPOINT: process.env.TIGO_TOKEN_ENDPOINT,
  TIGO_PUSH_ENDPOINT: process.env.TIGO_PUSH_ENDPOINT,
  TIGO_REQUEST_TIMEOUT: parseInt(process.env.TIGO_REQUEST_TIMEOUT || "15000", 10),

  // Token Config
  TOKEN_EXPIRY_HOURS: parseInt(process.env.TOKEN_EXPIRY_HOURS || "24", 10),

  // Internal Service Config
  INTERNAL_SERVICE_URL: process.env.INTERNAL_SERVICE_URL || "http://localhost:5000",
  INTERNAL_CALLBACK_ENDPOINT: process.env.INTERNAL_CALLBACK_ENDPOINT || "/api/payment-callback",
  INTERNAL_SERVICE_TIMEOUT: parseInt(process.env.INTERNAL_SERVICE_TIMEOUT || "15000", 10),

  // Logging Config
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
};

// Calculate token expiry in milliseconds
config.TOKEN_EXPIRY_MS = config.TOKEN_EXPIRY_HOURS * 60 * 60 * 1000;

// ===== CONFIGURATION VALIDATION =====
function validateConfig() {
  const errors = [];

  if (!config.TIGO_BASE_URL) errors.push("TIGO_BASE_URL is required");
  if (!config.TIGO_USERNAME) errors.push("TIGO_USERNAME is required");
  if (!config.TIGO_PASSWORD) errors.push("TIGO_PASSWORD is required");
  if (!config.INTERNAL_SERVICE_URL) errors.push("INTERNAL_SERVICE_URL is required");
  if (config.SERVER_PORT < 1 || config.SERVER_PORT > 65535) {
    errors.push("SERVER_PORT must be between 1 and 65535");
  }

  if (errors.length > 0) {
    console.error("Configuration validation errors:");
    errors.forEach((err) => console.error(`  - ${err}`));
    return false;
  }

  return true;
}

// ===== LOG CONFIGURATION =====
function logConfiguration() {
  console.log("=".repeat(60));
  console.log("SERVER CONFIGURATION LOADED");
  console.log("=".repeat(60));
  console.log(`Environment: ${config.NODE_ENV}`);
  console.log(`Server: ${config.SERVER_HOST}:${config.SERVER_PORT}`);
  console.log(`Tigo API: ${config.TIGO_BASE_URL}`);
  console.log(`Internal Service: ${config.INTERNAL_SERVICE_URL}`);
  console.log(`Token Expiry: ${config.TOKEN_EXPIRY_HOURS} hours`);
  console.log(`Request Timeout: ${config.TIGO_REQUEST_TIMEOUT}ms`);
  console.log("=".repeat(60));
}

// Validate config on startup
if (!validateConfig()) {
  console.error("Configuration validation failed. Exiting...");
  process.exit(1);
}

logConfiguration();

// ===== TOKEN CACHE =====
let cachedToken = null;
let tokenExpiryTime = null;

function isTokenValid() {
  if (!cachedToken || !tokenExpiryTime) {
    return false;
  }
  const now = Date.now();
  const isValid = now < tokenExpiryTime;
  if (!isValid) {
    console.log(
      "Token expired. Current time:",
      new Date(now).toISOString(),
      "Expiry time:",
      new Date(tokenExpiryTime).toISOString()
    );
    cachedToken = null;
    tokenExpiryTime = null;
  }
  return isValid;
}

// ===== TOKEN REQUEST =====
async function getAccessToken() {
  // Return cached token if still valid
  if (isTokenValid()) {
    console.log(
      "Using cached token. Expires at:",
      new Date(tokenExpiryTime).toISOString()
    );
    return cachedToken;
  }

  console.log("Requesting new token from Tigo...");
  const response = await axios.post(
    `${config.TIGO_BASE_URL}${config.TIGO_TOKEN_ENDPOINT}`,
    qs.stringify({
      username: config.TIGO_USERNAME,
      password: config.TIGO_PASSWORD,
      grant_type: "password",
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "no-cache",
      },
      timeout: config.TIGO_REQUEST_TIMEOUT,
      httpsAgent,
    }
  );

  console.log("Token Response :", {
    status: response?.status,
    data: response?.data,
  });

  // Cache the token
  cachedToken = response.data.access_token;
  tokenExpiryTime = Date.now() + config.TOKEN_EXPIRY_MS;
  console.log(
    "Token cached. Expires at:",
    new Date(tokenExpiryTime).toISOString()
  );

  return cachedToken;
}

// ===== RELAY ENDPOINT =====
app.post("/relay/push-billpay", async (req, res) => {
  try {
    console.log("Incoming request:", req.body);

    // 1. Get token
    const token = await getAccessToken();

    // 2. Call PushBillpay
    const pushResponse = await axios.post(
      `${config.TIGO_BASE_URL}${config.TIGO_PUSH_ENDPOINT}`,
      req.body,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          username: config.TIGO_USERNAME,
          password: config.TIGO_PASSWORD,
          grant_type: "password",
          "Cache-Control": "no-cache",
        },
        timeout: config.TIGO_REQUEST_TIMEOUT,
        httpsAgent,
      }
    );

    // 3. Return response to caller
    console.log("PushBillPay Response :", {
      status: pushResponse?.status,
      data: pushResponse?.data,
    });
    res.status(200).json(pushResponse.data);
  } catch (error) {
    console.error("Relay error:", error.response?.data || error.message);

    res.status(500).json({
      ResponseStatus: false,
      ResponseCode: "BILLER-18-9999-F",
      ResponseDescription: "Failed to relay request",
      Error: error.response?.data || error.message,
    });
  }
});

// ===== CONFIG: INTERNAL SERVICE =====
// ===== CALLBACK FORWARDING =====
async function forwardCallbackToInternalService(callbackData) {
  try {
    console.log("Forwarding callback to internal service:", callbackData);
    
    const internalResponse = await axios.post(
      `${config.INTERNAL_SERVICE_URL}${config.INTERNAL_CALLBACK_ENDPOINT}`,
      callbackData,
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: config.INTERNAL_SERVICE_TIMEOUT,
      }
    );

    console.log("Internal service response:", {
      status: internalResponse?.status,
      data: internalResponse?.data,
    });

    return {
      success: true,
      data: internalResponse.data,
    };
  } catch (error) {
    console.error("Error forwarding to internal service:", {
      message: error.message,
      statusCode: error.response?.status,
      data: error.response?.data,
    });

    return {
      success: false,
      error: error.response?.data || error.message,
    };
  }
}

// ===== CALLBACK (FROM TIGO TO YOU) =====
app.post("/MixByYasPushCallback", async (req, res) => {
  try {
    console.log("Callback received from Tigo:", req.body);

    // Forward to internal service
    const forwardResult = await forwardCallbackToInternalService(req.body);

    if (forwardResult.success) {
      // Success response to Tigo
      console.log("Callback processed successfully");
      return res.status(200).json({
        ResponseCode: "BILLER-18-0000-S",
        ResponseStatus: true,
        ResponseDescription: "Callback successful",
        ReferenceID: req.body.ReferenceID,
      });
    } else {
      // Failure response to Tigo
      console.error("Failed to process callback:", forwardResult.error);
      return res.status(500).json({
        ResponseCode: "BILLER-18-9999-F",
        ResponseStatus: false,
        ResponseDescription: "Failed to process callback",
        ReferenceID: req.body.ReferenceID,
        Error: forwardResult.error,
      });
    }
  } catch (error) {
    console.error("Callback processing error:", error.message);
    return res.status(500).json({
      ResponseCode: "BILLER-18-9999-F",
      ResponseStatus: false,
      ResponseDescription: "Internal server error",
      ReferenceID: req.body.ReferenceID,
      Error: error.message,
    });
  }
});

app.post("/prod/MixByYasPushCallback", async (req, res) => {
  try {
    console.log("Callback received from Tigo (prod):", req.body);

    // Forward to internal service
    const forwardResult = await forwardCallbackToInternalService(req.body);

    if (forwardResult.success) {
      // Success response to Tigo
      console.log("Callback processed successfully (prod)");
      return res.status(200).json({
        ResponseCode: "BILLER-18-0000-S",
        ResponseStatus: true,
        ResponseDescription: "Callback successful",
        ReferenceID: req.body.ReferenceID,
      });
    } else {
      // Failure response to Tigo
      console.error("Failed to process callback (prod):", forwardResult.error);
      return res.status(500).json({
        ResponseCode: "BILLER-18-9999-F",
        ResponseStatus: false,
        ResponseDescription: "Failed to process callback",
        ReferenceID: req.body.ReferenceID,
        Error: forwardResult.error,
      });
    }
  } catch (error) {
    console.error("Callback processing error (prod):", error.message);
    return res.status(500).json({
      ResponseCode: "BILLER-18-9999-F",
      ResponseStatus: false,
      ResponseDescription: "Internal server error",
      ReferenceID: req.body.ReferenceID,
      Error: error.message,
    });
  }
});

app.listen(config.SERVER_PORT, config.SERVER_HOST, () => {
  console.log(`Relay server running on ${config.SERVER_HOST}:${config.SERVER_PORT}`);
});

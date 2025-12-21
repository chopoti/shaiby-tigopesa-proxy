const express = require("express");
const axios = require("axios");
const qs = require("qs");

const https = require("https");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

const app = express();
app.use(express.json());

// ===== CONFIG =====
const TIGO_BASE_URL = "https://sal-accessgwr1.tigo.co.tz:8443";
const USERNAME = "ShabibyTransporterLtd";
const PASSWORD = "saRBJCe";

// ===== TOKEN REQUEST =====
async function getAccessToken() {
  const response = await axios.post(
    `${TIGO_BASE_URL}/ShabibyTranspoter2DMGetToken`,
    qs.stringify({
      username: USERNAME,
      password: PASSWORD,
      grant_type: "password",
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "no-cache",
      },
      timeout: 15000,
       httpsAgent,
    }
  );

  
  console.log("Token Response :", {
  message: response.message,
  status: response?.status,
  data: response?.data,
});
  return response.data.access_token;
}

// ===== RELAY ENDPOINT =====
app.post("/relay/push-billpay", async (req, res) => {
  try {
    console.log("Incoming request:", req.body);

    // 1. Get token
    const token = await getAccessToken();

    // 2. Call PushBillpay
    const pushResponse = await axios.post(
      `${TIGO_BASE_URL}/ShabibyTranspoter2DMPushBillPay`,
      req.body,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          username: USERNAME,
          password: PASSWORD,
          grant_type: "password",
          "Cache-Control": "no-cache",
        },
        timeout: 15000,
         httpsAgent,
      }
    );

    // 3. Return response to caller
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

// ===== CALLBACK (FROM TIGO TO YOU) =====
app.post("/MixByYasPushCallback", (req, res) => {
  console.log("Callback received:", req.body);

  res.json({
    ResponseCode: "BILLER-18-0000-S",
    ResponseStatus: true,
    ResponseDescription: "Callback successful",
    ReferenceID: req.body.ReferenceID,
  });
});

app.post("/prod/MixByYasPushCallback", (req, res) => {
  console.log("Callback received:", req.body);

  res.json({
    ResponseCode: "BILLER-18-0000-S",
    ResponseStatus: true,
    ResponseDescription: "Callback successful",
    ReferenceID: req.body.ReferenceID,
  });
});

app.listen(3000, "0.0.0.0", () => {
  console.log("Relay server running on port 3000");
});

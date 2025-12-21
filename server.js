// server.js
const express = require("express");
const app = express();
app.use(express.json());

app.post("/MixByYasPushCallback", (req, res) => {
  console.log("Callback received:", req.body);
    let response = {
    ResponseCode: "BILLER-18-0000-S",
    ResponseStatus: true,
    ResponseDescription: "Callback successful",
    ReferenceID: req.body['ReferenceID'],
  };
  res.json(response);
});

app.post("/prod/MixByYasPushCallback", (req, res) => {
  console.log("Callback received:", req.body);
    let response = {
    ResponseCode: "BILLER-18-0000-S",
    ResponseStatus: true,
    ResponseDescription: "Callback successful",
    ReferenceID: req.body['ReferenceID'],
  };
  res.json(response);
});

app.listen(3000, '0.0.0.0', () => {
  console.log("Server running on port 3000");
});

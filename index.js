const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

// test route
app.get("/", (req, res) => {
  res.send("ScholarSource server is running ");
});

// start server
app.listen(port, () => {
  console.log(`ScholarSource server running on port ${port}`);
});

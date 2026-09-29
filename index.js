require("dotenv").config();
const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cookieParser = require("cookie-parser");

const app = express();
const port = process.env.PORT || 5000;
const url = process.env.MONGODB_URL;

// Middleware
app.use();
app.use(express.json());
app.use(cookieParser());

const client = new MongoClient(url, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});


async function run() {
  try {
    await client.connect();
    console.log("Connected successfully to MongoDB!");

    const db = client.db("studynook_db");

    

    app.get("/", (req, res) => {
      res.send("StudyNook Server API is running smoothly!");
    });

    app.listen(port, () => {
      console.log(`StudyNook backend server listening on port ${port}`);
    });
  } catch (err) {
    console.error("MongoDB Connection Failed:", err);
  }
}

run().catch(console.dir);

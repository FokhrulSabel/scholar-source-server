const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

//firebase
const admin = require("firebase-admin");
const serviceAccount = require("./scholar-source-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@scholarsourcedb.getbzat.mongodb.net/?appName=ScholarSourceDB`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// test route
app.get("/", (req, res) => {
  res.send("ScholarSource server is running ");
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("ScholarSourceDB");
    const userCollection = db.collection("users");

    // User related API
    app.post("/users", async (req, res) => {
      try {
        const { displayName, email, photoURL, uid } = req.body;

        const exists = await userCollection.findOne({ email });

        if (exists) {
          return res.send(exists);
        }

        const user = {
          displayName,
          email,
          photoURL,
          uid,
          role: "student",
          createdAt: new Date(),
        };

        const result = await userCollection.insertOne(user);

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server Error" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// start server
app.listen(port, () => {
  console.log(`ScholarSource server running on port ${port}`);
});

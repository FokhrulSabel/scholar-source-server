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
    const scholarCollection = db.collection("scholarships");

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

    // scholarships releted api

    // Admin: Add Scholarship API
    app.post("/scholarships", async (req, res) => {
      try {
        const scholarship = req.body;

        // basic validation
        if (!scholarship.scholarshipName || !scholarship.universityName) {
          return res.status(400).send({
            message: "Required fields missing",
          });
        }

        const newScholarship = {
          ...scholarship,
          applicationDeadline: new Date(scholarship.applicationDeadline),
          scholarshipPostDate: new Date(),
          postedUserEmail: req.decoded.email,
        };

        const result = await scholarCollection.insertOne(newScholarship);

        res.status(201).send({
          success: true,
          insertedId: result.insertedId,
        });
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    app.get("/all-scholarships", async (req, res) => {
      try {
        let {
          limit = 8,
          sort,
          search = "",
          subject = "",
          country = "",
          degree = "",
          page = 1,
        } = req.query;
        limit = parseInt(limit);
        page = parseInt(page);
        const query = {};
        if (subject) query.subjectCategory = subject;
        if (country) query.universityCountry = country;
        if (degree) query.degree = degree;
        if (search.trim()) {
          query.$text = { $search: search };
        }
        const total = await scholarCollection.countDocuments(query);
        let cursor = scholarCollection.find(query);
        if (sort === "top") cursor = cursor.sort({ applicationFees: 1 });
        const skip = (page - 1) * limit;
        cursor = cursor.skip(skip).limit(limit);
        const scholarships = await cursor.toArray();
        res.json({
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          scholarships,
        });
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    // Public: Get Single Scholarship
    app.get("/scholarships/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const scholarship = await scholarCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!scholarship) {
          return res.status(404).send({ message: "Scholarship not found" });
        }

        res.send(scholarship);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // Admin: Update Scholarship
    app.put("/scholarships/:id", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const updatedData = req.body;

        const result = await scholarCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData },
        );

        res.send({
          success: true,
          message: "Scholarship updated",
          result,
        });
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    app.get("/scholarships", async (req, res) => {
      try {
        const { limit = 6, page = 1, sort, search, email } = req.query;
        let query = {};

        if (email) {
          query.email = email;
        }

        if (search) {
          query.scholarshipName = { $regex: search, $options: "i" };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        let cursor = scholarCollection.find(query);

        if (sort === "top") {
          cursor = cursor.sort({ rating: -1 });
        }

        const scholarships = await cursor
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();

        const totalCount = await scholarCollection.countDocuments(query);

        res.status(200).json({
          scholarships,
          totalCount,
        });
      } catch (error) {
        res.status(500).send({
          success: false,
          message: error.message,
        });
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

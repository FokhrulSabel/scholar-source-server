const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const stripe = require("stripe")(process.env.STRIPE_SECRET_Key);

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
    const paymentCollection = db.collection("payments");
    const applicationCollection = db.collection("applications");

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

    // Search, Filter, Sort & Pagination
    app.get("/all-scholarships", async (req, res) => {
      try {
        let {
          search = "",
          country = "",
          category = "",
          degree = "",
          sort = "",
          page = 1,
          limit = 6,
        } = req.query;

        page = parseInt(page);
        limit = parseInt(limit);

        const query = {};

        //Search (case-insensitive)
        if (search) {
          query.$or = [
            { scholarshipName: { $regex: search, $options: "i" } },
            { universityName: { $regex: search, $options: "i" } },
            { degree: { $regex: search, $options: "i" } },
          ];
        }

        //Filters
        if (country) query.universityCountry = country;
        if (category) query.scholarshipCategory = category;
        if (degree) query.degree = degree;

        //Sorting
        let sortQuery = {};
        if (sort === "fees_asc") sortQuery.applicationFees = 1;
        if (sort === "fees_desc") sortQuery.applicationFees = -1;
        if (sort === "date") sortQuery.scholarshipPostDate = -1;

        const skip = (page - 1) * limit;

        const total = await scholarCollection.countDocuments(query);

        const scholarships = await scholarCollection
          .find(query)
          .sort(sortQuery)
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          scholarships,
        });
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    app.get("/scholarships", async (req, res) => {
      try {
        const result = await scholarCollection.find().toArray();
        res.status(200).json({ result });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: error.message,
        });
      }
    });

    // Public: Get Single Scholarship
    app.get("/scholarships/:id", async (req, res) => {
      try {
        const id = req.params.id;
        console.log("BACKEND ID:", id);

        let query;

        if (ObjectId.isValid(id)) {
          query = {
            $or: [{ _id: new ObjectId(id) }, { _id: id }],
          };
        } else {
          query = { _id: id };
        }

        const scholarship = await scholarCollection.findOne(query);

        if (!scholarship) {
          return res.status(404).send({ message: "Scholarship not found" });
        }

        res.send(scholarship);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // Admin: Update Scholarship
    app.put("/scholarships/:id", async (req, res) => {
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

    // Admin: Delete Scholarship
    app.delete("/scholarships/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const result = await scholarCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send({
          success: true,
          message: "Scholarship deleted",
        });
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // payment api

    //  Create Checkout Session
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const {
          amount,
          scholarshipName,
          universityName,
          scholarshipId,
          studentEmail,
        } = req.body;
        if (!amount || !studentEmail)
          return res
            .status(400)
            .json({ message: "amount and studentEmail are required" });

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],

          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: { name: scholarshipName },
                unit_amount: Math.round(Number(amount) * 100),
              },
              quantity: 1,
            },
          ],

          mode: "payment",
          customer_email: studentEmail,

          metadata: {
            scholarshipId,
            scholarshipName,
            universityName,
          },

          success_url: `${process.env.CLIENT_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.CLIENT_URL}/payment-failed`,
        });

        res.send({ url: session.url });
      } catch (error) {
        console.log(error);
        res.status(500).send({ message: "Stripe session error" });
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

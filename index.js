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
    const reviewCollection = db.collection("reviews");

    // User related API
    // Create register user by default role student
    app.post("/users", async (req, res) => {
      try {
        const userData = req.body;
        if (!userData?.email)
          return res.status(400).json({ message: "Email is required" });

        // Ensure unique email (DB unique index recommended)
        const exist = await userCollection.findOne({ email: userData.email });
        if (exist)
          return res.status(409).json({ message: "User already exists" });

        userData.role = userData.role || "student";
        userData.createdAt = new Date();
        const result = await userCollection.insertOne(userData);
        res.status(201).json({ success: true, insertedId: result.insertedId });
      } catch (err) {
        console.error("/users POST error:", err.message);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Get users (admin only)
    app.get("/users", async (req, res) => {
      try {
        const { role = "" } = req.query;
        const q = role ? { role } : {};
        const users = await userCollection.find(q).toArray();
        res.status(200).json({ users });
      } catch (err) {
        console.error("/users GET error:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Update user
    app.patch("/users/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!isValidId(id))
          return res.status(400).json({ message: "Invalid id" });
        const data = req.body;
        //allow admin to update
        const target = await userCollection.findOne({ _id: new ObjectId(id) });
        if (!target) return res.status(404).json({ message: "User not found" });

        if (target.email !== req.token_email) {
          const tokenUser = await userCollection.findOne({
            email: req.token_email,
          });
          if (!tokenUser || tokenUser.role !== "admin")
            return res.status(403).json({ message: "Forbidden" });
        }
        const update = { $set: data };
        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          update,
        );
        res.status(200).json({ success: true, result });
      } catch (err) {
        console.error("/users/:id PATCH error:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Update role by admin
    app.patch("/users/:id/role", async (req, res) => {
      try {
        const id = req.params.id;
        if (!isValidId(id))
          return res.status(400).json({ message: "Invalid id" });
        const { role } = req.body;
        if (!role) return res.status(400).json({ message: "Role is required" });
        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } },
        );
        res.status(200).json({ success: true, result });
      } catch (err) {
        console.error("PATCH /users/:id/role", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Get role by email
    app.get("/users/:email/role", async (req, res) => {
      try {
        const email = req.params.email;
        if (!email) return res.status(400).json({ message: "Email required" });
        const user = await userCollection.findOne({ email });
        res.status(200).json({ role: user?.role || "student" });
      } catch (err) {
        console.error("/users/:email/role", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Get user by email
    app.get("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await userCollection.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });
        res.status(200).json({ user });
      } catch (err) {
        console.error("/users/:email GET", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // scholarships related api
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
          userName,
          applicationId,
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
                product_data: {
                  name: scholarshipName || "Scholarship Application",
                },
                unit_amount: Math.round(Number(amount) * 100),
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          customer_email: studentEmail,
          metadata: {
            scholarshipId,
            applicationId,
            scholarshipName,
            universityName,
            userName,
          },
          success_url: `${process.env.CLIENT_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.CLIENT_URL}/payment-failed`,
        });

        res.json({ url: session.url });
      } catch (err) {
        console.error("/create-checkout-session", err);
        res.status(500).json({ message: "Stripe session error" });
      }
    });

    // Payment verify
    app.get("/payment-verify", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        if (!sessionId)
          return res.status(400).json({ message: "Session ID missing" });

        const session = await stripe.checkout.sessions.retrieve(sessionId, {
          expand: ["line_items.data.price.product"],
        });
        if (!session)
          return res.status(404).json({ message: "Session not found" });
        if (session.payment_status !== "paid") {
          return res.status(400).json({
            success: false,
            paymentStatus: "unpaid",
            message: "Payment not completed.",
          });
        }

        const transactionId = session.payment_intent;
        if (!transactionId)
          return res.status(400).json({ message: "Transaction id missing" });

        // Prevent duplicate processing
        const existing = await paymentCollection.findOne({ transactionId });
        if (existing)
          return res.status(409).json({ message: "Payment already processed" });

        const scholarshipId = session.metadata?.scholarshipId;
        const applicationId = session.metadata?.applicationId;
        const scholarshipName = session.metadata?.scholarshipName;
        const universityName = session.metadata?.universityName;
        const userName = session.metadata?.userName;

        // If application already exists, update it
        if (applicationId && isValidId(applicationId)) {
          const applicationExist = await applicationCollection.findOne({
            _id: new ObjectId(applicationId),
          });
          if (applicationExist) {
            const updateDoc = {
              $set: {
                paymentStatus: "paid",
                transactionId,
                paidAt: new Date(),
              },
            };
            await applicationCollection.updateOne(
              { _id: new ObjectId(applicationId) },
              updateDoc,
            );
            //payment history
            await paymentCollection.insertOne({
              transactionId,
              applicationId: new ObjectId(applicationId),
              amount: session.amount_total / 100,
              currency: session.currency,
              createdAt: new Date(),
              raw: session,
            });
            return res.json({
              success: true,
              message: "Application updated successfully",
            });
          }
        }

        //create application record with paid status
        const applicationData = {
          userEmail: session.customer_details?.email || session.customer_email,
          userName,
          scholarshipId,
          scholarshipName,
          universityName,
          transactionId,
          amount: (session.amount_total || 0) / 100,
          currency: session.currency || "USD",
          paymentStatus: "paid",
          ApplicationStatus: "pending",
          appliedAt: new Date(),
          paidAt: new Date(),
        };

        const insertResult =
          await applicationCollection.insertOne(applicationData);
        await paymentCollection.insertOne({
          ...applicationData,
          createdAt: new Date(),
        });

        res.json({ success: true, applicationId: insertResult.insertedId });
      } catch (err) {
        console.error("/payment-verify", err);
        res.status(500).json({ message: "Server error verifying payment" });
      }
    });

    // Record failed payment but still save unpaid application
    app.post("/payment-failed-record", async (req, res) => {
      try {
        const {
          scholarshipId,
          scholarshipName,
          universityName,
          userEmail,
          userName,
          amount,
        } = req.body;
        if (!userEmail || !scholarshipId)
          return res
            .status(400)
            .json({ message: "userEmail and scholarshipId required" });

        const applicationExist = await applicationCollection.findOne({
          userEmail,
          scholarshipId,
        });
        if (applicationExist)
          return res
            .status(409)
            .json({ message: "Application already exists" });

        const applicationData = {
          userEmail,
          userName,
          scholarshipId,
          scholarshipName,
          universityName,
          amount,
          paymentStatus: "unpaid",
          ApplicationStatus: "pending",
          appliedAt: new Date(),
        };

        const result = await applicationCollection.insertOne(applicationData);
        res
          .status(201)
          .json({ success: true, applicationId: result.insertedId });
      } catch (err) {
        console.error("/payment-failed-record", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // My Application Api
    app.get("/my-applications", async (req, res) => {
      try {
        const { userEmail } = req.query;
        if (!userEmail)
          return res.status(400).json({ message: "userEmail is required" });
        if (userEmail !== req.token_email)
          return res.status(403).json({
            message: "Forbidden - can only view your own applications",
          });
        const apps = await applicationCollection.find({ userEmail }).toArray();
        res.json({ success: true, applications: apps });
      } catch (err) {
        console.error("/my-applications", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Delete application api
    app.delete("/my-applications/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!isValidId(id))
          return res.status(400).json({ message: "Invalid id" });
        const appDoc = await applicationCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!appDoc)
          return res.status(404).json({ message: "Application not found" });
        if (appDoc.userEmail !== req.token_email)
          return res.status(403).json({ message: "Forbidden" });
        const result = await applicationCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.json({ success: true, result });
      } catch (err) {
        console.error("DELETE /my-applications/:id", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Review related api
    // Add Review
    app.post("/my-reviews", async (req, res) => {
      try {
        const {
          scholarshipId,
          scholarshipName,
          universityName,
          userName,
          userEmail,
          userImage,
          rating,
          comment,
        } = req.body;
        if (!scholarshipId || !userEmail)
          return res
            .status(400)
            .json({ message: "scholarshipId and userEmail required" });
        const review = {
          scholarshipId,
          scholarshipName,
          universityName,
          userName,
          userEmail,
          userImage: userImage || null,
          rating: Number(rating),
          comment,
          reviewDate: new Date(),
        };
        const result = await reviewCollection.insertOne(review);
        res.status(201).json({ success: true, insertedId: result.insertedId });
      } catch (err) {
        console.error("/my-reviews POST", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Get Reviews
    app.get("/my-reviews", async (req, res) => {
      try {
        const userEmail = req.query.userEmail;
        if (!userEmail)
          return res.status(400).json({ message: "userEmail required" });
        if (userEmail !== req.token_email)
          return res.status(403).json({ message: "Forbidden" });
        const reviews = await reviewCollection
          .find({ userEmail })
          .sort({ reviewDate: -1 })
          .toArray();
        res.json({ success: true, reviews });
      } catch (err) {
        console.error("/my-reviews GET", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Update Review
    app.patch("/my-reviews/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!isValidId(id))
          return res.status(400).json({ message: "Invalid id" });
        const review = await reviewCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!review)
          return res.status(404).json({ message: "Review not found" });
        if (review.userEmail !== req.token_email)
          return res.status(403).json({ message: "Forbidden" });
        const { rating, comment } = req.body;
        const update = {
          $set: { rating: Number(rating), comment, reviewDate: new Date() },
        };
        const result = await reviewCollection.updateOne(
          { _id: new ObjectId(id) },
          update,
        );
        res.json({ success: true, result });
      } catch (err) {
        console.error("PATCH /my-reviews/:id", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Delete Review
    app.delete("/my-reviews/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!isValidId(id))
          return res.status(400).json({ message: "Invalid id" });
        const review = await reviewCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!review)
          return res.status(404).json({ message: "Review not found" });
        if (
          review.userEmail !== req.token_email &&
          (await userCollection.findOne({ email: req.token_email })).role !==
            "moderator"
        ) {
          return res.status(403).json({ message: "Forbidden" });
        }
        const result = await reviewCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.json({ success: true, result });
      } catch (err) {
        console.error("DELETE /my-reviews/:id", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Applications Api for admin & Moderator
    // View All Applications
    app.get(
      "/all-applications",
      verifyFirebaseToken,
      verifyModerator,
      async (req, res) => {
        try {
          const apps = await applicationCollection.find().toArray();
          res.json({ success: true, applications: apps });
        } catch (err) {
          console.error("/all-applications", err);
          res.status(500).json({ message: "Server error" });
        }
      },
    );

    // Update Application status
    app.patch(
      "/all-applications/:id",
      verifyFirebaseToken,
      verifyModerator,
      async (req, res) => {
        try {
          const id = req.params.id;
          if (!isValidId(id))
            return res.status(400).json({ message: "Invalid id" });
          const { status, feedback } = req.body;
          const update = {};
          if (status) update.ApplicationStatus = status;
          if (feedback) update.feedback = feedback;
          const result = await applicationCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: update },
          );
          res.json({ success: true, result });
        } catch (err) {
          console.error("PATCH /all-applications/:id", err);
          res.status(500).json({ message: "Server error" });
        }
      },
    );

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

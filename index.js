
const express = require('express');
const app = express();
const cors = require('cors');

const fs = require('fs');
const path = require('path');

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const dotenv = require('dotenv');
dotenv.config();
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);
const sqlite3 = require('sqlite3').verbose();




const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.erlqeyi.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const database = client.db("serviceDB");
    const serviceCollection = database.collection("services");
    const paymentsCollection = database.collection('payments');
    const usersCollection = database.collection("users");




 //  SQLite setup 
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const authDbPath = path.join(dbDir, 'auth.db');
const authDb = new sqlite3.Database(authDbPath, (err) => {
  if (err) {
    console.error("Failed to open SQLite DB:", err);
  } else {
    console.log("SQLite auth DB opened at", authDbPath);
  }
});


authDb.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer'
  )
`, (err) => {
  if (err) console.error("Create table error:", err.message);
  else console.log("SQLite users table ready with role column");
});


authDb.run(`
  ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer';
`, (err) => {
  if (err) {
  
    if (!err.message.includes("duplicate column name")) {
      console.error("Alter table error:", err.message);
    }
  } else {
    console.log("role column added to existing users table");
  }
});


app.locals.authDb = authDb;
app.locals.usersCollection = usersCollection;
app.locals.serviceCollection = serviceCollection;
app.locals.paymentsCollection = paymentsCollection;

const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);



app.get("/users", async (req, res) => {
  try {
    const users = await usersCollection.find({}).toArray();
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});


// recently logged-in users
app.get('/users/recent', async (req, res) => {
       try {
              const users = await usersCollection
                     .find({})
                     .sort({ last_log_in: -1 })
                     .limit(3)
                     .toArray();
              res.json(users);
       } catch (err) {
              console.error(err);
              res.status(500).json({ error: 'Failed to fetch users' });
       }
});


// Search users by email
app.get("/users/search", async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ message: "Email query is required" });
  }

  try {

    const regex = new RegExp(`^${email}`, "i");

    const matchedUsers = await usersCollection
      .find({ email: { $regex: regex } })
      .limit(10)
      .toArray();

    res.send(matchedUsers);
  } catch (err) {
    console.error("Search failed:", err);
    res.status(500).json({ error: "Failed to search users" });
  }
});

// Update user role (Make/Remove Admin)
app.patch("/users/admin/:id", async (req, res) => {
  const id = req.params.id;
  const { role } = req.body;

  if (!role) {
    return res.status(400).json({ message: "Role is required" });
  }

  try {
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role: role } }
    );

    res.json(result);
  } catch (err) {
    console.error("Role update failed:", err);
    res.status(500).json({ error: "Failed to update role" });
  }
});

    // get services (with optional category filter)
    
app.get("/services/approved", async (req, res) => {
  try {
    const { title, location, category } = req.query;
    let query = { status: "approved" };


    if (title) {
      query.title = { $regex: title, $options: "i" };
    }

    
    if (location) {
      query.location = { $regex: location, $options: "i" };
    }

    
    if (category) {
      query.category = category;
    }

    const result = await serviceCollection.find(query).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch approved services", error });
  }
});



app.get("/services/approved/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id), status: "approved" };

    const service = await serviceCollection.findOne(query);

    if (!service) {
      return res.status(404).send({ message: "Approved service not found" });
    }

    res.send(service);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch approved service", error });
  }
});
    // get all services
    // will be protected
app.get("/services", async (req, res) => {
  try {
    const { email } = req.query;
    const query = email ? { userEmail: email } : {};
    const result = await serviceCollection.find(query).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch services", error });
  }
});


    //  get services by id 
    app.get("/services/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await serviceCollection.findOne(query);
        if (!result) {
          return res.status(404).send({ message: "services not found" });
        }
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch services", error });
      }
    });

    // post services
    app.post("/services", async (req, res) => {
      const service = req.body;
      service.status = "pending"; 
      const result = await serviceCollection.insertOne(service);
      res.send(result);
    });


app.patch("/services/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { action } = req.body; 

    if (!["approve", "reject"].includes(action)) {
      return res.status(400).send({ message: "Invalid action" });
    }

    const updatedDoc = {
      $set: {
        status: action === "approve" ? "approved" : "rejected",
      },
    };

    const result = await serviceCollection.updateOne(
      { _id: new ObjectId(id) },
      updatedDoc
    );

    if (result.modifiedCount === 0) {
      return res.status(404).send({ message: "Service not found or not updated" });
    }

    res.send({ message: "Service status updated successfully" });
  } catch (error) {
    console.error("Error updating service:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});



app.put("/services/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updateData = { ...req.body };

   
    if (updateData._id) delete updateData._id;

    

    const result = await serviceCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.modifiedCount > 0) {
      res.send({ success: true, message: "Service updated successfully" });
    } else {
     
      res.status(404).send({
        success: false,
        message: "Service not found or no changes detected",
      });
    }
  } catch (error) {
    console.error("Update service failed:", error);
    res.status(500).send({
      success: false,
      message: "Failed to update service",
      error: error.message,
    });
  }
});

    // delete service
    app.delete("/services/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const result = await serviceCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to delete service", error });
      }
    });
    



    app.post('/create-payment-intent', async (req, res) => {
  const { price } = req.body;

  if (!price || isNaN(price)) {
    return res.status(400).send({ message: "Invalid price" });
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(Number(price) * 100), 
      currency: 'usd',
      payment_method_types: ['card'],
    });

    res.send({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error("Stripe Payment Intent Error:", error);
    res.status(500).send({ message: error.message });
  }
});



// provider earnings history
// will be protected
app.get("/payments/provider/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const paymentsCollection = req.app.locals.paymentsCollection;

 
    const history = await paymentsCollection
      .find({ providerEmail: email })
      .sort({ date: -1 })
      .toArray();

 
    const totalEarnings = history.reduce((sum, p) => sum + Number(p.price), 0);
    const totalSales = history.length;
    const lastPayment = history[0]?.date || null;

    res.send({
      summary: {
        totalEarnings,
        totalSales,
        lastPayment,
      },
      history,
    });
  } catch (error) {
    console.error("Provider earnings fetch error:", error);
    res.status(500).send({ message: "Failed to fetch provider earnings" });
  }
});



// get payment history by buyer email

// will be protected
app.get("/payments/history/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const paymentsCollection = req.app.locals.paymentsCollection;

    const history = await paymentsCollection
      .find({ buyerEmail: email })
      .sort({ date: -1 }) 
      .toArray();

    res.send(history);
  } catch (error) {
    console.error("Fetch payment history error:", error);
    res.status(500).send({ message: "Failed to fetch payment history" });
  }
});



app.post("/payments", async (req, res) => {
  try {
    const payment = req.body;
    const paymentsCollection = req.app.locals.paymentsCollection;
    const serviceCollection = req.app.locals.serviceCollection;
    const usersCollection = req.app.locals.usersCollection;

   
    const result = await paymentsCollection.insertOne(payment);

   
    const provider = await usersCollection.findOne({ email: payment.providerEmail });
    if (provider) {
      const newEarning = (provider.earning || 0) + Number(payment.price);
      await usersCollection.updateOne(
        { email: payment.providerEmail },
        { $set: { earning: newEarning } }
      );
    }

  
    await serviceCollection.updateOne(
      { _id: new ObjectId(payment.serviceId) },
      { $inc: { soldCount: 1 } } 
    );

    res.send({ success: true, insertedId: result.insertedId });
  } catch (error) {
    console.error("Payment save error:", error);
    res.status(500).send({ message: "Payment save failed", error });
  }
});



    //     await client.db("admin").command({ ping: 1 });
    //     console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    //     await client.close();
  }
}
run().catch(console.dir);




app.get('/', (req, res) => {
  res.send('service booking platform is running')
})


app.listen(port, () => {
  console.log(`service booking platform is running ${port}`);
})
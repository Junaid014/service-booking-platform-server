
const express = require('express');
const app = express();
const cors = require('cors');
// const otpRoutes = require('./otp');

const fs = require('fs');
const path = require('path');

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const dotenv = require('dotenv');
dotenv.config();
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);
const sqlite3 = require('sqlite3').verbose();
const verifyToken = require("./verifyToken");
const bodyParser = require('body-parser');



const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// app.use('/api/auth', otpRoutes);

app.use((req, res, next) => {
  if (req.originalUrl === '/webhook/stripe') {
    bodyParser.raw({ type: 'application/json' })(req, res, next);
  } else {
    next();
  }
});


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
    const reviewsCollection = database.collection("reviews");

    app.locals.db = database;


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


// ====== OTP Table ======
authDb.run(`
  CREATE TABLE IF NOT EXISTS otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    otp TEXT NOT NULL,
    expiresAt INTEGER NOT NULL
  )
`, (err) => {
  if (err) console.error("Create OTP table error:", err.message);
  else console.log("SQLite OTP table ready");
});


app.locals.authDb = authDb;
app.locals.usersCollection = usersCollection;
app.locals.serviceCollection = serviceCollection;
app.locals.paymentsCollection = paymentsCollection;
app.locals.reviewsCollection = reviewsCollection;

const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);





app.get("/users",verifyToken, async (req, res) => {
  try {
    const users = await usersCollection.find({}).toArray();
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});


// recently logged-in users
app.get('/users/recent',verifyToken, async (req, res) => {
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
app.get("/users/search",verifyToken, async (req, res) => {
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


// Get user by email
app.get("/users/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to fetch user" });
  }
});




app.get('/users/:email/role', async (req, res) => {
  const email = req.params.email;
  const user = await usersCollection.findOne({ email });

  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  res.send({ role: (user.role || 'customer').toLowerCase() });
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


app.patch("/users/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const { image } = req.body;

    const result = await usersCollection.updateOne(
      { email },
      { $set: { image } }
    );

    res.json({ success: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update profile image" });
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


// trending services get and patch 


//  trending services get
app.get("/services/trending", async (req, res) => {
  try {
    const serviceCollection = req.app.locals.serviceCollection;
    const result = await serviceCollection
      .find({ trending: true, status: "approved" })
      .toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch trending services" });
  }
});


app.patch("/services/trending/:id", async (req, res) => {
  const { id } = req.params;
  const { trending } = req.body;

  try {
    const updated = await serviceCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { trending } }
    );
    res.send({ success: true, updated });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Internal Server Error" });
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
app.get("/services",verifyToken, async (req, res) => {
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


// POST: Add Review
app.post("/reviews", async (req, res) => {
  try {
    const review = req.body;
    review.date = new Date();

    const result = await reviewsCollection.insertOne(review);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to add review", error });
  }
});

// GET: Fetch reviews for a service
app.get("/reviews/:serviceId", async (req, res) => {
  try {
    const serviceId = req.params.serviceId;
    const result = await reviewsCollection.find({ serviceId }).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch reviews", error });
  }
});



// provider earnings history
// will be protected
app.get("/payments/provider/:email",verifyToken, async (req, res) => {
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
app.get("/payments",verifyToken, async (req, res) => {
  try {
    const payments = await req.app.locals.paymentsCollection
      .find()           
      .sort({ date: -1 }) 
      .toArray();

    res.send(payments);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to fetch payment history" });
  }
});

// will be protected
app.get("/payments/history/:email", verifyToken, async (req, res) => {
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




// subscription related api


app.post('/subscription/create-checkout-session', verifyToken, async (req, res) => {
  try {
    const { planId, name, price, discount } = req.body;
    const userEmail = req.user?.email || req.body.email;

    const missing = [];
    if (!planId) missing.push('planId');
    if (!name) missing.push('name');
    if (!price && price !== 0) missing.push('price');
    if (!userEmail) missing.push('userEmail');

    if (missing.length > 0) {
      return res.status(400).json({ ok: false, message: 'Missing required fields', missing });
    }

    const unitAmount = Math.round(Number(price) * 100);

    const line_items = [{
      price_data: {
        currency: 'usd',
        product_data: { name: `${name} Subscription` },
        recurring: { interval: 'month' },
        unit_amount: unitAmount,
      },
      quantity: 1,
    }];

    const sessionParams = {
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: userEmail,
      line_items,
      success_url: `${process.env.FRONTEND_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/`,
      metadata: { planId, planName: name, discount: discount || '' } 
    };

   

    const session = await stripe.checkout.sessions.create(sessionParams);

   
    const db = req.app.locals.db;
    await db.collection('subscriptions').updateOne(
      { checkout_session_id: session.id },
      { $set: {
          checkout_session_id: session.id,
          userEmail,
          planId,
          planName: name,
          price_cents: unitAmount,
          discount: discount || null,
          status: 'pending',
          createdAt: new Date()
        } },
      { upsert: true }
    );

    return res.json({ ok: true, url: session.url, id: session.id });
  } catch (err) {
    console.error('create-checkout-session ERROR:', err);
    return res.status(500).json({ ok: false, message: err.message || 'Internal error' });
  }
});






app.post(
  '/webhook/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('⚠️ Webhook signature verification failed.', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const db = req.app.locals.db;

    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;

        const stripeSubscriptionId = session.subscription;
        const stripeCustomer = session.customer;
        const checkoutSessionId = session.id;
        const userEmail = session.customer_email || session.metadata?.email;
        const planId = session.metadata?.planId;
        const planName = session.metadata?.planName;
        const discountMeta = session.metadata?.discount || null; 

        
        await db.collection('subscriptions').updateOne(
          { checkout_session_id: checkoutSessionId },
          {
            $set: {
              stripe_subscription_id: stripeSubscriptionId,
              stripe_customer_id: stripeCustomer,
              status: 'active',
              start_date: new Date(),
              updatedAt: new Date(),
              expiresAt: new Date(new Date().setMonth(new Date().getMonth() + 1)),
              raw_session: session
            }
          },
          { upsert: true }
        );

        const subscriptionObj = {
          plan: planName || planId,
          planId: planId || null,
          discount: discountMeta,    
          stripe_subscription_id: stripeSubscriptionId,
          startDate: new Date(),
          status: 'active'
        };

        await db.collection('users').updateOne(
          { email: userEmail },
          { $set: { subscription: subscriptionObj, role: 'customer' } },
          { upsert: false }
        );

        console.log(`Subscription activated for ${userEmail} -> ${planName || planId}`);
      }

      res.json({ received: true });
    } catch (err) {
      console.error('Webhook handling error:', err);
      res.status(500).send();
    }
  }
);



app.post('/subscription/confirm', verifyToken, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ message: 'sessionId required' });

   
    const db = req.app.locals.db;
    const sub = await db.collection('subscriptions').findOne({ checkout_session_id: sessionId });
    if (sub && sub.status === 'active') {
      return res.json({ success: true, subscription: sub });
    }

    
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session && session.payment_status === 'paid') {
    
      const userEmail = session.customer_email;
      const planId = session.metadata?.planId;
      const planName = session.metadata?.planName;
      const discountMeta = session.metadata?.discount || null;

      const stripeSubscriptionId = session.subscription;

      const subscriptionObj = {
        plan: planName || planId,
        planId: planId,
        discount: discountMeta,
        stripe_subscription_id: stripeSubscriptionId,
        startDate: new Date(),
        status: 'active'
      };

      await db.collection('subscriptions').updateOne(
        { checkout_session_id: sessionId },
        { $set: {
            stripe_subscription_id: stripeSubscriptionId,
            stripe_customer_id: session.customer,
            status: 'active',
            start_date: new Date(),
            raw_session: session
          } },
        { upsert: true }
      );

      await db.collection('users').updateOne(
        { email: userEmail },
        { $set: { subscription: subscriptionObj, role: 'customer' } }
      );

      return res.json({ success: true, subscription: subscriptionObj });
    }

    return res.status(404).json({ message: 'Session not completed yet' });
  } catch (err) {
    console.error('confirm subscription error:', err);
    res.status(500).json({ message: err.message });
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
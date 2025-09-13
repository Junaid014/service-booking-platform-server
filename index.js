
const express = require('express');
const app = express();
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const dotenv = require('dotenv');
dotenv.config();


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

    // get services (with optional category filter)
    
app.get("/services/approved", async (req, res) => {
  try {
    const { title, location } = req.query; 
    let query = { status: "approved" };

    
    if (title) {
      query.title = { $regex: title, $options: "i" }; 
    }

  
    if (location) {
      query.location = { $regex: location, $options: "i" };
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
    const result = await serviceCollection.find().toArray();
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
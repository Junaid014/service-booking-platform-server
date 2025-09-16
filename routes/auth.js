const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

//  REGISTER 
router.post('/register', (req, res) => {
  const { username, password, email, phone } = req.body;

  
  if (!username || !password || !email || !phone) {
    return res.status(400).json({
      message: "username, password, email and phone are required"
    });
  }

  //  phone validation
  const bdPhoneRegex = /^(?:\+?88)?01[3-9]\d{8}$/;
  if (!bdPhoneRegex.test(phone)) {
    return res.status(400).json({ message: "Invalid Bangladesh phone number" });
  }

  const authDb = req.app.locals.authDb;
  const usersCollection = req.app.locals.usersCollection;

  // Checking if username already exists in SQLite
  authDb.get("SELECT * FROM users WHERE username = ?", [phone], async (err, row) => {
    if (err) {
      console.error("SQLite error:", err);
      return res.status(500).json({ message: "DB error" });
    }
    if (row) {
      return res.status(400).json({ message: "User already exists" });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);

      // Insert into SQLite with default role = "customer"
      authDb.run(
        "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
        [phone, hashedPassword, "customer"], 
        function (err) {
          if (err) {
            console.error("SQLite insert error:", err);
            return res.status(500).json({ message: "Failed to save auth info" });
          }

         
          const profileDoc = {
            username,   
            email,
            phone,
            role: "customer",
            createdAt: new Date()
          };

          usersCollection.insertOne(profileDoc)
            .then(result => {
              return res.status(201).json({
                message: "Registered successfully",
                userId: result.insertedId
              });
            })
            .catch(mongoErr => {
              console.error("Mongo insert error:", mongoErr);
              return res.status(500).json({
                message: "Registered in auth but failed to save profile"
              });
            });
        }
      );
    } catch (hashErr) {
      console.error(hashErr);
      return res.status(500).json({ message: "Hashing error" });
    }
  });
});


router.post('/login', (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ message: "phone and password required" });
  }

  const authDb = req.app.locals.authDb;
  const usersCollection = req.app.locals.usersCollection;

 
  authDb.get("SELECT * FROM users WHERE username = ?", [phone], async (err, row) => {
    if (err) {
      console.error("SQLite error:", err);
      return res.status(500).json({ message: "DB error" });
    }
    if (!row) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    try {
      const match = await bcrypt.compare(password, row.password);
      if (!match) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

    
      const profile = await usersCollection.findOne({ phone }, { projection: { password: 0 } });

      return res.json({
        message: "Login successful",
        profile
      });

    } catch (compareErr) {
      console.error(compareErr);
      return res.status(500).json({ message: "Auth error" });
    }
  });
});

module.exports = router;

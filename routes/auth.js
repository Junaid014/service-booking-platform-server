// const express = require('express');
// const router = express.Router();
// const bcrypt = require('bcryptjs');

// //  REGISTER 
// router.post('/register', (req, res) => {
//   const { username, password, email, phone,role } = req.body;

  
//   if (!username || !password || !email || !phone) {
//     return res.status(400).json({
//       message: "username, password, email and phone are required"
//     });
//   }

//   //  phone validation
//   const bdPhoneRegex = /^(?:\+?88)?01[3-9]\d{8}$/;
//   if (!bdPhoneRegex.test(phone)) {
//     return res.status(400).json({ message: "Invalid Bangladesh phone number" });
//   }

//   const authDb = req.app.locals.authDb;
//   const usersCollection = req.app.locals.usersCollection;

//   // Checking if username already exists in SQLite
//   authDb.get("SELECT * FROM users WHERE username = ?", [phone], async (err, row) => {
//     if (err) {
//       console.error("SQLite error:", err);
//       return res.status(500).json({ message: "DB error" });
//     }
//     if (row) {
//       return res.status(400).json({ message: "User already exists" });
//     }

//     try {
//       const hashedPassword = await bcrypt.hash(password, 10);

//       // Insert into SQLite with default role = "customer"
//       authDb.run(
//         "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
//         [phone, hashedPassword, "customer"], 
//         function (err) {
//           if (err) {
//             console.error("SQLite insert error:", err);
//             return res.status(500).json({ message: "Failed to save auth info" });
//           }

         
//           const profileDoc = {
//             username,   
//             email,
//             phone,
//             role: role || "customer",
//             createdAt: new Date()
//           };

//           usersCollection.insertOne(profileDoc)
//             .then(result => {
//               return res.status(201).json({
//                 message: "Registered successfully",
//                 userId: result.insertedId
//               });
//             })
//             .catch(mongoErr => {
//               console.error("Mongo insert error:", mongoErr);
//               return res.status(500).json({
//                 message: "Registered in auth but failed to save profile"
//               });
//             });
//         }
//       );
//     } catch (hashErr) {
//       console.error(hashErr);
//       return res.status(500).json({ message: "Hashing error" });
//     }
//   });
// });


// router.post('/login', (req, res) => {
//   const { phone, password } = req.body;

//   if (!phone || !password) {
//     return res.status(400).json({ message: "phone and password required" });
//   }

//   const authDb = req.app.locals.authDb;
//   const usersCollection = req.app.locals.usersCollection;

 
//   authDb.get("SELECT * FROM users WHERE username = ?", [phone], async (err, row) => {
//     if (err) {
//       console.error("SQLite error:", err);
//       return res.status(500).json({ message: "DB error" });
//     }
//     if (!row) {
//       return res.status(400).json({ message: "Invalid credentials" });
//     }

//     try {
//       const match = await bcrypt.compare(password, row.password);
//       if (!match) {
//         return res.status(400).json({ message: "Invalid credentials" });
//       }

    
//       const profile = await usersCollection.findOne({ phone }, { projection: { password: 0 } });

//       return res.json({
//         message: "Login successful",
//         profile
//       });

//     } catch (compareErr) {
//       console.error(compareErr);
//       return res.status(500).json({ message: "Auth error" });
//     }
//   });
// });

// module.exports = router;







const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

function generateOtp(length = 6) {
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += Math.floor(Math.random() * 10);
  }
  return otp;
}

// Generate JWT token
function generateToken(user) {
  if (!process.env.JWT_SECRET) {
    console.error("Missing JWT_SECRET in environment");
    throw new Error("Server misconfiguration");
  }

  
  const idStr = user.id ? user.id.toString() : null;

  const payload = {
    id: idStr,
    phone: user.phone,
    role: user.role || "customer"
  };

  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });
}

//  REGISTER 
router.post('/register', (req, res) => {
  const { username, password, email, phone, role } = req.body;

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

     
      authDb.run(
        "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
        [phone, hashedPassword, role || "customer"],
        function (err) {
          if (err) {
            console.error("SQLite insert error:", err);
            return res.status(500).json({ message: "Failed to save auth info" });
          }

          
          const sqliteUserId = this.lastID;

          const profileDoc = {
            username,
            email,
            phone,
            role: role || "customer",
            createdAt: new Date()
          };

          usersCollection.insertOne(profileDoc)
            .then(result => {
              const savedProfile = {
                id: result.insertedId.toString(),
                username: profileDoc.username,
                email: profileDoc.email,
                phone: profileDoc.phone,
                role: profileDoc.role
              };

              
              let token;
              try {
                token = generateToken(savedProfile);
              } catch (tokenErr) {
                console.error("Token generation error:", tokenErr);
              
                authDb.run("DELETE FROM users WHERE id = ?", [sqliteUserId], (delErr) => {
                  if (delErr) console.error("Rollback sqlite failed:", delErr);
                });
                return res.status(500).json({ message: "Server error while creating token" });
              }

              return res.status(201).json({
                message: "Registered successfully",
                profile: savedProfile,
                token
              });
            })
            .catch(mongoErr => {
              console.error("Mongo insert error:", mongoErr);
            
              authDb.run("DELETE FROM users WHERE id = ?", [sqliteUserId], (delErr) => {
                if (delErr) console.error("Failed to rollback sqlite user:", delErr);
               
                return res.status(500).json({
                  message: "Registered in auth but failed to save profile"
                });
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


//  LOGIN
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

      
      let profile = null;
      try {
        profile = await usersCollection.findOne({ phone });
      } catch (mongoFindErr) {
        console.error("Mongo find error:", mongoFindErr);
      }

      
      const safeProfile = profile
        ? {
            id: profile._id ? profile._id.toString() : null,
            username: profile.username,
            email: profile.email,
            phone: profile.phone,
            role: row.role || profile.role || "customer"
          }
        : {
           
            id: null,
            username: row.username || phone,
            email: null,
            phone,
            role: row.role || "customer"
          };

     
      let token;
      try {
        token = generateToken(safeProfile);
      } catch (tokenErr) {
        console.error("Token generation error:", tokenErr);
        return res.status(500).json({ message: "Server error while creating token" });
      }

      return res.json({
        message: "Login successful",
        profile: safeProfile,
        token
      });

    } catch (compareErr) {
      console.error(compareErr);
      return res.status(500).json({ message: "Auth error" });
    }
  });
});

module.exports = router;

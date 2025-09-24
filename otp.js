const express = require("express");
const jwt = require("jsonwebtoken");
const twilio = require("twilio");
require("dotenv").config();

const router = express.Router();



// Twilio credentials from .env
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

// debug logs
console.log("Twilio SID:", accountSid);
console.log("Twilio TOKEN:", authToken ? "exists" : "missing");
console.log("Twilio PHONE:", twilioPhone);
const client = twilio(accountSid, authToken);

// OTP generator
function generateOtp(length = 6) {
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += Math.floor(Math.random() * 10);
  }
  return otp;
}

// ========================
// Send OTP
// ========================
router.post("/send-otp", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ message: "Phone is required" });

  const authDb = req.app.locals.authDb;

  const otp = generateOtp(6);
  const expiresAt = Date.now() + 2 * 60 * 1000; 

  // Save OTP into SQLite
  authDb.run(
    "INSERT INTO otps (phone, otp, expiresAt) VALUES (?, ?, ?)",
    [phone, otp, expiresAt],
    async (err) => {
      if (err) {
        console.error("DB error:", err.message);
        return res.status(500).json({ message: "Failed to save OTP" });
      }

      try {
        
        const message = await client.messages.create({
          body: `Your OTP is ${otp}`,
          from: twilioPhone,
          to: phone.startsWith("+88") ? phone : "+88" + phone,
        });

        console.log(`Twilio message SID: ${message.sid}`);
        res.json({ message: "OTP sent successfully via SMS" });
      } catch (smsErr) {
        console.error("Twilio SMS error:", smsErr);
        res.status(500).json({ message: "Failed to send OTP via SMS" });
      }
    }
  );
});

// ========================
// Verify OTP
// ========================
router.post("/verify-otp", (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp)
    return res.status(400).json({ message: "Phone and OTP are required" });

  const authDb = req.app.locals.authDb;
  const usersCollection = req.app.locals.usersCollection;

  authDb.get(
    "SELECT * FROM otps WHERE phone = ? ORDER BY id DESC LIMIT 1",
    [phone],
    async (err, row) => {
      if (err) {
        console.error("DB error:", err.message);
        return res.status(500).json({ message: "DB error" });
      }
      if (!row) return res.status(400).json({ message: "OTP not found" });

      if (row.otp !== otp)
        return res.status(400).json({ message: "Invalid OTP" });

      if (Date.now() > row.expiresAt)
        return res.status(400).json({ message: "OTP expired" });

      try {
        
        const user = await usersCollection.findOne({ phone });
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        // JWT issue 
        const token = jwt.sign(
          { id: user._id, role: user.role },
          process.env.JWT_SECRET,
          { expiresIn: "7d" }
        );

        res.json({
          message: "OTP verified successfully",
          profile: user,
          token,
        });
      } catch (e) {
        console.error("Server error:", e);
        res.status(500).json({ message: "Server error" });
      }
    }
  );
});

module.exports = router;
